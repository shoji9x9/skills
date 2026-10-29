// collect の本体（ローカルのログ）。ログを探して要約にし、明細の行を作る（まだ記録していない行を、今のブランチのファイルに足すのは run-collect.mjs）。
//
// キャッシュ: <git の共通のディレクトリ>/agent-usage/cache.json に、セッションごとの要約を、
// ログのファイルの大きさと更新時刻・このツールのバージョンから作った指紋と一緒に置く。
// 指紋が同じセッションは解析し直さない。キャッシュは消しても結果は変わらない（作り直すだけ）。
// 行は、セッションをまたいだ重複を除いて（dedupe.mjs）から、毎回すべての要約から作る。

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.mjs";
import { isArray } from "./is-array.mjs";
import { isRecord } from "./config.mjs";
import { parseClaudeSession } from "./sources/claude-log.mjs";
import { parseCodexSession } from "./sources/codex-log.mjs";
import { claimsPath, dedupeSessions, loadClaims, saveClaims } from "./dedupe.mjs";
import { discoverClaude, discoverCodex } from "./sources/discover.mjs";
import { zeroTokens } from "./pricing.mjs";
import { isInside, normalizeRemote } from "./repo.mjs";
import { emptySummary } from "./sources/session.mjs";
import { timelineRows, usageRows } from "./sources/usage.mjs";

/** @typedef {import("./rows.mjs").Row} Row */
/** @typedef {import("./sources/discover.mjs").SessionSource} SessionSource */
/** @typedef {import("./sources/usage.mjs").Context} Context */
/** @typedef {import("./sources/session.mjs").SessionSummary} SessionSummary */
/** @typedef {import("./pricing.mjs").Tokens} Tokens */

/** @type {(keyof Tokens)[]} */
const TOKEN_FIELDS = ["input", "cacheRead", "cacheWrite5m", "cacheWrite1h", "output", "reasoning"];
const AGENT_GIT_COMMAND = /\bgit\b|\bgh\b/;

/** 要約の作り方を変えたら上げる（古いキャッシュを使わないため）。 */
export const ROWS_VERSION = "4";

/**
 * @typedef {object} CacheEntry
 * @property {string} fingerprint
 * @property {SessionSummary | null} summary このリポジトリのセッションでなければ null
 * @property {Probe | null} probe このリポジトリのセッションかを判定し直すための材料（summary が null のときだけ持つ）
 */

/**
 * ルートやリモートが変わったときに、解析し直さずに判定し直すための材料。
 * @typedef {object} Probe
 * @property {"claude-code" | "codex"} agent
 * @property {string} sessionId
 * @property {boolean} subagent
 * @property {string[]} cwds
 * @property {string} repoUrl
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
      const probe = probeFromCache(v.probe);
      if (probe) out.set(k, { fingerprint: v.fingerprint, summary: null, probe });
      continue;
    }
    const summary = summaryFromCache(v.summary);
    // 読めない要素は、そのセッションを解析し直す（キャッシュは消しても結果が変わらない）
    if (summary) out.set(k, { fingerprint: v.fingerprint, summary, probe: null });
  }
  return out;
}

/**
 * @param {unknown} v
 * @returns {v is number & { readonly __isNum: true }}
 */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * @param {unknown} v
 * @returns {Probe | null}
 */
function probeFromCache(v) {
  if (!isRecord(v)) return null;
  const agent = v.agent;
  if (agent !== "claude-code" && agent !== "codex") return null;
  if (typeof v.sessionId !== "string" || typeof v.subagent !== "boolean") return null;
  if (typeof v.repoUrl !== "string") return null;
  const cwds = listOf(v.cwds, (c) => (typeof c === "string" ? c : null));
  if (!cwds) return null;
  return { agent, sessionId: v.sessionId, subagent: v.subagent, cwds, repoUrl: v.repoUrl };
}

/**
 * キャッシュに置いた要約を読む。形が違えば null（JSON にすると無限大は null になるので戻す）。
 * @param {unknown} v
 * @returns {SessionSummary | null}
 */
export function summaryFromCache(v) {
  if (!isRecord(v)) return null;
  const head = summaryHeadOf(v);
  const lists = head ? summaryListsOf(v) : null;
  if (!head || !lists) return null;
  return {
    agent: head.agent,
    sessionId: head.sessionId,
    subagent: head.subagent,
    cwds: lists.cwds,
    repoUrl: head.repoUrl,
    branches: lists.branches,
    messages: lists.messages,
    costSnapshots: lists.costSnapshots,
    prompts: lists.prompts,
    turnEnds: lists.turnEnds,
    interrupts: lists.interrupts,
    autoResumes: lists.autoResumes,
    humanWaits: lists.humanWaits,
    commands: lists.commands,
    firstTs: head.firstTs,
    lastTs: head.lastTs,
    invalidLines: head.invalidLines,
  };
}

/**
 * 要約のうち、配列でない値を読む。形が違えば null。
 * @param {Record<string, unknown>} v
 * @returns {Pick<SessionSummary, "agent" | "sessionId" | "subagent" | "repoUrl" | "firstTs" | "lastTs" | "invalidLines"> | null}
 */
function summaryHeadOf(v) {
  const agent = v.agent;
  if (agent !== "claude-code" && agent !== "codex") return null;
  if (typeof v.sessionId !== "string" || typeof v.subagent !== "boolean") return null;
  if (typeof v.repoUrl !== "string" || !isNum(v.invalidLines)) return null;
  const firstTs = v.firstTs === null ? Number.POSITIVE_INFINITY : v.firstTs;
  const lastTs = v.lastTs === null ? Number.NEGATIVE_INFINITY : v.lastTs;
  if (typeof firstTs !== "number" || typeof lastTs !== "number") return null;
  return {
    agent,
    sessionId: v.sessionId,
    subagent: v.subagent,
    repoUrl: v.repoUrl,
    firstTs,
    lastTs,
    invalidLines: v.invalidLines,
  };
}

/**
 * 要約の配列の値を読む。1 つでも読めなければ null。
 * @param {Record<string, unknown>} v
 */
function summaryListsOf(v) {
  const cwds = listOf(v.cwds, stringOrNull);
  const prompts = listOf(v.prompts, numOrNull);
  const turnEnds = listOf(v.turnEnds, numOrNull);
  const interrupts = listOf(v.interrupts, numOrNull);
  const autoResumes = listOf(v.autoResumes, numOrNull);
  const branches = listOf(v.branches, branchOf);
  const messages = listOf(v.messages, messageOf);
  const costSnapshots = listOf(v.costSnapshots, costSnapshotOf);
  const humanWaits = listOf(v.humanWaits, humanWaitOf);
  const commands = listOf(v.commands, commandOf);
  if (
    !cwds ||
    !prompts ||
    !turnEnds ||
    !interrupts ||
    !autoResumes ||
    !branches ||
    !messages ||
    !costSnapshots ||
    !humanWaits ||
    !commands
  )
    return null;
  return {
    cwds,
    prompts,
    turnEnds,
    interrupts,
    autoResumes,
    branches,
    messages,
    costSnapshots,
    humanWaits,
    commands,
  };
}

/**
 * @param {unknown} c
 * @returns {string | null}
 */
function stringOrNull(c) {
  return typeof c === "string" ? c : null;
}

/**
 * @param {unknown} b
 * @returns {{ ts: number; branch: string } | null}
 */
function branchOf(b) {
  return isRecord(b) && isNum(b.ts) && typeof b.branch === "string"
    ? { ts: b.ts, branch: b.branch }
    : null;
}

/**
 * @param {unknown} m
 * @returns {{ key: string; ts: number; model: string; tokens: Tokens } | null}
 */
function messageOf(m) {
  if (!isRecord(m) || typeof m.key !== "string" || !isNum(m.ts) || typeof m.model !== "string")
    return null;
  const tokens = tokensOf(m.tokens);
  return tokens ? { key: m.key, ts: m.ts, model: m.model, tokens } : null;
}

/**
 * @param {unknown} c
 * @returns {{ ts: number; models: Record<string, { costUSD: number; tokens: Tokens }> } | null}
 */
function costSnapshotOf(c) {
  if (!isRecord(c) || !isNum(c.ts) || !isRecord(c.models)) return null;
  /** @type {Record<string, { costUSD: number; tokens: Tokens }>} */
  const models = {};
  for (const [name, x] of Object.entries(c.models)) {
    const tokens = isRecord(x) ? tokensOf(x.tokens) : null;
    if (!isRecord(x) || !isNum(x.costUSD) || !tokens) return null;
    models[name] = { costUSD: x.costUSD, tokens };
  }
  return { ts: c.ts, models };
}

/**
 * @param {unknown} w
 * @returns {{ start: number; end: number; reason: string } | null}
 */
function humanWaitOf(w) {
  return isRecord(w) && isNum(w.start) && isNum(w.end) && typeof w.reason === "string"
    ? { start: w.start, end: w.end, reason: w.reason }
    : null;
}

/**
 * @param {unknown} c
 * @returns {{ ts: number; text: string } | null}
 */
function commandOf(c) {
  return isRecord(c) && isNum(c.ts) && typeof c.text === "string"
    ? { ts: c.ts, text: c.text }
    : null;
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
 * @returns {string}
 */
export function fingerprintOf(src) {
  const h = createHash("sha256");
  h.update(ROWS_VERSION);
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
 * @property {Set<string>} presentSessions メインのログが今もあるこのリポジトリのセッション（`<agent>:<session>`。重複を除く前）。
 *   サブエージェントのログしか残っていないセッションは含めない（指示・稼働・待ちの行と、サブエージェントの応答の無い時間帯の使用量を作れないだけなので）
 */

/**
 * @param {{ roots: string[]; remote: string; commonDir: string; env: NodeJS.ProcessEnv; ctx: Context; useCache: boolean }} opts
 * @returns {LocalResult}
 */
export function collectLocal(opts) {
  const { roots, remote, commonDir, env, ctx } = opts;
  const sources = [
    ...discoverClaude(roots, env),
    ...discoverCodex({ roots, remote, env, inside: isInside }),
  ];
  const path = cachePath(commonDir);
  const cache = opts.useCache ? loadCache(path) : new Map();
  const scan = scanSources(sources, cache, { roots, remote });
  const claimsFile = claimsPath(commonDir);
  const claims = loadClaims(claimsFile);
  const before = claims.size;
  const { summaries, dropped } = dedupeSessions(scan.matched, claims);
  const result = localResult({ summaries, dropped, scan, ctx });
  if (opts.useCache) saveCache(path, scan.next);
  // claims はキャッシュではない（消すと、元のログが消えた応答をコピーの側で数え直す）ので、常に保存する
  if (claims.size !== before) saveClaims(claimsFile, claims);
  return result;
}

/**
 * @typedef {object} SourceScan
 * @property {Map<string, CacheEntry>} next 次に保存するキャッシュ
 * @property {SessionSummary[]} matched このリポジトリのセッションの要約（重複を除く前）
 * @property {number} parsed 解析し直したセッションの数
 */

/**
 * ログごとに、キャッシュの要約を使うか解析し直して、このリポジトリのセッションの要約を集める。
 * @param {readonly SessionSource[]} sources
 * @param {Map<string, CacheEntry>} cache
 * @param {{ roots: string[]; remote: string }} repo
 * @returns {SourceScan}
 */
function scanSources(sources, cache, repo) {
  /** @type {Map<string, CacheEntry>} */
  const next = new Map();
  /** @type {SessionSummary[]} */
  const matched = [];
  let parsed = 0;
  for (const src of sources) {
    const cacheKey = `${src.agent}:${src.main ? src.main.path : src.id}`;
    const fp = fingerprintOf(src);
    let entry = cache.get(cacheKey);
    if (!entry || entry.fingerprint !== fp || probeNowMatches(entry, repo)) {
      entry = parsedEntry(src, fp, repo);
      parsed += 1;
    }
    next.set(cacheKey, entry);
    if (entry.summary) matched.push(entry.summary);
  }
  return { next, matched, parsed };
}

/**
 * ルートやリモートが変わって、このリポジトリのセッションになったものは解析し直す（判定は材料だけで行い、全件を解析し直さない）
 * @param {CacheEntry} entry
 * @param {{ roots: string[]; remote: string }} repo
 * @returns {boolean}
 */
function probeNowMatches(entry, repo) {
  return entry.probe
    ? belongsToRepo(
        { ...emptySummary(entry.probe.agent, entry.probe.sessionId), ...entry.probe },
        repo.roots,
        repo.remote,
      )
    : false;
}

/**
 * ログを解析し、キャッシュに置く形にする。このリポジトリのセッションでなければ、判定し直すための材料だけを残す。
 * @param {SessionSource} src
 * @param {string} fp
 * @param {{ roots: string[]; remote: string }} repo
 * @returns {CacheEntry}
 */
function parsedEntry(src, fp, repo) {
  const s = parseSource(src);
  // コマンドは、人の活動からエージェントの git・gh の操作を除くのにだけ使うので、それだけを残す（キャッシュを小さくする）
  const summary = { ...s, commands: s.commands.filter((c) => AGENT_GIT_COMMAND.test(c.text)) };
  return belongsToRepo(s, repo.roots, repo.remote)
    ? { fingerprint: fp, summary, probe: null }
    : {
        fingerprint: fp,
        summary: null,
        probe: {
          agent: s.agent,
          sessionId: s.sessionId,
          subagent: s.subagent,
          cwds: s.cwds,
          repoUrl: s.repoUrl,
        },
      };
}

/**
 * 重複を除いた要約から、行と件数をまとめる。
 * @param {{ summaries: SessionSummary[]; dropped: number; scan: SourceScan; ctx: Context }} o
 * @returns {LocalResult}
 */
function localResult(o) {
  const { summaries, scan, ctx } = o;
  /** @type {LocalResult} */
  const result = {
    rows: [],
    sessions: summaries.length,
    parsed: scan.parsed,
    invalidLines: 0,
    duplicateMessages: o.dropped,
    commands: [],
    prompts: [],
    presentSessions: new Set(
      scan.matched.filter((s) => !s.subagent).map((s) => `${s.agent}:${s.sessionId}`),
    ),
  };
  for (const s of summaries) {
    result.rows.push(...usageRows(s, ctx), ...timelineRows(s, ctx));
    result.invalidLines += s.invalidLines;
    result.commands.push(...s.commands);
    if (!s.subagent) result.prompts.push(...s.prompts);
  }
  return result;
}
