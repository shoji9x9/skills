// report: records/ の行を集計し、report/<yyyyMMdd>/ に HTML と 3 つの CSV と、渡した期間を記録した meta.json を書く。
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
import { loadRepoConfig, loadUserConfig, resolved } from "../config.mjs";
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
 * span の両端と、span の中にある層の区間の端を、時刻の順に並べた切れ目。
 * @param {Span} span
 * @param {{ spans: Span[] }[]} layers
 * @returns {number[]}
 */
function cutPoints(span, layers) {
  const cuts = new Set([span[0], span[1]]);
  for (const l of layers) {
    for (const [a, b] of l.spans) {
      if (a > span[0] && a < span[1]) cuts.add(a);
      if (b > span[0] && b < span[1]) cuts.add(b);
    }
  }
  return [...cuts].sort((a, b) => a - b);
}

/**
 * span を、層ごとの区間で切り分けて分類する。layers は優先度の順で、最初に覆う層の分類にする。
 * @param {Span} span
 * @param {{ category: StopCategory; spans: Span[] }[]} layers spans は mergeSpans 済み
 * @param {StopCategory} fallback
 * @returns {{ start: number; end: number; category: StopCategory }[]}
 */
export function classifySpan(span, layers, fallback) {
  const points = cutPoints(span, layers);
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
 * @property {string | null} since 指定した --since（省いたときは null）
 * @property {string | null} until 指定した --until（省いたときは null）
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

/** @typedef {{ config: RepoConfig; bundledPricing: Record<string, import("../config.mjs").Price>; bundledReviewPricing: Record<string, number>; tz: string; now: number; since: string | null; until: string | null; recordFiles: number }} BuildOptions */

/**
 * buildReport の入力と、集計の全体で使う値。
 * @typedef {object} ReportContext
 * @property {BuildOptions} o
 * @property {(p: string | undefined) => string} alias 人の ID を、設定の aliases で揃えた ID にする
 * @property {Record<string, string>} names 人の ID → 表示名
 * @property {Row[]} latest key ごとに最も新しい行（打ち消された key を除く。期間で絞る前）
 * @property {Row[]} rows latest を期間で絞った行
 */

/**
 * @param {readonly Row[]} allRows
 * @param {BuildOptions} o
 * @returns {ReportData}
 */
export function buildReport(allRows, o) {
  // observed_at の最も新しい行が打ち消しの行（retracted=1）なら、その key を数えない
  const latest = [...latestByKey(allRows).values()].filter((r) => r.retracted !== "1");
  const alias = aliasOf(o.config);
  const rows = latest.filter((r) => inPeriod(r, o));
  /** @type {ReportContext} */
  const ctx = { o, alias, names: namesOf(rows, alias, o.config), latest, rows };
  const { usageOut, dailyCost, unknownCostBuckets } = aggregateUsage(ctx);
  const st = aggregateStatus(ctx);
  const reviews = buildReviews(rows, o);
  const { first, last, days } = axisDays({ o, rows, dailyCost, byDate: st.byDate });

  return {
    generatedAt: toIso(o.now),
    tz: o.tz,
    // --until を指定しない側は、横軸と同じ最後の日を出す
    period: formatPeriod(o.since ?? first, o.until ?? last),
    since: o.since,
    until: o.until,
    recordFiles: o.recordFiles,
    rows: rows.length,
    names: ctx.names,
    usage: usageOut,
    intervals: st.intervals,
    reviews,
    statusByHour: STATUSES.map((c) => ({ status: c, byHour: st.byHour.get(c) ?? [] })),
    days,
    statusByDay: STATUSES.map((c) => ({
      status: c,
      byDay: days.map((date) => st.byDate.get(c)?.get(date) ?? 0),
    })),
    activeByPerson: st.activeByPerson,
    activeByIssue: st.activeByIssue,
    stopByPerson: st.stopByPerson,
    idleByIssue: st.idleByIssue,
    runHistogram: st.runHistogram,
    dailyCost,
    unknownCostBuckets,
  };
}

/**
 * 人の ID を、設定の aliases で揃えた ID にする関数。ID が無ければ空文字にする。
 * @param {RepoConfig} config
 * @returns {(p: string | undefined) => string}
 */
function aliasOf(config) {
  return (p) => (p ? (config.aliases[p] ?? p) : "");
}

/**
 * 行の始まりの日付（行のタイムゾーンで切る）が、--since から --until までに入るか。
 * @param {Row} r
 * @param {BuildOptions} o
 * @returns {boolean}
 */
function inPeriod(r, o) {
  const t = parseTime(r.start);
  if (t === null) return false;
  const date = localParts(t, r.tz || o.tz).date;
  if (o.since && date < o.since) return false;
  if (o.until && date > o.until) return false;
  return true;
}

/**
 * 行に現れる人の ID → 表示名。
 * @param {readonly Row[]} rows
 * @param {(p: string | undefined) => string} alias
 * @param {RepoConfig} config
 * @returns {Record<string, string>}
 */
function namesOf(rows, alias, config) {
  /** @type {Record<string, string>} */
  const names = {};
  for (const r of rows) {
    const p = alias(r.person);
    if (p !== "" && !(p in names)) names[p] = config.people[p]?.name ?? p;
  }
  return names;
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
/**
 * @typedef {object} UsageTotals
 * @property {Map<string, UsageAcc>} usage 日付・人・エージェント・モデルごと
 * @property {Map<string, number>} daily 日付とモデルごとの費用
 * @property {number} unknownCostBuckets
 */

/**
 * usage の行を、日付・人・エージェント・モデルごとに集計する。
 * @param {ReportContext} ctx
 * @returns {{ usageOut: Record<string, string>[]; dailyCost: { date: string; model: string; cost: number }[]; unknownCostBuckets: number }}
 */
function aggregateUsage(ctx) {
  /** @type {UsageTotals} */
  const acc = { usage: new Map(), daily: new Map(), unknownCostBuckets: 0 };
  for (const r of ctx.rows.filter((x) => x.kind === "usage")) addUsageRow(acc, r, ctx);
  const dailyCost = [...acc.daily.entries()].map(([k, cost]) => {
    const [date, model] = k.split("\u0000");
    return { date, model, cost };
  });
  return {
    usageOut: usageRows(acc.usage, ctx.names),
    dailyCost,
    unknownCostBuckets: acc.unknownCostBuckets,
  };
}

/**
 * usage の 1 行を集計に足す。
 * @param {UsageTotals} acc
 * @param {Row} r
 * @param {ReportContext} ctx
 */
function addUsageRow(acc, r, ctx) {
  const t = parseTime(r.start) ?? 0;
  const date = localParts(t, r.tz || ctx.o.tz).date;
  const model = r.model ?? "";
  const u = usageAccOf(acc.usage, {
    date,
    person: ctx.alias(r.person),
    agent: r.agent ?? "",
    model,
  });
  for (const c of TOKEN_COLUMNS) u.sums[c] += Number(r[c] || 0);
  const { cost, sources } = usageCost(r, model, ctx.o);
  for (const src of sources) u.sources.add(src);
  // 単価のある応答と単価不明の応答が混在する行（cost_source に unknown を含む）も、費用が足りないので単価不明に数える
  if (cost === null || sources.includes("unknown")) {
    u.unknown += 1;
    acc.unknownCostBuckets += 1;
  }
  if (cost !== null) {
    u.cost += cost;
    const dk = `${date}\u0000${model}`;
    acc.daily.set(dk, (acc.daily.get(dk) ?? 0) + cost);
  }
}

/**
 * 日付・人・エージェント・モデルの組の集計。無ければ 0 で作る。
 * @param {Map<string, UsageAcc>} usage
 * @param {{ date: string; person: string; agent: string; model: string }} k
 * @returns {UsageAcc}
 */
function usageAccOf(usage, { date, person, agent, model }) {
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
  return u;
}

/**
 * usage の 1 行の費用と、費用の出所。
 * @param {Row} r
 * @param {string} model
 * @param {BuildOptions} o
 * @returns {{ cost: number | null; sources: string[] }}
 */
function usageCost(r, model, o) {
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
  return { cost, sources };
}

/**
 * usage.csv の行。日付・人・エージェント・モデルの順に並べる。
 * @param {Map<string, UsageAcc>} usage
 * @param {Record<string, string>} names
 * @returns {Record<string, string>[]}
 */
function usageRows(usage, names) {
  return [...usage.values()]
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
}

// 稼働と停止
/**
 * @typedef {object} StatusAcc
 * @property {Record<string, string>[]} intervals intervals.csv の行
 * @property {number[]} runHistogram
 * @property {Map<Status, number[]>} byHour
 * @property {Map<Status, Map<string, number>>} byDate
 * @property {Record<string, number>} activeByPerson
 * @property {Record<string, number>} activeByIssue
 * @property {Record<string, Map<StopCategory, number>>} stopByPerson
 * @property {Record<string, number>} idleByIssue
 */
/**
 * 稼働状況の集計で使う、GitHub の情報の区間。
 * @typedef {object} StatusContext
 * @property {Span[]} coverageAll GitHub の情報を取得できた区間（期間で絞る前）
 * @property {Map<string, Span[]>} ciByBranch
 * @property {Map<string, Span[]>} reviewWaitByBranch
 */
/** @typedef {{ row: Row; span: Span }} RunEntry */
/**
 * 1 人の稼働状況を数えるときの値。
 * @typedef {object} PersonScope
 * @property {string} person
 * @property {string} name
 * @property {Row[]} mine その人の行
 * @property {RunEntry[]} statusRuns 稼働状況に数える run
 * @property {Span[]} merged statusRuns の区間をまとめたもの
 * @property {number} periodEnd
 * @property {string} tz
 * @property {Map<StopCategory, number>} stops 停止の分類ごとの時間（時）
 */

/**
 * 稼働と停止を、人ごと・Issue ごと・時刻ごと・日ごとに集計し、intervals.csv の行を作る。
 * @param {ReportContext} ctx
 * @returns {StatusAcc}
 */
function aggregateStatus(ctx) {
  /** @type {StatusAcc} */
  const st = {
    intervals: [],
    runHistogram: RUN_BINS.map(() => 0),
    byHour: new Map(STATUSES.map((c) => [c, Array.from({ length: 24 }, () => 0)])),
    byDate: new Map(STATUSES.map((c) => [c, new Map()])),
    activeByPerson: {},
    activeByIssue: {},
    stopByPerson: {},
    idleByIssue: {},
  };
  /** @type {StatusContext} */
  const sctx = {
    // coverage は期間で絞る前の行から取る（期間の初めの停止に、前日までの取得が当たる）
    coverageAll: mergeSpans(
      spansOf(ctx.latest.filter((r) => r.kind === "coverage" && r.detail === "ok")),
    ),
    ciByBranch: spansByBranch(ctx.latest, "ci"),
    reviewWaitByBranch: spansByBranch(ctx.latest, "review-wait"),
  };
  const people = [
    ...new Set(ctx.rows.filter((r) => r.kind === "run").map((r) => ctx.alias(r.person))),
  ].sort();
  for (const person of people) addPerson(st, { ctx, sctx }, person);
  st.intervals.sort((a, b) => a.start.localeCompare(b.start) || a.person.localeCompare(b.person));
  return st;
}

/**
 * CI とレビュー待ちの区間は、ブランチごとに 1 回だけまとめる（停止の隙間ごとに全行を走査しない）
 * @param {readonly Row[]} latest
 * @param {string} kind
 * @returns {Map<string, Span[]>}
 */
function spansByBranch(latest, kind) {
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
}

/**
 * 区間を時刻ごとと日ごとに足す。どちらも同じ正時の区切りで分ける（日をまたぐ区間は、それぞれの日に入る）。
 * @param {StatusAcc} st
 * @param {{ status: Status; start: number; end: number; tz: string }} s
 */
function addStatus(st, { status, start, end, tz }) {
  for (const h of splitByLocalHour(start, end, tz)) {
    const hours = (h.end - h.start) / 3600000;
    const arr = st.byHour.get(status);
    if (arr) arr[h.hour] += hours;
    const days = st.byDate.get(status);
    const date = h.date;
    if (days) days.set(date, (days.get(date) ?? 0) + hours);
  }
}

/**
 * 1 人の run と停止を集計に足す。
 * @param {StatusAcc} st
 * @param {{ ctx: ReportContext; sctx: StatusContext }} c
 * @param {string} person
 */
function addPerson(st, { ctx, sctx }, person) {
  const { o } = ctx;
  const name = ctx.names[person] ?? person;
  const mine = ctx.rows.filter((r) => ctx.alias(r.person) === person);
  const runs = runsOf(mine);
  for (const run of runs) recordRun(st, run, { person, name });
  if (runs.length === 0) return;
  const tz = runs[0].row.tz || o.tz;
  // 稼働状況は、1 人を 1 つのタイムゾーン（期間で絞った後の、その人の最初の run のタイムゾーン）で数える。
  // 日付の分け方も期間の終わり（そのタイムゾーンでの --until の日の終わり）も、このタイムゾーンで決める
  const periodEnd = o.until ? Math.min(o.now, endOfLocalDate(o.until, tz)) : o.now;
  // 行を期間で絞るのは行ごとのタイムゾーンなので、記録が複数のタイムゾーンにまたがると、別のタイムゾーンの行として期間に入った run が
  // 期間の終わりより後に始まりうる。その run は稼働状況（稼働中と停止）に数えない。指示の数とヒストグラムには、期間に入った行として数える
  const statusRuns = runs.filter((r) => r.span[0] < periodEnd);
  // 稼働状況に数える run が無い人も、人ごとの稼働中と停止は 0 として持つ
  st.activeByPerson[person] = 0;
  st.stopByPerson[person] = new Map(STOP_CATEGORIES.map((c) => [c, 0]));
  if (statusRuns.length === 0) return;
  /** @type {PersonScope} */
  const p = {
    person,
    name,
    mine,
    statusRuns,
    merged: mergeSpans(statusRuns.map((r) => r.span)),
    periodEnd,
    tz,
    stops: new Map(STOP_CATEGORIES.map((c) => [c, 0])),
  };
  st.activeByPerson[person] = addActive(st, p);
  st.stopByPerson[person] = p.stops;
  splitActiveByIssue(st, statusRuns, periodEnd);
  addStops(st, { ctx, sctx }, p);
}

/**
 * 1 人の run を、始まりの順に並べる（時刻を読めない run は除く）。
 * @param {readonly Row[]} mine
 * @returns {RunEntry[]}
 */
function runsOf(mine) {
  return mine
    .filter((r) => r.kind === "run")
    .flatMap((r) => {
      const s = spanOf(r);
      return s ? [{ row: r, span: s }] : [];
    })
    .sort((a, b) => a.span[0] - b.span[0]);
}

/**
 * run を、ヒストグラムと intervals.csv の行に足す。
 * @param {StatusAcc} st
 * @param {RunEntry} run
 * @param {{ person: string; name: string }} who
 */
function recordRun(st, { row, span }, who) {
  const minutes = (span[1] - span[0]) / 60000;
  const bin = RUN_BINS.findIndex((b) => minutes < b.max);
  st.runHistogram[bin] += 1;
  st.intervals.push({
    type: "run",
    person: who.person,
    name: who.name,
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

/**
 * 1 人の稼働中を時刻ごとと日ごとに足し、稼働中の時間（時）を返す。
 * @param {StatusAcc} st
 * @param {PersonScope} p
 * @returns {number}
 */
function addActive(st, p) {
  const { merged, periodEnd, tz } = p;
  // 稼働中は、重なる run をまとめた区間（停止はこの隙間なので、稼働中と停止は重ならない）。期間の終わりで打ち切る
  let active = 0;
  for (const [a, b] of merged) {
    const end = Math.min(b, periodEnd);
    if (end <= a) continue;
    addStatus(st, { status: "active", start: a, end, tz });
    active += (end - a) / 3600000;
  }
  return active;
}

/**
 * run の始まり（+1）と、期間の終わりで打ち切った終わり（-1）を、Issue と組にして時刻の順に並べる。
 * @param {readonly RunEntry[]} statusRuns
 * @param {number} periodEnd
 * @returns {[number, number, string][]}
 */
function issueEvents(statusRuns, periodEnd) {
  /** @type {[number, number, string][]} */
  const events = [];
  for (const { row, span } of statusRuns) {
    const end = Math.min(span[1], periodEnd);
    if (end > span[0]) events.push([span[0], 1, row.issue ?? ""], [end, -1, row.issue ?? ""]);
  }
  events.sort((x, y) => x[0] - y[0]);
  return events;
}

/**
 * Issue ごとの稼働中は、人ごとの稼働中を、その時間に動いていた Issue の数で等分して配る（Issue ごとの合計が人ごとの稼働中と一致する）。
 * run の始まりと終わりを時刻の順に走査し、動いている run の数を Issue ごとに増減させる
 * @param {StatusAcc} st
 * @param {readonly RunEntry[]} statusRuns
 * @param {number} periodEnd
 */
function splitActiveByIssue(st, statusRuns, periodEnd) {
  const { activeByIssue } = st;
  const events = issueEvents(statusRuns, periodEnd);
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
}

/**
 * 人の活動（指示・人を待った区間の終わり・人の commit・GitHub での自分の操作）の前後 windowMs の区間をまとめたもの。
 * @param {readonly Row[]} mine
 * @param {number} windowMs
 * @returns {Span[]}
 */
function presenceOf(mine, windowMs) {
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
  return mergeSpans(marks);
}

/**
 * 1 人の停止（run の隙間）を分類して、集計と intervals.csv の行に足す。
 * @param {StatusAcc} st
 * @param {{ ctx: ReportContext; sctx: StatusContext }} c
 * @param {PersonScope} p
 */
function addStops(st, { ctx, sctx }, p) {
  const { merged, periodEnd, mine } = p;
  const presence = presenceOf(mine, ctx.o.config.activityWindowMinutes * 60000);
  // その人がまだ collect していない時間を停止に数えない（最後に記録した時刻で打ち切る）
  const lastSeen = mine.reduce(
    (a, r) => Math.max(a, parseTime(r.observed_at ?? "") ?? Number.NEGATIVE_INFINITY),
    Number.NEGATIVE_INFINITY,
  );
  const personEnd = Number.isFinite(lastSeen) ? Math.min(periodEnd, lastSeen) : periodEnd;
  // 期間に入れた run は期間の終わりより前に始まるので、run の間の隙間は期間の終わりより前に収まる。
  // 最後の run の後の隙間も、personEnd（期間の終わりより後にならない）までである
  for (const gap of gaps(merged, merged[0][0], Math.max(personEnd, merged[merged.length - 1][1]))) {
    const before = lastRunBefore(p.statusRuns, gap);
    const branch = before ? (before.row.branch ?? "") : "";
    const ci = sctx.ciByBranch.get(branch) ?? [];
    const reviewWait = sctx.reviewWaitByBranch.get(branch) ?? [];
    const uncovered = gaps(sctx.coverageAll, gap[0], gap[1]);
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
    for (const piece of pieces) recordStop(st, p, { piece, before, branch });
  }
}

/**
 * 直前に動いていた run は、隙間の前に最も遅く終わったもの（runs は始まりの順なので、末尾が最後に終わったとは限らない）
 * @param {readonly RunEntry[]} statusRuns
 * @param {Span} gap
 * @returns {RunEntry | undefined}
 */
function lastRunBefore(statusRuns, gap) {
  /** @type {RunEntry | undefined} */
  let before;
  for (const r of statusRuns) {
    if (r.span[1] <= gap[0] && (!before || r.span[1] >= before.span[1])) before = r;
  }
  return before;
}

/**
 * 直前に動いていた run のエージェント・セッション・Issue。run が無ければ空文字にする。
 * @param {RunEntry | undefined} before
 * @returns {{ agent: string; session: string; issue: string }}
 */
function beforeFields(before) {
  if (!before) return { agent: "", session: "", issue: "" };
  const { row } = before;
  return { agent: row.agent ?? "", session: row.session ?? "", issue: row.issue ?? "" };
}

/**
 * 分類した停止の 1 片を、intervals.csv の行と、時刻ごと・日ごと・人ごと・Issue ごとの集計に足す。
 * @param {StatusAcc} st
 * @param {PersonScope} p
 * @param {{ piece: { start: number; end: number; category: StopCategory }; before: RunEntry | undefined; branch: string }} s
 */
function recordStop(st, p, { piece, before, branch }) {
  const { agent, session, issue } = beforeFields(before);
  st.intervals.push({
    type: "stop",
    person: p.person,
    name: p.name,
    start: toIso(piece.start),
    end: toIso(piece.end),
    minutes: ((piece.end - piece.start) / 60000).toFixed(1),
    active_minutes: "",
    category: piece.category,
    agent,
    session,
    branch,
    issue,
  });
  addStatus(st, { status: piece.category, start: piece.start, end: piece.end, tz: p.tz });
  // 人ごとの表と Issue ごとの表も、丸める前の値から足す（intervals.csv の minutes は小数第 1 位に丸めてある）
  p.stops.set(
    piece.category,
    (p.stops.get(piece.category) ?? 0) + (piece.end - piece.start) / 3600000,
  );
  if (piece.category === "idle") {
    st.idleByIssue[issue] = (st.idleByIssue[issue] ?? 0) + (piece.end - piece.start) / 3600000;
  }
}

/**
 * レビューと課金の行から、reviews.csv の行を作る。日付・ツールの順に並べる。
 * @param {readonly Row[]} rows
 * @param {BuildOptions} o
 * @returns {Record<string, string>[]}
 */
function buildReviews(rows, o) {
  return rows
    .filter((r) => r.kind === "review" || r.kind === "billing")
    .map((r) => reviewRow(r, o))
    .sort((a, b) => a.date.localeCompare(b.date) || a.tool.localeCompare(b.tool));
}

/**
 * @param {Row} r
 * @param {BuildOptions} o
 * @returns {Record<string, string> & { date: string; tool: string }}
 */
function reviewRow(r, o) {
  const detail = Object.fromEntries((r.detail ?? "").split(";").map((kv) => kv.split("=")));
  const type = r.kind === "billing" ? "billing" : detail.source === "artifact" ? "usage" : "review";
  const { cost, costSource } = reviewCost(r, type, o);
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
}

/**
 * レビューの費用と、費用の出所。
 * @param {Row} r
 * @param {string} type
 * @param {BuildOptions} o
 * @returns {{ cost: string; costSource: string }}
 */
function reviewCost(r, type, o) {
  // 記録の時点で推定額の無かったレビューは、今の単価（リポジトリの設定・同梱）で推定し直す
  let cost = r.cost_usd ?? "";
  let costSource = r.cost_source ?? "";
  if (type === "review" && cost === "") {
    const est = resolveReviewPrice(r.agent ?? "", o.config.reviewPricing, o.bundledReviewPricing);
    if (est.cost !== null) {
      cost = est.cost.toFixed(6);
      costSource = `${est.source}@report`;
    }
  }
  return { cost, costSource };
}

/**
 * 日別のチャートの横軸と、期間の表示に使う最初の日と最後の日。
 * @param {{ o: BuildOptions; rows: readonly Row[]; dailyCost: { date: string }[]; byDate: Map<Status, Map<string, number>> }} a
 * @returns {{ first: string | null; last: string | null; days: string[] }}
 */
function axisDays({ o, rows, dailyCost, byDate }) {
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
  return { first, last, days };
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
 * meta.json の中身。レポートを整理するスクリプトが、期間を指定したかを HTML を解析せずに読めるようにする
 * @param {ReportData} d
 */
export function reportMeta(d) {
  return {
    since: d.since,
    until: d.until,
    period: d.period,
    generated_at: d.generatedAt,
    time_zone: d.tz,
  };
}

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
  const resolvedConfig = resolved(o.root, o.env);
  const config = loadRepoConfig(o.root, o.env, resolvedConfig);
  // report は人の設定を読むだけで作らない（作ると、setup を通らずに乱数の ID ができる）
  const tz = loadUserConfig(o.root, o.env, resolvedConfig)?.timeZone ?? systemTimeZone();
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
    [join(outDir, "meta.json"), `${JSON.stringify(reportMeta(data), null, 2)}\n`],
  ];
  for (const [p, text] of written) writeFileSync(p, text);
  return { files: written.map(([p]) => p), rows: data.rows, period: data.period };
}
