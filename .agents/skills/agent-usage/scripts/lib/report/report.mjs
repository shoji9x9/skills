// report: records/ の行を集計し、report/<yyyyMMdd>/ に HTML と 3 つの CSV を書く。
//
// 稼働状況（人ごと）:
//   人の稼働の区間（run）をすべてのセッション・エージェントで合わせ、その区間を稼働中、隙間を停止とする。
//   停止の各部分を、次の順で最初に当たったものに分類する。
//     reviewing    人の活動（指示・人を待った区間の終わり・人の commit・GitHub での自分の操作）の前後 activityWindowMinutes 分。
//     ci-wait      直前に動いていたブランチの CI が実行中。
//     review-wait  直前に動いていたブランチの PR のレビューを待っている。
//     unknown      GitHub の情報を取得できていない期間（coverage が ok でない）。
//     idle         それ以外（未活用）。
//   集計の期間の終わりは、人ごとに、その人のタイムゾーンでの until の日の終わりか、report を実行した時刻の早い方。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRepoConfig, loadUserConfig } from "../config.mjs";
import { toCsv } from "../csv.mjs";
import { RUN_BINS, STATUSES, STOP_CATEGORIES } from "./categories.mjs";
import {
  costOf,
  loadBundledPricing,
  loadBundledReviewPricing,
  resolvePrice,
  resolveReviewPrice,
} from "../pricing.mjs";
import { renderHtml } from "./html.mjs";
import { latestByKey, readRecords, usageDir } from "../records.mjs";
import {
  QUARTER_HOUR,
  localParts,
  parseTime,
  splitByLocalHour,
  systemTimeZone,
  toIso,
} from "../time.mjs";

/** @typedef {import("../rows.mjs").Row} Row */
/** @typedef {import("../config.mjs").RepoConfig} RepoConfig */
/** @typedef {import("./categories.mjs").StopCategory} StopCategory */
/** @typedef {import("./categories.mjs").Status} Status */

/** @typedef {[number, number]} Span */

/**
 * 区間を並べて重なりをまとめる。
 * @param {Span[]} spans
 * @returns {Span[]}
 */
export function mergeSpans(spans) {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  /** @type {Span[]} */
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * [from, to) から、spans に覆われた部分を除いた隙間。
 * @param {Span[]} merged mergeSpans の結果
 * @param {number} from
 * @param {number} to
 * @returns {Span[]}
 */
export function gaps(merged, from, to) {
  /** @type {Span[]} */
  const out = [];
  let cur = from;
  for (const [a, b] of merged) {
    if (b <= cur) continue;
    if (a >= to) break;
    if (a > cur) out.push([cur, Math.min(a, to)]);
    cur = Math.max(cur, b);
    if (cur >= to) break;
  }
  if (cur < to) out.push([cur, to]);
  return out;
}

/**
 * span を、層ごとの区間で切り分けて分類する。layers は優先度の順で、最初に覆う層の分類にする。
 * @param {Span} span
 * @param {{ category: StopCategory; spans: Span[] }[]} layers spans は mergeSpans 済み
 * @param {StopCategory} fallback
 * @returns {{ start: number; end: number; category: StopCategory }[]}
 */
export function classifySpan(span, layers, fallback) {
  const cuts = new Set([span[0], span[1]]);
  for (const l of layers) {
    for (const [a, b] of l.spans) {
      if (a > span[0] && a < span[1]) cuts.add(a);
      if (b > span[0] && b < span[1]) cuts.add(b);
    }
  }
  const points = [...cuts].sort((a, b) => a - b);
  /** @type {{ start: number; end: number; category: StopCategory }[]} */
  const out = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [a, b] = [points[i], points[i + 1]];
    const mid = (a + b) / 2;
    const hit = layers.find((l) => l.spans.some(([x, y]) => mid >= x && mid < y));
    const category = hit ? hit.category : fallback;
    const last = out[out.length - 1];
    if (last && last.category === category && last.end === a) last.end = b;
    else out.push({ start: a, end: b, category });
  }
  return out;
}

/**
 * @param {Row} r
 * @returns {Span | null}
 */
function spanOf(r) {
  const a = parseTime(r.start);
  const b = parseTime(r.end);
  return a === null || b === null ? null : [a, Math.max(a, b)];
}

/**
 * 行の区間をまとめて取る（時刻を読めない行は除く）。
 * @param {readonly Row[]} rows
 * @returns {Span[]}
 */
function spansOf(rows) {
  /** @type {Span[]} */
  const out = [];
  for (const r of rows) {
    const s = spanOf(r);
    if (s) out.push(s);
  }
  return out;
}

/**
 * 時刻 t の前後 w ミリ秒の区間。
 * @param {number} t
 * @param {number} w
 * @returns {Span}
 */
function around(t, w) {
  return [t - w, t + w];
}

/**
 * タイムゾーンでの日付 date の終わり（次の日になる最初の時刻）。15 分刻みで探す。
 * @param {string} date YYYY-MM-DD
 * @param {string} tz
 * @returns {number}
 */
export function endOfLocalDate(date, tz) {
  let t = Date.parse(`${date}T00:00:00Z`) - 15 * 3600000;
  while (localParts(t, tz).date <= date) t += QUARTER_HOUR;
  return t;
}

/**
 * @param {string | null} date YYYY-MM-DD
 * @returns {boolean}
 */
function isDate(date) {
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  // 形だけでは、月が 0 の日付や 2 月 30 日が通るので、暦に在る日付かを往復で確かめる
  const t = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === date;
}

/**
 * 期間の最初の日と最後の日。指定が無い側は、記録のうち最も古い日付・最も新しい日付（行のタイムゾーンで切る）にする。
 * GitHub を取得した期間の行（coverage）は作業の記録ではないので数えない。
 * @param {readonly Row[]} rows 期間で絞った後の行
 * @param {{ since: string | null; until: string | null; tz: string }} o
 * @returns {{ from: string | null; to: string | null }}
 */
export function periodBounds(rows, o) {
  /** @type {string[]} */
  const dates = [];
  for (const r of rows) {
    if (r.kind === "coverage") continue;
    for (const v of [r.start, r.end]) {
      const t = parseTime(v);
      if (t !== null) dates.push(localParts(t, r.tz || o.tz).date);
    }
  }
  const { min, max } = dateBounds(dates);
  return { from: o.since ?? min, to: o.until ?? max };
}

/**
 * 日付（YYYY-MM-DD）の最初と最後。日付が無ければどちらも null にする。
 * @param {readonly string[]} dates
 * @returns {{ min: string | null; max: string | null }}
 */
export function dateBounds(dates) {
  /** @type {string | null} */
  let min = null;
  /** @type {string | null} */
  let max = null;
  for (const date of dates) {
    if (min === null || date < min) min = date;
    if (max === null || date > max) max = date;
  }
  return { min, max };
}

/**
 * 期間の最初の日と最後の日から、期間の表示を作る。どちらかが無ければ「記録なし」とする。
 * @param {string | null} from
 * @param {string | null} to
 * @returns {string}
 */
export function formatPeriod(from, to) {
  if (from === null || to === null) return "記録なし";
  return `${from} 〜 ${to}`;
}

/**
 * from から to までのすべての日付（両端を含む）。暦の日付なので、タイムゾーンに依らない。
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 * @returns {string[]}
 */
export function dateRange(from, to) {
  const out = [];
  // 文字列で比べると、10000 年からの toISOString（+010000-...）が to より後にならず終わらないので、時刻で比べる
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * @typedef {object} ReportData
 * @property {string} generatedAt
 * @property {string} tz
 * @property {string} period
 * @property {number} recordFiles
 * @property {number} rows
 * @property {Record<string, string>} names 人の ID → 表示名
 * @property {Record<string, string>[]} usage usage.csv の行
 * @property {Record<string, string>[]} intervals intervals.csv の行
 * @property {Record<string, string>[]} reviews reviews.csv の行
 * @property {{ status: Status; byHour: number[] }[]} statusByHour 稼働中と停止の時間（時）を、時刻（0〜23 時）ごとに
 * @property {string[]} days 期間のすべての日付（記録の無い日を含む）。日別のチャートの横軸にする
 * @property {{ status: Status; byDay: number[] }[]} statusByDay 稼働中と停止の時間（時）を、days の日ごとに
 * @property {Record<string, number>} activeByPerson 人の ID → 稼働中の時間（時）
 * @property {Record<string, number>} activeByIssue Issue（無ければ空文字）→ 稼働中の時間（時）。同時に動いていた Issue の数で等分した値
 * @property {Record<string, number>} idleByIssue Issue（無ければ空文字）→ 直前に動いていた指示がその Issue だった未活用の時間（時。丸める前の値）
 * @property {Record<string, Map<StopCategory, number>>} stopByPerson 人の ID → 停止の分類ごとの時間（時。丸める前の値）
 * @property {number[]} runHistogram RUN_BINS ごとの件数
 * @property {{ date: string; model: string; cost: number }[]} dailyCost
 * @property {number} unknownCostBuckets 費用が単価不明の usage の行の数
 */

/**
 * @param {readonly Row[]} allRows
 * @param {{ config: RepoConfig; bundledPricing: Record<string, import("../config.mjs").Price>; bundledReviewPricing: Record<string, number>; tz: string; now: number; since: string | null; until: string | null; recordFiles: number }} o
 * @returns {ReportData}
 */
export function buildReport(allRows, o) {
  // observed_at の最も新しい行が打ち消しの行（retracted=1）なら、その key を数えない
  const latest = [...latestByKey(allRows).values()].filter((r) => r.retracted !== "1");
  const alias = (/** @type {string | undefined} */ p) => (p ? (o.config.aliases[p] ?? p) : "");
  const inPeriod = (/** @type {Row} */ r) => {
    const t = parseTime(r.start);
    if (t === null) return false;
    const date = localParts(t, r.tz || o.tz).date;
    if (o.since && date < o.since) return false;
    if (o.until && date > o.until) return false;
    return true;
  };
  const rows = latest.filter(inPeriod);
  /** @type {Record<string, string>} */
  const names = {};
  for (const r of rows) {
    const p = alias(r.person);
    if (p !== "" && !(p in names)) names[p] = o.config.people[p]?.name ?? p;
  }

  // 費用
  const TOKEN_COLUMNS = /** @type {const} */ ([
    "input_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "output_tokens",
    "reasoning_tokens",
    "messages",
  ]);
  /**
   * @typedef {object} UsageAcc
   * @property {string} date
   * @property {string} person
   * @property {string} agent
   * @property {string} model
   * @property {Record<(typeof TOKEN_COLUMNS)[number], number>} sums
   * @property {number} cost
   * @property {number} unknown
   * @property {Set<string>} sources
   */
  /** @type {Map<string, UsageAcc>} */
  const usage = new Map();
  /** @type {Map<string, number>} */
  const daily = new Map();
  let unknownCostBuckets = 0;
  for (const r of rows.filter((x) => x.kind === "usage")) {
    const t = parseTime(r.start) ?? 0;
    const date = localParts(t, r.tz || o.tz).date;
    const person = alias(r.person);
    const agent = r.agent ?? "";
    const model = r.model ?? "";
    const key = [date, person, agent, model].join("\u0000");
    let u = usage.get(key);
    if (!u) {
      u = {
        date,
        person,
        agent,
        model,
        sums: {
          input_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          output_tokens: 0,
          reasoning_tokens: 0,
          messages: 0,
        },
        cost: 0,
        unknown: 0,
        sources: new Set(),
      };
      usage.set(key, u);
    }
    for (const c of TOKEN_COLUMNS) u.sums[c] += Number(r[c] || 0);
    // 記録の時点で単価が無かった行は、今の単価表（リポジトリの設定・同梱）で計算し直す。
    // キャッシュの書き込みは 5 分と 1 時間を 1 列にまとめて記録しているので、5 分の単価で数える
    let cost = r.cost_usd === "" || r.cost_usd === undefined ? null : Number(r.cost_usd);
    let sources = (r.cost_source ?? "").split("+").filter(Boolean);
    if (cost === null) {
      const { price, source } = resolvePrice(model, o.config.pricing, o.bundledPricing);
      if (price) {
        const tokens = {
          input: Number(r.input_tokens || 0),
          cacheRead: Number(r.cache_read_tokens || 0),
          cacheWrite5m: Number(r.cache_write_tokens || 0),
          cacheWrite1h: 0,
          output: Number(r.output_tokens || 0),
          reasoning: 0,
        };
        cost = costOf(tokens, price);
        sources = [`${source}@report`];
      }
    }
    for (const src of sources) u.sources.add(src);
    // 単価のある応答と単価不明の応答が混在する行（cost_source に unknown を含む）も、費用が足りないので単価不明に数える
    if (cost === null || sources.includes("unknown")) {
      u.unknown += 1;
      unknownCostBuckets += 1;
    }
    if (cost !== null) {
      u.cost += cost;
      const dk = `${date}\u0000${model}`;
      daily.set(dk, (daily.get(dk) ?? 0) + cost);
    }
  }
  /** @type {Record<string, string>[]} */
  const usageOut = [...usage.values()]
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.person.localeCompare(b.person) ||
        a.agent.localeCompare(b.agent) ||
        a.model.localeCompare(b.model),
    )
    .map((u) => ({
      date: u.date,
      person: u.person,
      name: names[u.person] ?? u.person,
      agent: u.agent,
      model: u.model,
      ...Object.fromEntries(TOKEN_COLUMNS.map((c) => [c, String(u.sums[c])])),
      cost_usd: u.cost.toFixed(6),
      cost_unknown_buckets: String(u.unknown),
      cost_sources: [...u.sources].sort().join("+"),
    }));
  const dailyCost = [...daily.entries()].map(([k, cost]) => {
    const [date, model] = k.split("\u0000");
    return { date, model, cost };
  });

  // 稼働と停止
  const windowMs = o.config.activityWindowMinutes * 60000;
  /** @type {Record<string, string>[]} */
  const intervals = [];
  const runHistogram = RUN_BINS.map(() => 0);
  /** @type {Map<Status, number[]>} */
  const byHour = new Map(STATUSES.map((c) => [c, Array.from({ length: 24 }, () => 0)]));
  /** @type {Map<Status, Map<string, number>>} */
  const byDate = new Map(STATUSES.map((c) => [c, new Map()]));
  /**
   * 区間を時刻ごとと日ごとに足す。どちらも同じ正時の区切りで分ける（日をまたぐ区間は、それぞれの日に入る）。
   * @param {Status} status
   * @param {number} start
   * @param {number} end
   * @param {string} tz
   */
  const addStatus = (status, start, end, tz) => {
    for (const h of splitByLocalHour(start, end, tz)) {
      const hours = (h.end - h.start) / 3600000;
      const arr = byHour.get(status);
      if (arr) arr[h.hour] += hours;
      const days = byDate.get(status);
      const date = h.date;
      if (days) days.set(date, (days.get(date) ?? 0) + hours);
    }
  };
  // coverage は期間で絞る前の行から取る（期間の初めの停止に、前日までの取得が当たる）
  const coverageAll = mergeSpans(
    spansOf(latest.filter((r) => r.kind === "coverage" && r.detail === "ok")),
  );
  // CI とレビュー待ちの区間は、ブランチごとに 1 回だけまとめる（停止の隙間ごとに全行を走査しない）
  /**
   * @param {string} kind
   * @returns {Map<string, Span[]>}
   */
  const spansByBranch = (kind) => {
    /** @type {Map<string, Span[]>} */
    const byBranch = new Map();
    for (const r of latest) {
      if (r.kind !== kind || !r.branch) continue;
      const s = spanOf(r);
      if (!s) continue;
      const list = byBranch.get(r.branch) ?? [];
      list.push(s);
      byBranch.set(r.branch, list);
    }
    return new Map([...byBranch].map(([b, list]) => [b, mergeSpans(list)]));
  };
  const ciByBranch = spansByBranch("ci");
  const reviewWaitByBranch = spansByBranch("review-wait");
  const people = [
    ...new Set(rows.filter((r) => r.kind === "run").map((r) => alias(r.person))),
  ].sort();
  /** @type {Record<string, number>} */
  const activeByPerson = {};
  /** @type {Record<string, number>} */
  const activeByIssue = {};
  /** @type {Record<string, Map<StopCategory, number>>} */
  const stopByPerson = {};
  /** @type {Record<string, number>} */
  const idleByIssue = {};
  for (const person of people) {
    const mine = rows.filter((r) => alias(r.person) === person);
    const runs = mine
      .filter((r) => r.kind === "run")
      .flatMap((r) => {
        const s = spanOf(r);
        return s ? [{ row: r, span: s }] : [];
      })
      .sort((a, b) => a.span[0] - b.span[0]);
    for (const { row, span } of runs) {
      const minutes = (span[1] - span[0]) / 60000;
      const bin = RUN_BINS.findIndex((b) => minutes < b.max);
      runHistogram[bin] += 1;
      intervals.push({
        type: "run",
        person,
        name: names[person] ?? person,
        start: toIso(span[0]),
        end: toIso(span[1]),
        minutes: minutes.toFixed(1),
        active_minutes: ((span[1] - span[0] - Number(row.wait_ms || 0)) / 60000).toFixed(1),
        category: (row.detail ?? "").includes("open") ? "running" : "run",
        agent: row.agent ?? "",
        session: row.session ?? "",
        branch: row.branch ?? "",
        issue: row.issue ?? "",
      });
    }
    if (runs.length === 0) continue;
    const tz = runs[0].row.tz || o.tz;
    // 稼働状況は、1 人を 1 つのタイムゾーン（期間で絞った後の、その人の最初の run のタイムゾーン）で数える。
    // 日付の分け方も期間の終わり（そのタイムゾーンでの --until の日の終わり）も、このタイムゾーンで決める
    const periodEnd = o.until ? Math.min(o.now, endOfLocalDate(o.until, tz)) : o.now;
    // 行を期間で絞るのは行ごとのタイムゾーンなので、記録が複数のタイムゾーンにまたがると、別のタイムゾーンの行として期間に入った run が
    // 期間の終わりより後に始まりうる。その run は稼働状況（稼働中と停止）に数えない。指示の数とヒストグラムには、期間に入った行として数える
    const statusRuns = runs.filter((r) => r.span[0] < periodEnd);
    // 稼働状況に数える run が無い人も、人ごとの稼働中と停止は 0 として持つ
    activeByPerson[person] = 0;
    stopByPerson[person] = new Map(STOP_CATEGORIES.map((c) => [c, 0]));
    if (statusRuns.length === 0) continue;
    const merged = mergeSpans(statusRuns.map((r) => r.span));
    // 稼働中は、重なる run をまとめた区間（停止はこの隙間なので、稼働中と停止は重ならない）。期間の終わりで打ち切る
    let active = 0;
    for (const [a, b] of merged) {
      const end = Math.min(b, periodEnd);
      if (end <= a) continue;
      addStatus("active", a, end, tz);
      active += (end - a) / 3600000;
    }
    activeByPerson[person] = active;
    const myStops = new Map(STOP_CATEGORIES.map((c) => [c, 0]));
    stopByPerson[person] = myStops;
    // Issue ごとの稼働中は、人ごとの稼働中を、その時間に動いていた Issue の数で等分して配る（Issue ごとの合計が人ごとの稼働中と一致する）。
    // run の始まりと終わりを時刻の順に走査し、動いている run の数を Issue ごとに増減させる
    /** @type {[number, number, string][]} */
    const events = [];
    for (const { row, span } of statusRuns) {
      const end = Math.min(span[1], periodEnd);
      if (end > span[0]) events.push([span[0], 1, row.issue ?? ""], [end, -1, row.issue ?? ""]);
    }
    events.sort((x, y) => x[0] - y[0]);
    /** @type {Map<string, number>} */
    const running = new Map();
    for (let i = 0; i < events.length; i += 1) {
      const [t, delta, issue] = events[i];
      const count = (running.get(issue) ?? 0) + delta;
      if (count > 0) running.set(issue, count);
      else running.delete(issue);
      const next = i + 1 < events.length ? events[i + 1][0] : t;
      if (next <= t || running.size === 0) continue;
      for (const k of running.keys())
        activeByIssue[k] = (activeByIssue[k] ?? 0) + (next - t) / 3600000 / running.size;
    }
    /** @type {Span[]} */
    const marks = [];
    for (const r of mine) {
      const t =
        r.kind === "prompt" || r.kind === "activity"
          ? parseTime(r.start)
          : r.kind === "human-wait"
            ? parseTime(r.end)
            : null;
      if (t !== null) marks.push(around(t, windowMs));
    }
    const presence = mergeSpans(marks);
    // その人がまだ collect していない時間を停止に数えない（最後に記録した時刻で打ち切る）
    const lastSeen = mine.reduce(
      (a, r) => Math.max(a, parseTime(r.observed_at ?? "") ?? Number.NEGATIVE_INFINITY),
      Number.NEGATIVE_INFINITY,
    );
    const personEnd = Number.isFinite(lastSeen) ? Math.min(periodEnd, lastSeen) : periodEnd;
    // 期間に入れた run は期間の終わりより前に始まるので、run の間の隙間は期間の終わりより前に収まる。
    // 最後の run の後の隙間も、personEnd（期間の終わりより後にならない）までである
    for (const gap of gaps(
      merged,
      merged[0][0],
      Math.max(personEnd, merged[merged.length - 1][1]),
    )) {
      // 直前に動いていた run は、隙間の前に最も遅く終わったもの（runs は始まりの順なので、末尾が最後に終わったとは限らない）
      /** @type {(typeof runs)[number] | undefined} */
      let before;
      for (const r of statusRuns) {
        if (r.span[1] <= gap[0] && (!before || r.span[1] >= before.span[1])) before = r;
      }
      const branch = before ? (before.row.branch ?? "") : "";
      const ci = ciByBranch.get(branch) ?? [];
      const reviewWait = reviewWaitByBranch.get(branch) ?? [];
      const uncovered = gaps(coverageAll, gap[0], gap[1]);
      const pieces = classifySpan(
        gap,
        [
          { category: "reviewing", spans: presence },
          { category: "ci-wait", spans: ci },
          { category: "review-wait", spans: reviewWait },
          { category: "unknown", spans: uncovered },
        ],
        "idle",
      );
      for (const p of pieces) {
        intervals.push({
          type: "stop",
          person,
          name: names[person] ?? person,
          start: toIso(p.start),
          end: toIso(p.end),
          minutes: ((p.end - p.start) / 60000).toFixed(1),
          active_minutes: "",
          category: p.category,
          agent: before ? (before.row.agent ?? "") : "",
          session: before ? (before.row.session ?? "") : "",
          branch,
          issue: before ? (before.row.issue ?? "") : "",
        });
        addStatus(p.category, p.start, p.end, tz);
        // 人ごとの表と Issue ごとの表も、丸める前の値から足す（intervals.csv の minutes は小数第 1 位に丸めてある）
        myStops.set(p.category, (myStops.get(p.category) ?? 0) + (p.end - p.start) / 3600000);
        if (p.category === "idle") {
          const issue = before ? (before.row.issue ?? "") : "";
          idleByIssue[issue] = (idleByIssue[issue] ?? 0) + (p.end - p.start) / 3600000;
        }
      }
    }
  }
  intervals.sort((a, b) => a.start.localeCompare(b.start) || a.person.localeCompare(b.person));

  // レビュー
  const reviews = rows
    .filter((r) => r.kind === "review" || r.kind === "billing")
    .map((r) => {
      const detail = Object.fromEntries((r.detail ?? "").split(";").map((kv) => kv.split("=")));
      const type =
        r.kind === "billing" ? "billing" : detail.source === "artifact" ? "usage" : "review";
      // 記録の時点で推定額の無かったレビューは、今の単価（リポジトリの設定・同梱）で推定し直す
      let cost = r.cost_usd ?? "";
      let costSource = r.cost_source ?? "";
      if (type === "review" && cost === "") {
        const est = resolveReviewPrice(
          r.agent ?? "",
          o.config.reviewPricing,
          o.bundledReviewPricing,
        );
        if (est.cost !== null) {
          cost = est.cost.toFixed(6);
          costSource = `${est.source}@report`;
        }
      }
      return {
        type,
        date: localParts(parseTime(r.start) ?? 0, r.tz || o.tz).date,
        tool: r.agent ?? "",
        model: r.model ?? "",
        pr: detail.pr ?? "",
        author: detail.author ?? "",
        branch: r.branch ?? "",
        issue: r.issue ?? "",
        cost_usd: cost,
        cost_source: costSource,
        detail: r.detail ?? "",
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.tool.localeCompare(b.tool));

  // 日別のチャートの横軸。停止は observed_at まで続くので、記録の最後の日より後の日にも置かれうる
  const valueDates = [
    ...dailyCost.map((x) => x.date),
    ...[...byDate.values()].flatMap((m) => [...m.keys()]),
  ];
  // 期間の表示と横軸は、ここから days までの式で決める。
  // 範囲は、記録の日に、値を置いた日（停止が記録の最後の日より後まで続いた日など）を足したものにする。
  // --since・--until を指定した側も、横軸は値のある日まで広げる。記録が複数のタイムゾーンにまたがると期間の外の日に値が置かれうるので、
  // 外すと日別のチャートとタイルが、人ごとの表・時刻ごとのチャートより小さくなる。期間の表示は指定した日付のままにする
  const { min: valueMin, max: valueMax } = dateBounds(valueDates);
  const { from, to } = periodBounds(rows, o);
  const first = from !== null && valueMin !== null && valueMin < from ? valueMin : from;
  const widened = to !== null && valueMax !== null && valueMax > to ? valueMax : to;
  // --until を指定したときは、終わりを今日（report のタイムゾーン）か値のある最後の日の遅い方までにする。
  // 値は report を実行した時刻より後に置かれないので、--until に先の日付を渡しても、0 しか無い日を並べない。
  // 指定しないときの終わりは記録と値の日なので打ち切らない（別のタイムゾーンの行で今日より後の日付になっても、期間の表示の始まりより前にならない）
  const today = localParts(o.now, o.tz).date;
  const cap = valueMax !== null && valueMax > today ? valueMax : today;
  const last = o.until !== null && widened !== null && widened > cap ? cap : widened;
  const days = first !== null && last !== null ? dateRange(first, last) : [];

  return {
    generatedAt: toIso(o.now),
    tz: o.tz,
    // --until を指定しない側は、横軸と同じ最後の日を出す
    period: formatPeriod(o.since ?? first, o.until ?? last),
    recordFiles: o.recordFiles,
    rows: rows.length,
    names,
    usage: usageOut,
    intervals,
    reviews,
    statusByHour: STATUSES.map((c) => ({ status: c, byHour: byHour.get(c) ?? [] })),
    days,
    statusByDay: STATUSES.map((c) => ({
      status: c,
      byDay: days.map((date) => byDate.get(c)?.get(date) ?? 0),
    })),
    activeByPerson,
    activeByIssue,
    stopByPerson,
    idleByIssue,
    runHistogram,
    dailyCost,
    unknownCostBuckets,
  };
}

export const USAGE_COLUMNS = [
  "date",
  "person",
  "name",
  "agent",
  "model",
  "input_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "output_tokens",
  "reasoning_tokens",
  "messages",
  "cost_usd",
  "cost_unknown_buckets",
  "cost_sources",
];
export const INTERVAL_COLUMNS = [
  "type",
  "category",
  "person",
  "name",
  "start",
  "end",
  "minutes",
  "active_minutes",
  "agent",
  "session",
  "branch",
  "issue",
];
export const REVIEW_COLUMNS = [
  "type",
  "date",
  "tool",
  "model",
  "pr",
  "author",
  "branch",
  "issue",
  "cost_usd",
  "cost_source",
  "detail",
];

/**
 * @param {{ root: string; now: number; env: NodeJS.ProcessEnv; since: string | null; until: string | null; out: string | null }} o
 * @returns {{ files: string[]; rows: number; period: string }}
 */
export function runReport(o) {
  for (const [name, v] of /** @type {const} */ ([
    ["--since", o.since],
    ["--until", o.until],
  ])) {
    if (v !== null && !isDate(v)) throw new Error(`${name} は YYYY-MM-DD で書く`);
  }
  if (o.since && o.until && o.since > o.until)
    throw new Error("--since が --until より後になっている");
  const dir = usageDir(o.root);
  const config = loadRepoConfig(o.root, o.env);
  // report は人の設定を読むだけで作らない（作ると、setup を通らずに乱数の ID ができる）
  const tz = loadUserConfig(o.root, o.env)?.timeZone ?? systemTimeZone();
  const { rows, files } = readRecords(join(dir, "records"));
  if (files === 0) throw new Error(`${join(dir, "records")} に記録が無い。先に collect を実行する`);
  const data = buildReport(rows, {
    config,
    bundledPricing: loadBundledPricing(),
    bundledReviewPricing: loadBundledReviewPricing(),
    tz,
    now: o.now,
    since: o.since,
    until: o.until,
    recordFiles: files,
  });
  const day = localParts(o.now, tz).date.replaceAll("-", "");
  const outDir = o.out ?? join(dir, "report", day);
  mkdirSync(outDir, { recursive: true });
  const written = [
    [join(outDir, "usage.csv"), toCsv(USAGE_COLUMNS, data.usage, { formulaSafe: true })],
    [join(outDir, "intervals.csv"), toCsv(INTERVAL_COLUMNS, data.intervals, { formulaSafe: true })],
    [join(outDir, "reviews.csv"), toCsv(REVIEW_COLUMNS, data.reviews, { formulaSafe: true })],
    [join(outDir, "index.html"), renderHtml(data)],
  ];
  for (const [p, text] of written) writeFileSync(p, text);
  return { files: written.map(([p]) => p), rows: data.rows, period: data.period };
}
