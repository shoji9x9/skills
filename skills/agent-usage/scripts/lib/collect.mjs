// collect の本体（ローカルのログ）。ログを探して要約にし、明細の行を作って、まだ記録していない行だけを新しいファイルに書く。
//
// キャッシュ: <git の共通のディレクトリ>/agent-usage/cache.json に、セッションごとの要約を、
// ログのファイルの大きさと更新時刻・このツールの版から作った指紋と一緒に置く。
// 指紋が同じセッションは解析し直さない。キャッシュは消しても結果は変わらない（作り直すだけ）。
// 行は、セッションをまたいだ重複を除いて（dedupe.mjs）から、毎回すべての要約から作る。

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.mjs";
import { isArray } from "./is-array.mjs";
import { isRecord } from "./config.mjs";
import { parseClaudeSession } from "./claude-log.mjs";
import { parseCodexSession } from "./codex-log.mjs";
import { claimsPath, dedupeSessions, loadClaims, saveClaims } from "./dedupe.mjs";
import { discoverClaude, discoverCodex } from "./discover.mjs";
import { zeroTokens } from "./pricing.mjs";
import { isInside, normalizeRemote } from "./repo.mjs";
import { timelineRows, usageRows } from "./usage.mjs";

/** @typedef {import("./rows.mjs").Row} Row */
/** @typedef {import("./discover.mjs").SessionSource} SessionSource */
/** @typedef {import("./usage.mjs").Context} Context */
/** @typedef {import("./session.mjs").SessionSummary} SessionSummary */
/** @typedef {import("./pricing.mjs").Tokens} Tokens */

/** @type {(keyof Tokens)[]} */
const TOKEN_FIELDS = ["input", "cacheRead", "cacheWrite5m", "cacheWrite1h", "output", "reasoning"];
const AGENT_GIT_COMMAND = /\bgit\b|\bgh\b/;

/** 要約の作り方を変えたら上げる（古いキャッシュを使わないため）。 */
export const ROWS_VERSION = "3";

/**
 * @typedef {object} CacheEntry
 * @property {string} fingerprint
 * @property {SessionSummary | null} summary このリポジトリのセッションでなければ null
 */

/**
 * @param {string} commonDir
 * @returns {string}
 */
export function cachePath(commonDir) {
  return join(commonDir, "agent-usage", "cache.json");
}

/**
 * @param {string} path
 * @returns {Map<string, CacheEntry>}
 */
export function loadCache(path) {
  /** @type {Map<string, CacheEntry>} */
  const out = new Map();
  if (!existsSync(path)) return out;
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return out;
  }
  if (!isRecord(raw) || raw.version !== ROWS_VERSION || !isRecord(raw.entries)) return out;
  for (const [k, v] of Object.entries(raw.entries)) {
    if (!isRecord(v) || typeof v.fingerprint !== "string") continue;
    if (v.summary === null) {
      out.set(k, { fingerprint: v.fingerprint, summary: null });
      continue;
    }
    const summary = summaryFromCache(v.summary);
    // 読めない要素は、そのセッションを解析し直す（キャッシュは消しても結果が変わらない）
    if (summary) out.set(k, { fingerprint: v.fingerprint, summary });
  }
  return out;
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * キャッシュに置いた要約を読む。形が違えば null（JSON にすると無限大は null になるので戻す）。
 * @param {unknown} v
 * @returns {SessionSummary | null}
 */
export function summaryFromCache(v) {
  if (!isRecord(v)) return null;
  const agent = v.agent;
  if (agent !== "claude-code" && agent !== "codex") return null;
  if (typeof v.sessionId !== "string" || typeof v.subagent !== "boolean") return null;
  if (typeof v.repoUrl !== "string" || !isNum(v.invalidLines)) return null;
  const firstTs = v.firstTs === null ? Number.POSITIVE_INFINITY : v.firstTs;
  const lastTs = v.lastTs === null ? Number.NEGATIVE_INFINITY : v.lastTs;
  if (typeof firstTs !== "number" || typeof lastTs !== "number") return null;
  const cwds = listOf(v.cwds, (c) => (typeof c === "string" ? c : null));
  const prompts = listOf(v.prompts, numOrNull);
  const turnEnds = listOf(v.turnEnds, numOrNull);
  const autoResumes = listOf(v.autoResumes, numOrNull);
  const branches = listOf(v.branches, (b) =>
    isRecord(b) && isNum(b.ts) && typeof b.branch === "string"
      ? { ts: b.ts, branch: b.branch }
      : null,
  );
  const messages = listOf(v.messages, (m) => {
    if (!isRecord(m) || typeof m.key !== "string" || !isNum(m.ts) || typeof m.model !== "string")
      return null;
    const tokens = tokensOf(m.tokens);
    return tokens ? { key: m.key, ts: m.ts, model: m.model, tokens } : null;
  });
  const costSnapshots = listOf(v.costSnapshots, (c) => {
    if (!isRecord(c) || !isNum(c.ts) || !isRecord(c.models)) return null;
    /** @type {Record<string, { costUSD: number; tokens: Tokens }>} */
    const models = {};
    for (const [name, x] of Object.entries(c.models)) {
      const tokens = isRecord(x) ? tokensOf(x.tokens) : null;
      if (!isRecord(x) || !isNum(x.costUSD) || !tokens) return null;
      models[name] = { costUSD: x.costUSD, tokens };
    }
    return { ts: c.ts, models };
  });
  const humanWaits = listOf(v.humanWaits, (w) =>
    isRecord(w) && isNum(w.start) && isNum(w.end) && typeof w.reason === "string"
      ? { start: w.start, end: w.end, reason: w.reason }
      : null,
  );
  const commands = listOf(v.commands, (c) =>
    isRecord(c) && isNum(c.ts) && typeof c.text === "string" ? { ts: c.ts, text: c.text } : null,
  );
  if (
    !cwds ||
    !prompts ||
    !turnEnds ||
    !autoResumes ||
    !branches ||
    !messages ||
    !costSnapshots ||
    !humanWaits ||
    !commands
  )
    return null;
  return {
    agent,
    sessionId: v.sessionId,
    subagent: v.subagent,
    cwds,
    repoUrl: v.repoUrl,
    branches,
    messages,
    costSnapshots,
    prompts,
    turnEnds,
    autoResumes,
    humanWaits,
    commands,
    firstTs,
    lastTs,
    invalidLines: v.invalidLines,
  };
}

/**
 * 配列の各要素を読む。1 つでも読めなければ null。
 * @template T
 * @param {unknown} list
 * @param {(x: unknown) => T | null} read
 * @returns {T[] | null}
 */
function listOf(list, read) {
  if (!isArray(list)) return null;
  /** @type {T[]} */
  const out = [];
  for (const x of list) {
    const value = read(x);
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

/**
 * @param {unknown} x
 * @returns {number | null}
 */
function numOrNull(x) {
  return isNum(x) ? x : null;
}

/**
 * @param {unknown} t
 * @returns {Tokens | null}
 */
function tokensOf(t) {
  if (!isRecord(t)) return null;
  const out = zeroTokens();
  for (const f of TOKEN_FIELDS) {
    const value = t[f];
    if (!isNum(value)) return null;
    out[f] = value;
  }
  return out;
}

/**
 * @param {string} path
 * @param {Map<string, CacheEntry>} cache
 */
export function saveCache(path, cache) {
  writeFileAtomic(
    path,
    JSON.stringify({ version: ROWS_VERSION, entries: Object.fromEntries(cache) }),
  );
}

/**
 * @param {SessionSource} src
 * @param {readonly string[]} roots
 * @param {string} remote
 * @returns {string}
 */
export function fingerprintOf(src, roots, remote) {
  const h = createHash("sha256");
  h.update(ROWS_VERSION);
  // このリポジトリのセッションかの判定は、ルートとリモートで変わる（worktree が増えたら判定し直す）
  h.update(JSON.stringify([[...roots].sort(), remote]));
  for (const f of [src.main, ...src.subagents]) {
    if (f) h.update(`${f.path}\u0000${f.size}\u0000${f.mtimeMs}\u0000`);
  }
  return h.digest("hex");
}

/**
 * @param {SessionSource} src
 * @returns {SessionSummary}
 */
function parseSource(src) {
  if (src.agent === "claude-code") {
    return parseClaudeSession(
      src.id,
      src.main ? src.main.path : null,
      src.subagents.map((f) => f.path),
    );
  }
  if (!src.main) throw new Error(`Codex のログのファイルが無い: ${src.id}`);
  return parseCodexSession(src.main.path, src.id);
}

/**
 * このリポジトリのセッションか（cwd がルートの中にあるか、Codex ならリモートが一致するか）。
 * @param {SessionSummary} s
 * @param {readonly string[]} roots
 * @param {string} remote
 * @returns {boolean}
 */
export function belongsToRepo(s, roots, remote) {
  if (s.cwds.some((c) => isInside(c, roots))) return true;
  if (s.agent === "codex" && remote !== "" && s.repoUrl !== "") {
    return normalizeRemote(s.repoUrl) === remote;
  }
  // サブエージェントのファイルしか残っていないセッションは cwd を持たないので、ディレクトリ名で候補になったことを根拠にする
  return s.agent === "claude-code" && s.cwds.length === 0 && s.subagent;
}

/**
 * @typedef {object} LocalResult
 * @property {Row[]} rows
 * @property {number} sessions 対象になったセッションの数
 * @property {number} parsed 解析し直したセッションの数
 * @property {number} invalidLines
 * @property {number} duplicateMessages 別のセッションと重複したので数えなかった応答の数
 * @property {{ ts: number; text: string }[]} commands エージェントが実行したコマンド（人の活動からエージェントの操作を除くのに使う）
 * @property {number[]} prompts 人の指示の時刻
 */

/**
 * @param {{ roots: string[]; remote: string; commonDir: string; env: NodeJS.ProcessEnv; ctx: Context; useCache: boolean }} opts
 * @returns {LocalResult}
 */
export function collectLocal(opts) {
  const { roots, remote, commonDir, env, ctx } = opts;
  const sources = [...discoverClaude(roots, env), ...discoverCodex(roots, remote, env, isInside)];
  const path = cachePath(commonDir);
  const cache = opts.useCache ? loadCache(path) : new Map();
  /** @type {Map<string, CacheEntry>} */
  const next = new Map();
  /** @type {SessionSummary[]} */
  const matched = [];
  let parsed = 0;
  for (const src of sources) {
    const cacheKey = `${src.agent}:${src.main ? src.main.path : src.id}`;
    const fp = fingerprintOf(src, roots, remote);
    let entry = cache.get(cacheKey);
    if (!entry || entry.fingerprint !== fp) {
      const s = parseSource(src);
      // コマンドは、人の活動からエージェントの git・gh の操作を除くのにだけ使うので、それだけを残す（キャッシュを小さくする）
      const summary = { ...s, commands: s.commands.filter((c) => AGENT_GIT_COMMAND.test(c.text)) };
      entry = { fingerprint: fp, summary: belongsToRepo(s, roots, remote) ? summary : null };
      parsed += 1;
    }
    next.set(cacheKey, entry);
    if (entry.summary) matched.push(entry.summary);
  }
  const claimsFile = claimsPath(commonDir);
  const claims = loadClaims(claimsFile);
  const before = claims.size;
  const { summaries, dropped } = dedupeSessions(matched, claims);
  /** @type {LocalResult} */
  const result = {
    rows: [],
    sessions: summaries.length,
    parsed,
    invalidLines: 0,
    duplicateMessages: dropped,
    commands: [],
    prompts: [],
  };
  for (const s of summaries) {
    result.rows.push(...usageRows(s, ctx), ...timelineRows(s, ctx));
    result.invalidLines += s.invalidLines;
    result.commands.push(...s.commands);
    if (!s.subagent) result.prompts.push(...s.prompts);
  }
  if (opts.useCache) saveCache(path, next);
  // claims はキャッシュではない（消すと、元のログが消えた応答をコピーの側で数え直す）ので、常に保存する
  if (claims.size !== before) saveClaims(claimsFile, claims);
  return result;
}
