// Claude Code のセッションのログ（~/.claude/projects/<dir>/<session>.jsonl と <session>/subagents/*.jsonl）を、
// セッションの要約（session.mjs）にする。
//
// 読む行の種類:
//   assistant      応答。message.id ごとに使用量を持つ。ストリーミングで同じ id の行が複数あるので、欄ごとの最大を取る。
//   user           人の指示・ツールの結果・自動の入力。origin.kind（human・task-notification・peer）で区別する。
//                  origin の無い古い行は、isMeta と本文の先頭のタグで区別する。
//   system         subtype が turn_duration なら応答の完了、scheduled_task_fire なら予約した再開。
//   cost-state     セッションの累計の費用（Claude Code 自身の計算）。時刻を持たない。
// ツールの結果の行の permissionDecision.source が user_ で始まれば、人が権限を判断した（その間は人を待っていた）。

import { readFileSync } from "node:fs";
import { isArray } from "../is-array.mjs";
import { isRecord } from "../config.mjs";
import { normalizeModel, zeroTokens } from "../pricing.mjs";
import { emptySummary, parseLogLine, touch } from "./session.mjs";
import { parseTime } from "../time.mjs";

/** @typedef {import("./session.mjs").SessionSummary} SessionSummary */
/** @typedef {import("../pricing.mjs").Tokens} Tokens */

/** 人に質問して答えを待つツール。呼び出しから結果までは人を待っている。 */
export const HUMAN_INPUT_TOOLS = ["AskUserQuestion"];

/** origin の無い古い行で、人の指示ではない入力の本文の先頭。 */
const AUTOMATIC_PREFIXES = [
  "<task-notification>",
  "<local-command-",
  "Another Claude session sent a message",
];

/**
 * @param {unknown} v
 * @returns {number}
 */
function num(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * @param {unknown} usage
 * @returns {Tokens}
 */
export function claudeTokens(usage) {
  const t = zeroTokens();
  if (!isRecord(usage)) return t;
  t.input = num(usage.input_tokens);
  t.cacheRead = num(usage.cache_read_input_tokens);
  t.output = num(usage.output_tokens);
  const cc = usage.cache_creation;
  if (isRecord(cc)) {
    t.cacheWrite5m = num(cc.ephemeral_5m_input_tokens);
    t.cacheWrite1h = num(cc.ephemeral_1h_input_tokens);
  } else {
    t.cacheWrite5m = num(usage.cache_creation_input_tokens);
  }
  const details = usage.output_tokens_details;
  if (isRecord(details)) t.reasoning = num(details.thinking_tokens);
  return t;
}

/**
 * @param {Tokens} a
 * @param {Tokens} b
 * @returns {Tokens}
 */
function maxTokens(a, b) {
  return {
    input: Math.max(a.input, b.input),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheWrite5m: Math.max(a.cacheWrite5m, b.cacheWrite5m),
    cacheWrite1h: Math.max(a.cacheWrite1h, b.cacheWrite1h),
    output: Math.max(a.output, b.output),
    reasoning: Math.max(a.reasoning, b.reasoning),
  };
}

/**
 * user の行の本文の先頭の文字列（ツールの結果なら null）。
 * @param {unknown} content
 * @returns {string | null}
 */
function userText(content) {
  if (typeof content === "string") return content;
  if (!isArray(content) || content.length === 0) return "";
  const first = content[0];
  if (!isRecord(first)) return "";
  if (first.type === "tool_result") return null;
  return typeof first.text === "string" ? first.text : "";
}

/**
 * @typedef {"human" | "auto" | "other"} UserKind
 */

/**
 * user の行が、人の指示か、自動の再開か、それ以外（ツールの結果・注入された文脈）か。
 * @param {Record<string, unknown>} entry
 * @returns {UserKind}
 */
export function classifyUserEntry(entry) {
  const message = isRecord(entry.message) ? entry.message : {};
  const text = userText(message.content);
  if (text === null) return "other";
  const origin = entry.origin;
  if (isRecord(origin) && typeof origin.kind === "string") {
    if (origin.kind === "human") return "human";
    if (origin.kind === "task-notification" || origin.kind === "peer") return "auto";
    return "other";
  }
  if (entry.isMeta === true) return "other";
  if (text.startsWith("<task-notification>")) return "auto";
  if (AUTOMATIC_PREFIXES.some((p) => text.startsWith(p))) return "other";
  if (text.trim() === "") return "other";
  return "human";
}

/**
 * @typedef {object} ClaudeLogState 1 ファイルを読む間の状態
 * @property {SessionSummary} s
 * @property {boolean} main メインのファイルか（false ならサブエージェントのファイル）
 * @property {Map<string, { ts: number; model: string; tokens: Tokens }>} byId
 * @property {Map<string, { ts: number; name: string }>} toolUses
 * @property {number} lastTs
 * @property {string} lastBranch
 */

/**
 * @typedef {object} ClaudeRow 時刻を持つ 1 行
 * @property {Record<string, unknown>} entry
 * @property {Record<string, unknown> | null} message
 * @property {number} ts
 */

/**
 * cost-state の 1 モデルの使用量。
 * @param {Record<string, unknown>} u
 * @returns {Tokens}
 */
function costStateTokens(u) {
  const tokens = zeroTokens();
  tokens.input = num(u.inputTokens);
  tokens.output = num(u.outputTokens);
  tokens.cacheRead = num(u.cacheReadInputTokens);
  tokens.cacheWrite5m = num(u.cacheCreationInputTokens);
  tokens.reasoning = num(u.thinkingTokens);
  return tokens;
}

/**
 * 正規化すると同じ名前になるモデルの費用と使用量を足す。
 * @param {{ costUSD: number; tokens: Tokens }} prev
 * @param {number} cost
 * @param {Tokens} tokens
 */
function addModelCost(prev, cost, tokens) {
  prev.costUSD += cost;
  prev.tokens.input += tokens.input;
  prev.tokens.output += tokens.output;
  prev.tokens.cacheRead += tokens.cacheRead;
  prev.tokens.cacheWrite5m += tokens.cacheWrite5m;
  prev.tokens.reasoning += tokens.reasoning;
}

/**
 * cost-state の modelUsage を、正規化したモデルの名前ごとの費用と使用量にまとめる。
 * @param {Record<string, unknown>} modelUsage
 * @returns {Record<string, { costUSD: number; tokens: Tokens }>}
 */
function costStateModels(modelUsage) {
  /** @type {Record<string, { costUSD: number; tokens: Tokens }>} */
  const models = {};
  for (const [model, u] of Object.entries(modelUsage)) {
    if (!isRecord(u)) continue;
    const name = normalizeModel(model);
    const prev = models[name];
    const tokens = costStateTokens(u);
    const cost = num(u.costUSD);
    if (prev) addModelCost(prev, cost, tokens);
    else models[name] = { costUSD: cost, tokens };
  }
  return models;
}

/**
 * cost-state の行（時刻を持たない）を、直前の行の時刻の費用の記録にする。
 * @param {ClaudeLogState} st
 * @param {Record<string, unknown>} entry
 */
function addCostState(st, entry) {
  if (st.main && isRecord(entry.modelUsage) && Number.isFinite(st.lastTs)) {
    st.s.costSnapshots.push({ ts: st.lastTs, models: costStateModels(entry.modelUsage) });
  }
}

/**
 * メインのファイルの行から、作業ディレクトリとブランチの切り替わりを記録する。
 * @param {ClaudeLogState} st
 * @param {ClaudeRow} row
 */
function recordPlace(st, row) {
  const { entry, ts } = row;
  const s = st.s;
  if (typeof entry.cwd === "string" && entry.cwd !== "" && !s.cwds.includes(entry.cwd))
    s.cwds.push(entry.cwd);
  if (
    typeof entry.gitBranch === "string" &&
    entry.gitBranch !== "" &&
    entry.gitBranch !== st.lastBranch
  ) {
    st.lastBranch = entry.gitBranch;
    s.branches.push({ ts, branch: entry.gitBranch });
  }
}

/**
 * 応答の使用量を message.id ごとに足す。ストリーミングで同じ id の行が複数あるので、欄ごとの最大を取る。
 * @param {ClaudeLogState} st
 * @param {Record<string, unknown>} message
 * @param {number} ts
 */
function recordUsage(st, message, ts) {
  const id = typeof message.id === "string" ? message.id : "";
  const model = typeof message.model === "string" ? message.model : "";
  if (id === "" || model === "" || model === "<synthetic>") return;
  const tokens = claudeTokens(message.usage);
  const prev = st.byId.get(id);
  st.byId.set(
    id,
    prev ? { ts: prev.ts, model, tokens: maxTokens(prev.tokens, tokens) } : { ts, model, tokens },
  );
}

/**
 * 応答のツールの呼び出しを、結果と対応づけるために覚え、コマンドを記録する。
 * @param {ClaudeLogState} st
 * @param {unknown} content
 * @param {number} ts
 */
function recordToolUses(st, content, ts) {
  if (!isArray(content)) return;
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_use" || typeof block.id !== "string") continue;
    const name = typeof block.name === "string" ? block.name : "";
    st.toolUses.set(block.id, { ts, name });
    const input = isRecord(block.input) ? block.input : {};
    if (typeof input.command === "string") st.s.commands.push({ ts, text: input.command });
  }
}

/**
 * ツールの結果の行から、人を待った区間（人への質問と、人が判断した権限の確認）を記録する。
 * @param {ClaudeLogState} st
 * @param {ClaudeRow} row
 */
function recordToolResults(st, row) {
  const { entry, ts } = row;
  const content = row.message?.content;
  if (!isArray(content)) return;
  const decision = isRecord(entry.permissionDecision) ? entry.permissionDecision : {};
  const byUser = typeof decision.source === "string" && decision.source.startsWith("user");
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_result" || typeof block.tool_use_id !== "string")
      continue;
    const use = st.toolUses.get(block.tool_use_id);
    if (!use) continue;
    if (HUMAN_INPUT_TOOLS.includes(use.name)) {
      st.s.humanWaits.push({ start: use.ts, end: ts, reason: use.name });
    } else if (byUser) {
      st.s.humanWaits.push({ start: use.ts, end: ts, reason: "permission" });
    }
  }
}

/**
 * メインのファイルの、サイドチェーンでない system と user の行を読む。
 * @param {ClaudeLogState} st
 * @param {ClaudeRow} row
 */
function recordMainEntry(st, row) {
  const { entry, message, ts } = row;
  const s = st.s;
  if (entry.type === "system") {
    if (entry.subtype === "turn_duration") s.turnEnds.push(ts);
    else if (entry.subtype === "scheduled_task_fire") s.autoResumes.push(ts);
    return;
  }
  if (entry.type !== "user" || !message) return;
  recordToolResults(st, row);
  // 利用者が応答を中断した（Esc）。turn_duration が記録されないので、ここを応答の完了にする
  if (userText(message.content)?.startsWith("[Request interrupted by user") === true) {
    s.interrupts.push(ts);
    return;
  }
  const kind = classifyUserEntry(entry);
  if (kind === "human") s.prompts.push(ts);
  else if (kind === "auto") s.autoResumes.push(ts);
}

/**
 * ログの 1 行を要約に足す。
 * @param {ClaudeLogState} st
 * @param {Record<string, unknown>} entry
 */
function addClaudeEntry(st, entry) {
  if (entry.type === "cost-state") {
    addCostState(st, entry);
    return;
  }
  const ts = parseTime(entry.timestamp);
  if (ts === null) return;
  st.lastTs = ts;
  touch(st.s, ts);
  /** @type {ClaudeRow} */
  const row = { entry, message: isRecord(entry.message) ? entry.message : null, ts };
  if (st.main) recordPlace(st, row);
  if (entry.type === "assistant" && row.message) {
    recordUsage(st, row.message, ts);
    recordToolUses(st, row.message.content, ts);
    return;
  }
  if (!st.main || entry.isSidechain === true) return;
  recordMainEntry(st, row);
}

/**
 * ログの 1 ファイルを要約に足す。main が false ならサブエージェントのファイルで、使用量とコマンドだけを読む。
 * @param {SessionSummary} s
 * @param {string} text
 * @param {boolean} main
 */
export function addClaudeLog(s, text, main) {
  /** @type {ClaudeLogState} */
  const st = {
    s,
    main,
    byId: new Map(s.messages.map((m) => [m.key, { ts: m.ts, model: m.model, tokens: m.tokens }])),
    toolUses: new Map(),
    lastTs: Number.NEGATIVE_INFINITY,
    lastBranch: s.branches.length > 0 ? s.branches[s.branches.length - 1].branch : "",
  };
  for (const line of text.split("\n")) {
    const entry = parseLogLine(s, line);
    if (entry) addClaudeEntry(st, entry);
  }
  s.messages = [...st.byId.entries()].map(([key, m]) => ({
    key,
    ts: m.ts,
    model: m.model,
    tokens: m.tokens,
  }));
}

/**
 * セッションのファイル（と、サブエージェントのファイル）を読んで要約にする。
 * @param {string} sessionId
 * @param {string | null} mainPath メインのファイル。サブエージェントのファイルしか残っていなければ null
 * @param {readonly string[]} subagentPaths
 * @returns {SessionSummary}
 */
export function parseClaudeSession(sessionId, mainPath, subagentPaths) {
  const s = emptySummary("claude-code", sessionId);
  if (mainPath) addClaudeLog(s, readFileSync(mainPath, "utf8"), true);
  else s.subagent = true;
  for (const p of subagentPaths) addClaudeLog(s, readFileSync(p, "utf8"), false);
  for (const list of [s.prompts, s.turnEnds, s.interrupts, s.autoResumes])
    list.sort((a, b) => a - b);
  s.humanWaits.sort((a, b) => a.start - b.start);
  s.messages.sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key));
  return s;
}
