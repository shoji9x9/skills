// Codex のセッションのログ（~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl）を、セッションの要約（session.mjs）にする。
//
// 読む行の種類:
//   session_meta          セッションの id・cwd・git（repository_url・branch）・source（サブエージェントなら object）。
//   turn_context          turn ごとのモデル。
//   token_usage_record    応答ごとの使用量（response_id で重複を除く）。無い古いログは event_msg の token_count を使う。
//   event_msg             user_message は人の指示、task_complete と turn_aborted は応答の完了。
//   response_item         function_call・custom_tool_call はエージェントのコマンド。request_user_input は人を待つ。
// OpenAI の数え方では、input_tokens はキャッシュに当たった分（cached_input_tokens）を含み、
// output_tokens は推論の分（reasoning_output_tokens）を含む。費用の計算に合わせて、input からキャッシュの分を引く。

import { readFileSync } from "node:fs";
import { isRecord } from "../config.mjs";
import { zeroTokens } from "../pricing.mjs";
import { emptySummary, parseLogLine, touch } from "./session.mjs";
import { parseTime } from "../time.mjs";

/** @typedef {import("./session.mjs").SessionSummary} SessionSummary */
/** @typedef {import("../pricing.mjs").Tokens} Tokens */

/** 人に入力を求めて待つツール。 */
export const CODEX_HUMAN_INPUT_TOOLS = ["request_user_input"];

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
export function codexTokens(usage) {
  const t = zeroTokens();
  if (!isRecord(usage)) return t;
  const input = num(usage.input_tokens);
  const cached = Math.min(num(usage.cached_input_tokens), input);
  t.input = input - cached;
  t.cacheRead = cached;
  t.cacheWrite5m = num(usage.cache_write_input_tokens);
  t.output = num(usage.output_tokens);
  t.reasoning = num(usage.reasoning_output_tokens);
  return t;
}

/**
 * @typedef {object} CodexLogState 1 ファイルを読む間の状態
 * @property {SessionSummary} s
 * @property {string} fallbackId
 * @property {Map<string, string>} turnModel turn_id ごとのモデル
 * @property {string} currentModel
 * @property {Map<string, number>} pendingInputs 人に入力を求めたツールの call_id と呼び出しの時刻
 * @property {import("./session.mjs").MessageUsage[]} fromRecords
 * @property {import("./session.mjs").MessageUsage[]} fromCounts
 * @property {Set<string>} seen
 * @property {number} index 空でない行の番号
 * @property {boolean} seenMeta
 * @property {string} lastCountTotal
 */

/**
 * @param {SessionSummary} s
 * @param {unknown} cwd
 */
function addCwd(s, cwd) {
  if (typeof cwd === "string" && cwd !== "" && !s.cwds.includes(cwd)) s.cwds.push(cwd);
}

/**
 * @param {CodexLogState} st
 * @param {Record<string, unknown>} payload
 * @param {number} ts
 */
function readSessionMeta(st, payload, ts) {
  const s = st.s;
  // サブエージェントのファイルは、自分の session_meta の後に親の session_meta のコピーを持つ。最初の 1 つだけを使う
  if (st.seenMeta) return;
  st.seenMeta = true;
  if (typeof payload.id === "string" && payload.id !== "") s.sessionId = payload.id;
  addCwd(s, payload.cwd);
  if (isRecord(payload.source)) s.subagent = true;
  const git = isRecord(payload.git) ? payload.git : {};
  if (typeof git.repository_url === "string") s.repoUrl = git.repository_url;
  if (typeof git.branch === "string" && git.branch !== "")
    s.branches.push({ ts, branch: git.branch });
}

/**
 * @param {CodexLogState} st
 * @param {Record<string, unknown>} payload
 */
function readTurnContext(st, payload) {
  if (typeof payload.model === "string" && payload.model !== "") {
    st.currentModel = payload.model;
    if (typeof payload.turn_id === "string") st.turnModel.set(payload.turn_id, payload.model);
  }
  addCwd(st.s, payload.cwd);
}

/**
 * @param {CodexLogState} st
 * @param {Record<string, unknown>} payload
 * @param {number} ts
 */
function readUsageRecord(st, payload, ts) {
  const key =
    typeof payload.response_id === "string" && payload.response_id !== ""
      ? payload.response_id
      : "";
  if (key === "" || st.seen.has(key)) return;
  st.seen.add(key);
  const turn = typeof payload.turn_id === "string" ? payload.turn_id : "";
  const model = st.turnModel.get(turn) || st.currentModel;
  if (model === "") return;
  st.fromRecords.push({ key, ts, model, tokens: codexTokens(payload.usage) });
}

/**
 * @param {CodexLogState} st
 * @param {Record<string, unknown>} payload
 * @param {number} ts
 */
function readTokenCount(st, payload, ts) {
  const info = isRecord(payload.info) ? payload.info : null;
  // 同じ応答の token_count が繰り返し記録されることがあるので、累計（total_token_usage）が前回と同じなら数えない
  const total =
    info && isRecord(info.total_token_usage) ? JSON.stringify(info.total_token_usage) : "";
  const repeated = total !== "" && total === st.lastCountTotal;
  if (total !== "") st.lastCountTotal = total;
  if (info && st.currentModel !== "" && !repeated) {
    st.fromCounts.push({
      key: `${st.fallbackId}:${st.index}`,
      ts,
      model: st.currentModel,
      tokens: codexTokens(info.last_token_usage),
    });
  }
}

/**
 * @param {CodexLogState} st
 * @param {Record<string, unknown>} payload
 * @param {number} ts
 */
function readEventMsg(st, payload, ts) {
  if (payload.type === "token_count") {
    readTokenCount(st, payload, ts);
  } else if (payload.type === "user_message") {
    st.s.prompts.push(ts);
  } else if (payload.type === "task_complete" || payload.type === "turn_aborted") {
    st.s.turnEnds.push(ts);
  }
}

/**
 * エージェントのツールの呼び出し。人に入力を求めるツールなら結果まで待ちとして覚え、本文をコマンドとして記録する。
 * @param {CodexLogState} st
 * @param {Record<string, unknown>} payload
 * @param {number} ts
 */
function readToolCall(st, payload, ts) {
  const name = typeof payload.name === "string" ? payload.name : "";
  const callId = typeof payload.call_id === "string" ? payload.call_id : "";
  if (CODEX_HUMAN_INPUT_TOOLS.includes(name) && callId !== "") st.pendingInputs.set(callId, ts);
  const body =
    typeof payload.arguments === "string"
      ? payload.arguments
      : typeof payload.input === "string"
        ? payload.input
        : "";
  if (body !== "") st.s.commands.push({ ts, text: body });
}

/**
 * ツールの結果。人に入力を求めたツールの結果なら、呼び出しからの区間を人を待った区間にする。
 * @param {CodexLogState} st
 * @param {Record<string, unknown>} payload
 * @param {number} ts
 */
function readToolOutput(st, payload, ts) {
  const callId = typeof payload.call_id === "string" ? payload.call_id : "";
  const start = st.pendingInputs.get(callId);
  if (start !== undefined) {
    st.s.humanWaits.push({ start, end: ts, reason: "request_user_input" });
    st.pendingInputs.delete(callId);
  }
}

/**
 * @param {CodexLogState} st
 * @param {Record<string, unknown>} payload
 * @param {number} ts
 */
function readResponseItem(st, payload, ts) {
  if (payload.type === "function_call" || payload.type === "custom_tool_call") {
    readToolCall(st, payload, ts);
  } else if (
    payload.type === "function_call_output" ||
    payload.type === "custom_tool_call_output"
  ) {
    readToolOutput(st, payload, ts);
  }
}

/**
 * ログの 1 行を要約に足す。
 * @param {CodexLogState} st
 * @param {Record<string, unknown>} entry
 */
function addCodexEntry(st, entry) {
  const ts = parseTime(entry.timestamp);
  if (ts === null) return;
  touch(st.s, ts);
  const payload = isRecord(entry.payload) ? entry.payload : {};
  if (entry.type === "session_meta") readSessionMeta(st, payload, ts);
  else if (entry.type === "turn_context") readTurnContext(st, payload);
  else if (entry.type === "token_usage_record") readUsageRecord(st, payload, ts);
  else if (entry.type === "event_msg") readEventMsg(st, payload, ts);
  else if (entry.type === "response_item") readResponseItem(st, payload, ts);
}

/**
 * 読み終えた状態から、使用量を選び、サブエージェントの区間を消して並べる。
 * @param {CodexLogState} st
 */
function finishCodexSummary(st) {
  const s = st.s;
  // token_usage_record のある版では token_count も同じ応答を数えるので、片方だけを使う
  s.messages = st.fromRecords.length > 0 ? st.fromRecords : st.fromCounts;
  if (s.subagent) {
    s.prompts = [];
    s.turnEnds = [];
    s.autoResumes = [];
    s.humanWaits = [];
  }
  for (const list of [s.prompts, s.turnEnds]) list.sort((a, b) => a - b);
  s.messages.sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key));
}

/**
 * @param {string} text
 * @param {string} fallbackId ファイル名から取った id（session_meta が無いとき）
 * @returns {SessionSummary}
 */
export function parseCodexLog(text, fallbackId) {
  /** @type {CodexLogState} */
  const st = {
    s: emptySummary("codex", fallbackId),
    fallbackId,
    turnModel: new Map(),
    currentModel: "",
    pendingInputs: new Map(),
    fromRecords: [],
    fromCounts: [],
    seen: new Set(),
    index: 0,
    seenMeta: false,
    lastCountTotal: "",
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    st.index += 1;
    const entry = parseLogLine(st.s, line);
    if (entry) addCodexEntry(st, entry);
  }
  finishCodexSummary(st);
  return st.s;
}

/**
 * @param {string} path
 * @param {string} fallbackId
 * @returns {SessionSummary}
 */
export function parseCodexSession(path, fallbackId) {
  return parseCodexLog(readFileSync(path, "utf8"), fallbackId);
}
