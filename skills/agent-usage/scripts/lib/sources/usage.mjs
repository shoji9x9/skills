// セッションの要約から、明細の行（usage・run・human-wait・prompt）を作る。
//
// 費用の決め方:
//   Claude Code で cost-state があれば、その時刻までの応答の費用の合計を、モデルごとに cost-state の値に合わせる。
//   各応答への配分は、単価表で計算した費用の比（単価が無ければ proxyWeight の比）で行う。cost_source は log。
//   cost-state より後の応答と、Codex の応答は、単価表で計算する。cost_source は repo か bundled。単価が無ければ unknown（費用は空欄）。
//   cost-state にあって応答の記録が無いモデル（自動モードの分類などの内部の呼び出し）は、cost-state の時刻の行にまとめる。

import {
  addTokens,
  costOf,
  normalizeModel,
  proxyWeight,
  resolvePrice,
  zeroTokens,
} from "../pricing.mjs";
import { fmt } from "../rows.mjs";
import { branchAt, issueOf } from "./session.mjs";
import { buildRuns } from "./timeline.mjs";
import { HOUR, localHourStart, toIso } from "../time.mjs";

/** @typedef {import("./session.mjs").SessionSummary} SessionSummary */
/** @typedef {import("../pricing.mjs").Tokens} Tokens */
/** @typedef {import("../pricing.mjs").Price} Price */
/** @typedef {import("../rows.mjs").Row} Row */

/**
 * @typedef {object} Context
 * @property {string} person
 * @property {string} tz
 * @property {Record<string, Price>} repoPricing
 * @property {Record<string, Price>} bundledPricing
 */

/**
 * 応答ごとの費用と、その出所。
 * @param {SessionSummary} s
 * @param {Context} ctx
 * @returns {{ cost: number | null; source: string }[]}
 */
export function messageCosts(s, ctx) {
  /** @type {{ cost: number | null; source: string }[]} */
  const priced = s.messages.map((m) => {
    const { price, source } = resolvePrice(m.model, ctx.repoPricing, ctx.bundledPricing);
    return { cost: price ? costOf(m.tokens, price) : null, source };
  });
  const snap = s.costSnapshots.length > 0 ? s.costSnapshots[s.costSnapshots.length - 1] : null;
  if (!snap) return priced;
  for (const [model, total] of Object.entries(snap.models)) {
    const idx = s.messages.flatMap((m, i) =>
      normalizeModel(m.model) === model && m.ts <= snap.ts ? [i] : [],
    );
    if (idx.length === 0) continue;
    const allPriced = idx.every((i) => priced[i].cost !== null);
    const weights = idx.map((i) =>
      allPriced ? (priced[i].cost ?? 0) : proxyWeight(s.messages[i].tokens),
    );
    const sum = weights.reduce((a, b) => a + b, 0);
    idx.forEach((i, k) => {
      priced[i] = {
        cost: sum > 0 ? (total.costUSD * weights[k]) / sum : total.costUSD / idx.length,
        source: "log",
      };
    });
  }
  return priced;
}

/**
 * モデル・現地の正時・ブランチごとに応答をまとめたもの。
 * @typedef {{ model: string; hour: number; branch: string; tokens: Tokens; cost: number; unknown: boolean; sources: Set<string>; count: number; first: number }} Bucket
 */

/**
 * @param {SessionSummary} s
 * @param {Context} ctx
 * @returns {Row[]}
 */
export function usageRows(s, ctx) {
  return [...bucketRows(s, ctx, usageBuckets(s, ctx)), ...costStateRows(s, ctx)];
}

/**
 * 応答を、モデル・現地の正時・ブランチごとのバケットにまとめる。
 * @param {SessionSummary} s
 * @param {Context} ctx
 * @returns {Map<string, Bucket>}
 */
function usageBuckets(s, ctx) {
  const costs = messageCosts(s, ctx);
  /** @type {Map<string, Bucket>} */
  const buckets = new Map();
  s.messages.forEach((m, i) => {
    // 現地の正時で区切る（日付に切るときに、日付の境目をまたがない。整数時間のオフセットなら UTC の正時と同じ）
    const hour = localHourStart(m.ts, ctx.tz);
    // 1 時間の途中でブランチを切り替えたら、メッセージごとのブランチで分ける
    const branch = branchAt(s, m.ts);
    const key = `${m.model}\u0000${hour}\u0000${branch}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        model: m.model,
        hour,
        branch,
        tokens: zeroTokens(),
        cost: 0,
        unknown: false,
        sources: new Set(),
        count: 0,
        first: m.ts,
      };
      buckets.set(key, b);
    }
    addTokens(b.tokens, m.tokens);
    const c = costs[i];
    if (c.cost === null) b.unknown = true;
    else b.cost += c.cost;
    b.sources.add(c.source);
    b.count += 1;
  });
  return buckets;
}

/**
 * バケットごとの usage の行。
 * @param {SessionSummary} s
 * @param {Context} ctx
 * @param {Map<string, Bucket>} buckets
 * @returns {Row[]}
 */
function bucketRows(s, ctx, buckets) {
  // モデルと時間ごとに、最初に応答したブランチの行は、ブランチで分ける前と同じ key にする。
  // 既に記録した行を次の collect がその key で上書きする（latestByKey）ので、二重に数えない。
  // メッセージは時刻の順に並んでいる（claude-log.mjs・codex-log.mjs）ので、first はバケットの最初のメッセージの時刻になる
  /** @type {Map<string, number>} */
  const earliest = new Map();
  for (const b of buckets.values()) {
    const mh = `${b.model}\u0000${b.hour}`;
    earliest.set(mh, Math.min(earliest.get(mh) ?? Infinity, b.first));
  }
  /** @type {Row[]} */
  const rows = [];
  for (const b of buckets.values()) {
    const branch = b.branch;
    const base = `usage:${s.agent}:${s.sessionId}:${b.model}:${toIso(b.hour)}`;
    // ブランチは時刻で 1 つに決まるので、first が同じ行は 1 つしかない
    const firstOfHour = earliest.get(`${b.model}\u0000${b.hour}`) === b.first;
    rows.push({
      key: firstOfHour ? base : `${base}:${branch}`,
      kind: "usage",
      person: ctx.person,
      agent: s.agent,
      session: s.sessionId,
      subagent: s.subagent ? "1" : "",
      model: b.model,
      start: toIso(b.hour),
      end: toIso(b.hour + HOUR),
      tz: ctx.tz,
      branch,
      issue: issueOf(branch),
      input_tokens: fmt(b.tokens.input),
      cache_read_tokens: fmt(b.tokens.cacheRead),
      cache_write_tokens: fmt(b.tokens.cacheWrite5m + b.tokens.cacheWrite1h),
      output_tokens: fmt(b.tokens.output),
      reasoning_tokens: fmt(b.tokens.reasoning),
      messages: String(b.count),
      cost_usd: b.unknown && b.cost === 0 ? "" : fmt(b.cost, true),
      cost_source: [...b.sources].sort().join("+"),
    });
  }
  return rows;
}

/**
 * cost-state にあって応答の記録が無いモデルの行。
 * @param {SessionSummary} s
 * @param {Context} ctx
 * @returns {Row[]}
 */
function costStateRows(s, ctx) {
  const snap = s.costSnapshots.length > 0 ? s.costSnapshots[s.costSnapshots.length - 1] : null;
  if (!snap) return [];
  /** @type {Row[]} */
  const rows = [];
  const seen = new Set(s.messages.map((m) => normalizeModel(m.model)));
  for (const [model, total] of Object.entries(snap.models)) {
    if (seen.has(model)) continue;
    const hour = localHourStart(snap.ts, ctx.tz);
    const branch = branchAt(s, snap.ts);
    rows.push({
      key: `usage:${s.agent}:${s.sessionId}:${model}:cost-state`,
      kind: "usage",
      person: ctx.person,
      agent: s.agent,
      session: s.sessionId,
      subagent: s.subagent ? "1" : "",
      model,
      start: toIso(hour),
      end: toIso(hour + HOUR),
      tz: ctx.tz,
      branch,
      issue: issueOf(branch),
      input_tokens: fmt(total.tokens.input),
      cache_read_tokens: fmt(total.tokens.cacheRead),
      cache_write_tokens: fmt(total.tokens.cacheWrite5m + total.tokens.cacheWrite1h),
      output_tokens: fmt(total.tokens.output),
      reasoning_tokens: fmt(total.tokens.reasoning),
      messages: "0",
      cost_usd: fmt(total.costUSD, true),
      cost_source: "log",
      detail: "cost-state",
    });
  }
  return rows;
}

/**
 * 稼働の区間・人を待った区間・人の指示の行。
 * @param {SessionSummary} s
 * @param {Context} ctx
 * @returns {Row[]}
 */
export function timelineRows(s, ctx) {
  if (s.subagent) return [];
  /** @type {Row[]} */
  const rows = [];
  /**
   * @param {number} t
   * @returns {{ branch: string; issue: string }}
   */
  const where = (t) => {
    const branch = branchAt(s, t);
    return { branch, issue: issueOf(branch) };
  };
  const base = { person: ctx.person, agent: s.agent, session: s.sessionId, tz: ctx.tz };
  for (const r of buildRuns(s)) {
    rows.push({
      key: `run:${s.agent}:${s.sessionId}:${toIso(r.start)}`,
      kind: "run",
      ...base,
      start: toIso(r.start),
      end: toIso(r.end),
      ...where(r.start),
      wait_ms: String(r.waitMs),
      detail: `${r.trigger}${r.open ? ";open" : ""}`,
    });
  }
  for (const w of s.humanWaits) {
    rows.push({
      key: `human-wait:${s.agent}:${s.sessionId}:${toIso(w.start)}`,
      kind: "human-wait",
      ...base,
      start: toIso(w.start),
      end: toIso(w.end),
      ...where(w.start),
      detail: w.reason,
    });
  }
  for (const t of s.prompts) {
    rows.push({
      key: `prompt:${s.agent}:${s.sessionId}:${toIso(t)}`,
      kind: "prompt",
      ...base,
      start: toIso(t),
      end: toIso(t),
      ...where(t),
    });
  }
  return rows;
}
