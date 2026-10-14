// report の HTML。1 ファイルで完結させ、グラフは SVG とインラインの JavaScript（ツールチップ）で描く。外部のライブラリと CDN は読まない。
// 配色は役割の CSS 変数で持ち、ダークモードでは同じ役割に暗い面用の値を当てる。各グラフには、同じ値の表を <details> で添える。

import { RUN_BINS, STOP_CATEGORIES } from "./categories.mjs";

/** @typedef {import("./report.mjs").ReportData} ReportData */
/** @typedef {import("./categories.mjs").StopCategory} StopCategory */

/** Issue ごとの表に出す行の数。 */
const ISSUE_ROWS = 20;

/** 停止の分類の表示名。 */
export const STOP_LABELS = /** @type {const} */ ({
  idle: "未活用",
  reviewing: "確認中",
  "ci-wait": "CI 待ち",
  "review-wait": "レビュー待ち",
  unknown: "判定不能",
});

/**
 * @param {string} s
 * @returns {string}
 */
export function esc(s) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/**
 * @param {number} n
 * @returns {string}
 */
function usd(n) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * @param {number} n
 * @param {number} digits
 * @returns {string}
 */
function num(n, digits = 0) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 目盛りのきりのよい上限。
 * @param {number} max
 * @returns {number}
 */
function niceMax(max) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/**
 * 積み上げの縦棒グラフ。
 * 表で見るときは、行ごとの合計の列と、すべての行の合計の行を付ける。
 * @param {{ title: string; labels: string[]; series: { name: string; color: string; values: number[] }[]; format: (n: number) => string; unit: string; axisFormat?: (n: number) => string; axisLabel?: (label: string) => string; maxLabels?: number; note?: string }} c
 * @returns {string}
 */
export function stackedBars(c) {
  const W = 1080;
  const H = 260;
  const left = 72;
  const bottom = 40;
  const top = 12;
  const plotW = W - left - 12;
  const plotH = H - top - bottom;
  const totals = c.labels.map((_, i) => c.series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const n = Math.max(1, c.labels.length);
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(28, slot * 0.6));
  const every = Math.max(1, Math.ceil(n / (c.maxLabels ?? 12)));
  const parts = [];
  for (let k = 0; k <= 4; k += 1) {
    const v = (max * k) / 4;
    const y = top + plotH - (plotH * k) / 4;
    parts.push(`<line class="grid" x1="${left}" x2="${W - 12}" y1="${y}" y2="${y}"/>`);
    parts.push(
      `<text class="axis" x="${left - 6}" y="${y + 4}" text-anchor="end">${esc((c.axisFormat ?? c.format)(v))}</text>`,
    );
  }
  c.labels.forEach((label, i) => {
    const x = left + slot * i + (slot - barW) / 2;
    let y = top + plotH;
    for (const s of c.series) {
      const v = s.values[i] ?? 0;
      if (v <= 0) continue;
      const h = (plotH * v) / max;
      y -= h;
      const tip = `${label} / ${s.name}: ${c.format(v)}${c.unit}`;
      parts.push(
        `<rect class="mark" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h - 1).toFixed(1)}" fill="${s.color}" data-tip="${esc(tip)}" tabindex="0"><title>${esc(tip)}</title></rect>`,
      );
    }
    if (i % every === 0) {
      parts.push(
        `<text class="axis" x="${(left + slot * i + slot / 2).toFixed(1)}" y="${H - bottom + 16}" text-anchor="middle">${esc(c.axisLabel ? c.axisLabel(label) : label)}</text>`,
      );
    }
  });
  parts.push(
    `<line class="baseline" x1="${left}" x2="${W - 12}" y1="${top + plotH}" y2="${top + plotH}"/>`,
  );
  const legend =
    c.series.length > 1
      ? `<ul class="legend">${c.series.map((s) => `<li><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}</li>`).join("")}</ul>`
      : "";
  const rows = c.labels.map((l, i) => [
    l,
    ...c.series.map((s) => c.format(s.values[i] ?? 0)),
    c.format(totals[i]),
  ]);
  const sum = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0);
  const totalRow = ["合計", ...c.series.map((s) => c.format(sum(s.values))), c.format(sum(totals))];
  const note = c.note ? `<p class="muted small">${esc(c.note)}</p>` : "";
  return `<figure class="chart"><figcaption>${esc(c.title)}</figcaption>${note}${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}">${parts.join("")}</svg><details><summary>表で見る</summary>${table(["項目", ...c.series.map((s) => s.name), "合計"], rows, totalRow)}</details></figure>`;
}

/**
 * 表。高さを抑えて縦にスクロールし、見出しの行と合計の行はスクロールしても見えるように固定する。
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {string[] | null} totalRow すべての行の合計（無ければ null）
 * @returns {string}
 */
function table(headers, rows, totalRow = null) {
  if (rows.length === 0) return `<p class="muted">該当なし</p>`;
  const head = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  const foot = totalRow
    ? `<tfoot><tr>${totalRow.map((v) => `<td>${esc(v)}</td>`).join("")}</tr></tfoot>`
    : "";
  return `<div class="scroll"><table>${head}${body}${foot}</table></div>`;
}

/**
 * @param {ReportData} d
 * @returns {string}
 */
export function renderHtml(d) {
  const series = [
    "var(--s1)",
    "var(--s2)",
    "var(--s3)",
    "var(--s4)",
    "var(--s5)",
    "var(--s6)",
    "var(--s7)",
  ];
  // 日別の費用（上位 7 モデル＋その他）
  /** @type {Map<string, number>} */
  const byModel = new Map();
  for (const x of d.dailyCost) byModel.set(x.model, (byModel.get(x.model) ?? 0) + x.cost);
  const topModels = [...byModel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([m]) => m);
  const dates = [...new Set(d.dailyCost.map((x) => x.date))].sort();
  const modelSeries = topModels.map((m, i) => ({
    name: m,
    color: series[i],
    values: dates.map((date) =>
      d.dailyCost.filter((x) => x.date === date && x.model === m).reduce((a, x) => a + x.cost, 0),
    ),
  }));
  const others = dates.map((date) =>
    d.dailyCost
      .filter((x) => x.date === date && !topModels.includes(x.model))
      .reduce((a, x) => a + x.cost, 0),
  );
  if (others.some((v) => v > 0))
    modelSeries.push({ name: "その他", color: "var(--other)", values: others });

  const totalCost = d.usage.reduce((a, u) => a + Number(u.cost_usd), 0);
  /** @type {Map<string, number>} */
  const byAgent = new Map();
  for (const u of d.usage) byAgent.set(u.agent, (byAgent.get(u.agent) ?? 0) + Number(u.cost_usd));
  const runs = d.intervals.filter((x) => x.type === "run");
  const runMinutes = runs.map((x) => Number(x.minutes)).sort((a, b) => a - b);
  const median = runMinutes.length > 0 ? runMinutes[Math.floor(runMinutes.length / 2)] : 0;
  /** @type {Record<string, number>} */
  const stopHours = {};
  for (const x of d.intervals.filter((y) => y.type === "stop"))
    stopHours[x.category] = (stopHours[x.category] ?? 0) + Number(x.minutes) / 60;
  const stopColors = {
    idle: "var(--s1)",
    reviewing: "var(--s2)",
    "ci-wait": "var(--s3)",
    "review-wait": "var(--s4)",
    unknown: "var(--other)",
  };

  // Issue ごと
  /** @type {Map<string, { active: number; runs: number; idle: number }>} */
  const byIssue = new Map();
  const issueOf = (/** @type {string} */ i) => {
    let v = byIssue.get(i);
    if (!v) {
      v = { active: 0, runs: 0, idle: 0 };
      byIssue.set(i, v);
    }
    return v;
  };
  for (const x of runs) {
    const v = issueOf(x.issue || "(なし)");
    v.active += Number(x.active_minutes) / 60;
    v.runs += 1;
  }
  for (const x of d.intervals.filter((y) => y.type === "stop" && y.category === "idle"))
    issueOf(x.issue || "(なし)").idle += Number(x.minutes) / 60;

  // レビュー
  /** @type {Map<string, { count: number; cost: number; unknown: number }>} */
  const byTool = new Map();
  for (const r of d.reviews.filter((x) => x.type !== "billing")) {
    const v = byTool.get(r.tool) ?? { count: 0, cost: 0, unknown: 0 };
    if (r.type === "review") v.count += 1;
    if (r.cost_usd === "") v.unknown += 1;
    else v.cost += Number(r.cost_usd);
    byTool.set(r.tool, v);
  }
  const billing = d.reviews
    .filter((x) => x.type === "billing")
    .reduce((a, x) => a + Number(x.cost_usd || 0), 0);

  // 人ごと（費用・稼働の回数・稼働・停止の内訳）
  /** @type {Map<string, { id: string; name: string; cost: number; runs: number; active: number; stops: Record<StopCategory, number> }>} */
  const byPerson = new Map();
  const personOf = (/** @type {string} */ id) => {
    let v = byPerson.get(id);
    if (!v) {
      v = {
        id,
        name: d.names[id] ?? id,
        cost: 0,
        runs: 0,
        active: 0,
        stops: { idle: 0, reviewing: 0, "ci-wait": 0, "review-wait": 0, unknown: 0 },
      };
      byPerson.set(id, v);
    }
    return v;
  };
  for (const u of d.usage) personOf(u.person).cost += Number(u.cost_usd);
  for (const x of runs) {
    const v = personOf(x.person);
    v.runs += 1;
    v.active += Number(x.active_minutes) / 60;
  }
  for (const x of d.intervals.filter((y) => y.type === "stop")) {
    const v = personOf(x.person);
    const c = STOP_CATEGORIES.find((k) => k === x.category);
    if (c) v.stops[c] += Number(x.minutes) / 60;
  }
  const people = [...byPerson.values()].sort((a, b) => b.cost - a.cost);

  const stopTotal = STOP_CATEGORIES.reduce((a, c) => a + (stopHours[c] ?? 0), 0);
  /** @type {{ title: string; total: [string, string]; items: [string, string][] }[]} */
  const tileGroups = [
    {
      title: "費用（API 料金換算）",
      total: ["合計", usd(totalCost)],
      items: [...byAgent.entries()].sort((a, b) => b[1] - a[1]).map(([a, c]) => [a, usd(c)]),
    },
    {
      title: "稼働",
      total: ["稼働の回数", num(runs.length)],
      items: [["連続稼働の中央値", `${num(median, 1)} 分`]],
    },
    {
      title: "停止",
      total: ["合計", `${num(stopTotal, 1)} 時間`],
      items: STOP_CATEGORIES.map((c) => [STOP_LABELS[c], `${num(stopHours[c] ?? 0, 1)} 時間`]),
    },
  ];

  const body = [
    `<header><h1>エージェントの利用実績</h1><p class="muted">期間: ${esc(d.period)} / 作成: ${esc(d.generatedAt)} / タイムゾーン: ${esc(d.tz)} / 記録のファイル: ${d.recordFiles} / 行: ${d.rows}</p></header>`,
    `<section class="groups">${tileGroups
      .map(
        (g) =>
          `<div class="group"><h2>${esc(g.title)}</h2><div class="total"><span class="k">${esc(g.total[0])}</span><span class="v">${esc(g.total[1])}</span></div><dl>${g.items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>`,
      )
      .join("")}</section>`,
    d.unknownCostBuckets > 0
      ? `<p class="note">単価が分からず費用を数えていない記録が ${d.unknownCostBuckets} 件あります（usage.csv の cost_unknown_buckets）。.agent-usage/config.json の pricing に単価を足して report を実行し直すと、費用に入ります。</p>`
      : "",
    stackedBars({
      title: "日別の費用（モデル別）",
      labels: dates,
      series: modelSeries,
      format: (n) => usd(n),
      axisFormat: (n) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      unit: "",
      axisLabel: (l) => l.slice(5),
      maxLabels: 10,
    }),
    stackedBars({
      title: "1 回の指示で動き続けた時間（件数）",
      labels: RUN_BINS.map((b) => b.label),
      series: [{ name: "件数", color: "var(--s1)", values: d.runHistogram }],
      format: (n) => num(n),
      unit: " 件",
    }),
    stackedBars({
      title: "時刻ごとの停止の時間（時間）",
      labels: Array.from({ length: 24 }, (_, h) => `${h} 時`),
      series: d.stopByHour.map((s) => ({
        name: STOP_LABELS[s.category],
        color: stopColors[s.category],
        values: s.byHour,
      })),
      format: (n) => num(n, 1),
      unit: " 時間",
      note: "判定不能は、GitHub の情報（CI・レビュー・自分の操作）を取得していない期間の停止です。collect が GitHub を取得するのは、初回は最大 60 日前からです。",
    }),
    `<section><h2>Issue ごと（稼働の長い順に ${ISSUE_ROWS} 件まで。すべては intervals.csv）</h2>${table(
      ["Issue", "稼働の回数", "稼働（時間）", "未活用の停止（時間）"],
      [...byIssue.entries()]
        .sort((a, b) => b[1].active - a[1].active)
        .slice(0, ISSUE_ROWS)
        .map(([k, v]) => [k, num(v.runs), num(v.active, 1), num(v.idle, 1)]),
      [
        "合計（すべての Issue）",
        num([...byIssue.values()].reduce((a, v) => a + v.runs, 0)),
        num(
          [...byIssue.values()].reduce((a, v) => a + v.active, 0),
          1,
        ),
        num(
          [...byIssue.values()].reduce((a, v) => a + v.idle, 0),
          1,
        ),
      ],
    )}</section>`,
    `<section><h2>モデルごと</h2>${table(
      ["エージェント", "モデル", "出力トークン", "費用", "単価不明の記録"],
      Object.values(
        d.usage.reduce(
          (
            /** @type {Record<string, { agent: string; model: string; out: number; cost: number; unknown: number }>} */ acc,
            u,
          ) => {
            const k = `${u.agent}\u0000${u.model}`;
            const v =
              acc[k] ?? (acc[k] = { agent: u.agent, model: u.model, out: 0, cost: 0, unknown: 0 });
            v.out += Number(u.output_tokens);
            v.cost += Number(u.cost_usd);
            v.unknown += Number(u.cost_unknown_buckets);
            return acc;
          },
          {},
        ),
      )
        .sort((a, b) => b.cost - a.cost)
        .map((v) => [v.agent, v.model, num(v.out), usd(v.cost), num(v.unknown)]),
      [
        "合計",
        "",
        num(d.usage.reduce((a, u) => a + Number(u.output_tokens), 0)),
        usd(totalCost),
        num(d.usage.reduce((a, u) => a + Number(u.cost_unknown_buckets), 0)),
      ],
    )}</section>`,
    `<section><h2>PR のレビュー</h2>${table(
      ["ツール", "レビューの数", "費用", "費用の無い記録"],
      [...byTool.entries()].map(([k, v]) => [k, num(v.count), usd(v.cost), num(v.unknown)]),
      [
        "合計",
        num([...byTool.values()].reduce((a, v) => a + v.count, 0)),
        usd([...byTool.values()].reduce((a, v) => a + v.cost, 0)),
        num([...byTool.values()].reduce((a, v) => a + v.unknown, 0)),
      ],
    )}${billing > 0 ? `<p class="muted">課金 API の実額（premium request、レビュー以外を含む）: ${esc(usd(billing))}</p>` : ""}</section>`,
    `<section><h2>人ごと</h2>${table(
      [
        "ID",
        "表示名",
        "費用",
        "稼働の回数",
        "稼働（時間）",
        ...STOP_CATEGORIES.map((c) => `${STOP_LABELS[c]}（時間）`),
      ],
      people.map((p) => [
        p.id,
        p.name,
        usd(p.cost),
        num(p.runs),
        num(p.active, 1),
        ...STOP_CATEGORIES.map((c) => num(p.stops[c], 1)),
      ]),
      [
        "合計",
        "",
        usd(people.reduce((a, p) => a + p.cost, 0)),
        num(people.reduce((a, p) => a + p.runs, 0)),
        num(
          people.reduce((a, p) => a + p.active, 0),
          1,
        ),
        ...STOP_CATEGORIES.map((c) =>
          num(
            people.reduce((a, p) => a + p.stops[c], 0),
            1,
          ),
        ),
      ],
    )}</section>`,
    `<footer class="muted">費用は API の料金に換算した推定で、サブスクリプションの請求額とは一致しません。明細は同じディレクトリの usage.csv・intervals.csv・reviews.csv にあります。</footer>`,
  ].join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>エージェントの利用実績</title>
<style>
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: rgb(137, 135, 129);
  --grid: #e1e0d9; --base: #c3c2b7; --border: rgba(11,11,11,0.10);
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: rgb(0, 131, 0); --s7: #6250d6; --other: rgb(137, 135, 129);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink2: #c3c2b7; --muted: rgb(137, 135, 129);
    --grid: #2c2c2a; --base: rgb(56, 56, 53); --border: rgba(255,255,255,0.10);
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: rgb(0, 131, 0); --s7: #9085e9; --other: #6f6e69;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink2: #c3c2b7; --muted: rgb(137, 135, 129);
  --grid: #2c2c2a; --base: rgb(56, 56, 53); --border: rgba(255,255,255,0.10);
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: rgb(0, 131, 0); --s7: #9085e9; --other: #6f6e69;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--page); color: var(--ink); font: 14px/1.6 system-ui, sans-serif; }
main { max-width: 1440px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 24px 0 8px; }
.muted { color: var(--ink2); } .small { font-size: 12px; margin: 0 0 4px; } .note { padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.chart { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin: 16px 0; }
.chart figcaption { font-weight: 600; margin-bottom: 4px; }
.chart svg { width: 100%; height: auto; display: block; }
.grid { stroke: var(--grid); stroke-width: 1; } .baseline { stroke: var(--base); stroke-width: 1; }
.axis { fill: var(--muted); font-size: 11px; }
.mark:hover, .mark:focus { outline: none; stroke: var(--ink); stroke-width: 1.5; }
.legend { list-style: none; padding: 0; margin: 0 0 4px; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--ink2); }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.scroll { overflow: auto; max-height: 480px; border: 1px solid var(--border); border-radius: 6px; }
thead th { position: sticky; top: 0; background: var(--surface); z-index: 1; box-shadow: inset 0 -1px 0 var(--base); }
tfoot td { position: sticky; bottom: 0; background: var(--surface); font-weight: 600; box-shadow: inset 0 1px 0 var(--base); }
.groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin: 16px 0; }
.group { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; }
.group h2 { font-size: 13px; color: var(--ink2); margin: 0 0 4px; font-weight: 600; }
.group .total { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--grid); padding-bottom: 6px; margin-bottom: 6px; }
.group .total .v { font-size: 22px; font-variant-numeric: tabular-nums; }
.group dl { margin: 0; } .group dl div { display: flex; justify-content: space-between; padding: 2px 0; font-size: 13px; }
.group dt { color: var(--ink2); } .group dd { margin: 0; font-variant-numeric: tabular-nums; }
table { border-collapse: collapse; width: 100%; font-size: 12px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
details summary { cursor: pointer; color: var(--ink2); font-size: 12px; margin-top: 4px; }
#tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--page); padding: 4px 8px; border-radius: 4px; font-size: 12px; display: none; z-index: 10; }
footer { margin-top: 24px; font-size: 12px; }
</style>
</head>
<body>
<main>
${body}
</main>
<div id="tip" role="status"></div>
<script>
(() => {
  const tip = document.getElementById("tip");
  const show = (el, x, y) => { tip.textContent = el.getAttribute("data-tip"); tip.style.display = "block"; tip.style.left = (x + 12) + "px"; tip.style.top = (y + 12) + "px"; };
  const hide = () => { tip.style.display = "none"; };
  document.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mousemove", (e) => show(el, e.clientX, e.clientY));
    el.addEventListener("mouseleave", hide);
    el.addEventListener("focus", () => { const r = el.getBoundingClientRect(); show(el, r.right, r.top); });
    el.addEventListener("blur", hide);
  });
})();
</script>
</body>
</html>
`;
}
