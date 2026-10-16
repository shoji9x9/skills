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
import { emptySummary, touch } from "./session.mjs";
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
 * @param {string} text
 * @param {string} fallbackId ファイル名から取った id（session_meta が無いとき）
 * @returns {SessionSummary}
 */
export function parseCodexLog(text, fallbackId) {
  const s = emptySummary("codex", fallbackId);
  /** @type {Map<string, string>} */
  const turnModel = new Map();
  let currentModel = "";
  /** @type {Map<string, number>} */
  const pendingInputs = new Map();
  /** @type {import("./session.mjs").MessageUsage[]} */
  const fromRecords = [];
  /** @type {import("./session.mjs").MessageUsage[]} */
  const fromCounts = [];
  const seen = new Set();
  let index = 0;
  let seenMeta = false;
  let lastCountTotal = "";
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    index += 1;
    /** @type {unknown} */
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      s.invalidLines += 1;
      continue;
    }
    if (!isRecord(entry)) {
      s.invalidLines += 1;
      continue;
    }
    const ts = parseTime(entry.timestamp);
    if (ts === null) continue;
    touch(s, ts);
    const payload = isRecord(entry.payload) ? entry.payload : {};
    if (entry.type === "session_meta") {
      // サブエージェントのファイルは、自分の session_meta の後に親の session_meta のコピーを持つ。最初の 1 つだけを使う
      if (seenMeta) continue;
      seenMeta = true;
      if (typeof payload.id === "string" && payload.id !== "") s.sessionId = payload.id;
      if (typeof payload.cwd === "string" && payload.cwd !== "" && !s.cwds.includes(payload.cwd))
        s.cwds.push(payload.cwd);
      if (isRecord(payload.source)) s.subagent = true;
      const git = isRecord(payload.git) ? payload.git : {};
      if (typeof git.repository_url === "string") s.repoUrl = git.repository_url;
      if (typeof git.branch === "string" && git.branch !== "")
        s.branches.push({ ts, branch: git.branch });
      continue;
    }
    if (entry.type === "turn_context") {
      if (typeof payload.model === "string" && payload.model !== "") {
        currentModel = payload.model;
        if (typeof payload.turn_id === "string") turnModel.set(payload.turn_id, payload.model);
      }
      if (typeof payload.cwd === "string" && payload.cwd !== "" && !s.cwds.includes(payload.cwd))
        s.cwds.push(payload.cwd);
      continue;
    }
    if (entry.type === "token_usage_record") {
      const key =
        typeof payload.response_id === "string" && payload.response_id !== ""
          ? payload.response_id
          : "";
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      const turn = typeof payload.turn_id === "string" ? payload.turn_id : "";
      const model = turnModel.get(turn) || currentModel;
      if (model === "") continue;
      fromRecords.push({ key, ts, model, tokens: codexTokens(payload.usage) });
      continue;
    }
    if (entry.type === "event_msg") {
      if (payload.type === "token_count") {
        const info = isRecord(payload.info) ? payload.info : null;
        // 同じ応答の token_count が繰り返し記録されることがあるので、累計（total_token_usage）が前回と同じなら数えない
        const total =
          info && isRecord(info.total_token_usage) ? JSON.stringify(info.total_token_usage) : "";
        const repeated = total !== "" && total === lastCountTotal;
        if (total !== "") lastCountTotal = total;
        if (info && currentModel !== "" && !repeated) {
          fromCounts.push({
            key: `${fallbackId}:${index}`,
            ts,
            model: currentModel,
            tokens: codexTokens(info.last_token_usage),
          });
        }
      } else if (payload.type === "user_message") {
        s.prompts.push(ts);
      } else if (payload.type === "task_complete" || payload.type === "turn_aborted") {
        s.turnEnds.push(ts);
      }
      continue;
    }
    if (entry.type === "response_item") {
      if (payload.type === "function_call" || payload.type === "custom_tool_call") {
        const name = typeof payload.name === "string" ? payload.name : "";
        const callId = typeof payload.call_id === "string" ? payload.call_id : "";
        if (CODEX_HUMAN_INPUT_TOOLS.includes(name) && callId !== "") pendingInputs.set(callId, ts);
        const body =
          typeof payload.arguments === "string"
            ? payload.arguments
            : typeof payload.input === "string"
              ? payload.input
              : "";
        if (body !== "") s.commands.push({ ts, text: body });
      } else if (
        payload.type === "function_call_output" ||
        payload.type === "custom_tool_call_output"
      ) {
        const callId = typeof payload.call_id === "string" ? payload.call_id : "";
        const start = pendingInputs.get(callId);
        if (start !== undefined) {
          s.humanWaits.push({ start, end: ts, reason: "request_user_input" });
          pendingInputs.delete(callId);
        }
      }
    }
  }
  // token_usage_record のある版では token_count も同じ応答を数えるので、片方だけを使う
  s.messages = fromRecords.length > 0 ? fromRecords : fromCounts;
  if (s.subagent) {
    s.prompts = [];
    s.turnEnds = [];
    s.autoResumes = [];
    s.humanWaits = [];
  }
  for (const list of [s.prompts, s.turnEnds]) list.sort((a, b) => a - b);
  s.messages.sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key));
  return s;
}

/**
 * @param {string} path
 * @param {string} fallbackId
 * @returns {SessionSummary}
 */
export function parseCodexSession(path, fallbackId) {
  return parseCodexLog(readFileSync(path, "utf8"), fallbackId);
}
