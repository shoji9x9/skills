// agent-usage の同梱の単価表と、公式の料金ページ（Anthropic・OpenAI）の差を挙げる（Issue #1093）。
// 月次のワークフロー（.github/workflows/check-pricing-drift.yml）が実行し、差を追跡 Issue に載せる。
// 単価表を直すかは人が決め、PR で直す（手順は docs/pricing-drift.md）。
//
// 挙げるものは次の 4 つである。
// - 料金ページにあり、単価表に無いモデル
// - 単価表にあり、料金ページに無いモデル（どちらかの料金ページを読めなかったときは挙げない）
// - 両方にあり、単価が違うモデル
// - このリポジトリの記録（.agent-usage/records）で、費用が空（cost_source が unknown）の行を持ち、今も単価表に無いモデル
// 料金ページを読めなかったこと（取得の失敗・見出しや列の形の変化）も、差と同じ一覧に「読めなかった」として載せる。
//
// 1 つ目と 4 つ目は、前回までに報告したモデルを挙げない。単価表に足さないと決めたモデルが毎月残ると、追跡 Issue をクローズできないからである。
// 報告したモデルの一覧は、追跡 Issue の本文に目印（check-pricing-drift-seen）で残し、次の実行はクローズ済みの Issue の本文からも読む。
// 2 つ目と 3 つ目は、単価表を直すまで毎回挙げる。
// そのため、差が無いとき（0 件）と、読めなかったときを、追跡 Issue の上で区別できる。
//
// 長いコンテキスト・Batch・Flex の単価と、OpenAI のキャッシュの書き込みの単価は、単価表が持たないので比べない。
//
// 単価表や記録を読めないときは、このリポジトリの中の誤りなので、exit 1 で止まる。
//
// 使い方: node scripts/monthly/check-pricing-drift.ts --out <本文のパス> --comment-out <コメントのパス> [--previous <前回の本文のパス>]
// 標準出力の最後の行に `due=<件数>` を出す。件数が 0 のときも本文とコメントのファイルは書く。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isCliEntry } from "../lib/cli/entry.ts";
import { errorMessage } from "../lib/errors.ts";
import { isRecord } from "../lib/guards.ts";
import {
  formatDiffComment,
  kindTracking,
  markerLine,
  parseTrackingCli,
  readKeys,
  type KeyDiff,
} from "../lib/text/tracking-diff.ts";
import { parsePricePeriods } from "../../skills/agent-usage/scripts/lib/config.mjs";
import { normalizeModel, priceAt } from "../../skills/agent-usage/scripts/lib/pricing.mjs";
import { latestByKey, readRecords } from "../../skills/agent-usage/scripts/lib/records.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRICING = join(ROOT, "skills", "agent-usage", "assets", "pricing.json");
const RECORDS = join(ROOT, ".agent-usage", "records");

/** 1 回の取得の上限。ページは数十 KB で 1 秒ほどで返るので、止まったときに気付けるよう 1 分で打ち切る。 */
const FETCH_TIMEOUT_MS = 60_000;

const FIELDS = ["input", "cacheWrite5m", "cacheWrite1h", "cacheRead", "output"] as const;
export type Field = (typeof FIELDS)[number];
export type Price = Partial<Record<Field, number>>;
export type Prices = Map<string, Price>;

// ---- Markdown の表

/** 表の 1 行をセルに分ける。料金ページのセルは `|` を含まないので、エスケープは扱わない。 */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((c) => c.trim());
}

const SEPARATOR = /^\|(\s*:?-+:?\s*\|)+$/u;

type Table = { header: string[]; rows: string[][] };

/** 連続する `|` で始まる行を 1 つの表として読む。2 行目が区切りの行でない塊は表として扱わない。 */
export function tables(lines: readonly string[]): Table[] {
  const out: Table[] = [];
  let block: string[] = [];
  const flush = (): void => {
    const [head, sep, ...rest] = block;
    if (head !== undefined && sep !== undefined && SEPARATOR.test(sep.trim())) {
      out.push({ header: cells(head), rows: rest.map(cells) });
    }
    block = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith("|")) block.push(line);
    else flush();
  }
  flush();
  return out;
}

/** 見出しの行（`level` 個の `#`）から、同じか上の階層の次の見出しの手前までの行を返す。見出しが 1 つでなければ例外にする。 */
export function section(markdown: string, heading: string, level: number): string[] {
  const lines = markdown.split(/\r?\n/u);
  const mark = `${"#".repeat(level)} ${heading}`;
  const starts = lines.flatMap((l, i) => (l.trim() === mark ? [i] : []));
  if (starts.length !== 1)
    throw new Error(`見出し「${mark}」が ${starts.length} 件ある（1 件を期待する）`);
  const start = (starts[0] ?? 0) + 1;
  const next = lines.findIndex(
    (l, i) => i >= start && new RegExp(`^#{1,${level}} `, "u").test(l.trim()),
  );
  return lines.slice(start, next === -1 ? undefined : next);
}

const sameHeader = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((c, i) => c === b[i]);

function addPrice(prices: Prices, id: string, price: Price): void {
  if (prices.has(id)) throw new Error(`モデル ${id} の行が 2 つある`);
  prices.set(id, price);
}

// ---- Anthropic

const ANTHROPIC_HEADER = [
  "Model",
  "Base input tokens",
  "5m cache writes",
  "1h cache writes",
  "Cache hits and refreshes",
  "Output tokens",
];
const ANTHROPIC_FIELDS: readonly Field[] = [
  "input",
  "cacheWrite5m",
  "cacheWrite1h",
  "cacheRead",
  "output",
];

const stripSup = (cell: string): string => cell.replace(/<sup>[^<]*<\/sup>/gu, "").trim();

/** `$0.20 / MTok` を数にする。形が違えば例外にする。 */
function anthropicPrice(cell: string, where: string): number {
  const m = /^\$(\d+(?:\.\d+)?) \/ MTok$/u.exec(stripSup(cell));
  if (m === null) throw new Error(`${where} の単価を読めない: ${JSON.stringify(cell)}`);
  return Number(m[1]);
}

/**
 * `Claude Opus 4.1 ([retired, ...](...))` を `claude-opus-4-1` にする（ログのモデル名の形）。
 * 長いコンテキストの行（`(for prompts over ...)`）は、単価表が持たないので null を返す。
 */
export function anthropicModelId(cell: string): string | null {
  const name = stripSup(cell);
  if (/\(for prompts over [^)]*\)/u.test(name)) return null;
  const base = name.replace(/\s*\(.*\)$/u, "");
  const m = /^Claude ([A-Za-z]+) (\d+(?:\.\d+)*)$/u.exec(base);
  if (m === null) throw new Error(`モデル名の形でない: ${JSON.stringify(cell)}`);
  return `claude-${(m[1] ?? "").toLowerCase()}-${(m[2] ?? "").replaceAll(".", "-")}`;
}

/** Anthropic の料金ページ（Markdown）の「Model pricing」の表を読む。 */
export function parseAnthropic(markdown: string): Prices {
  const found = tables(section(markdown, "Model pricing", 2)).filter((t) =>
    sameHeader(t.header, ANTHROPIC_HEADER),
  );
  if (found.length !== 1) {
    throw new Error(
      `「Model pricing」の下に、列が ${ANTHROPIC_HEADER.join("・")} の表が ${found.length} 件ある（1 件を期待する）`,
    );
  }
  const prices: Prices = new Map();
  for (const row of found[0]?.rows ?? []) {
    const [name = "", ...values] = row;
    const id = anthropicModelId(name);
    if (id === null) continue;
    const price: Price = {};
    ANTHROPIC_FIELDS.forEach((field, i) => {
      price[field] = anthropicPrice(values[i] ?? "", `${id} の ${field}`);
    });
    addPrice(prices, id, price);
  }
  return prices;
}

// ---- OpenAI

/** 列名から単価表の項目への対応。ここに無い列（長いコンテキスト・キャッシュの書き込み）は読まない。 */
const OPENAI_COLUMNS: Readonly<Record<string, Field>> = {
  "Short context input": "input",
  "Short context output": "output",
  "Short context cached input": "cacheRead",
  Input: "input",
  Output: "output",
  "Cached input": "cacheRead",
};
const OPENAI_HEADERS = [
  [
    "Model",
    "Short context input",
    "Short context output",
    "Short context cached input",
    "Short context 30m write",
    "Short context 12h write",
    "Long context input",
    "Long context output",
    "Long context cached input",
    "Long context 30m write",
    "Long context 12h write",
  ],
  ["Model", "Input", "Output", "Cached input"],
];
const OPENAI_FIELDS: readonly Field[] = ["input", "cacheRead", "output"];

/** `$5.00` を数に、`-`（単価が無い）を undefined にする。形が違えば例外にする。 */
function openaiPrice(cell: string, where: string): number | undefined {
  if (cell === "-") return undefined;
  const m = /^\$(\d+(?:\.\d+)?)$/u.exec(cell);
  if (m === null) throw new Error(`${where} の単価を読めない: ${JSON.stringify(cell)}`);
  return Number(m[1]);
}

/** `gpt-5.5 (<272K context length)` を `gpt-5.5` にする。 */
export function openaiModelId(cell: string): string {
  const id = cell.replace(/\s*\(.*\)$/u, "");
  if (!/^[a-z0-9][a-z0-9.-]*$/u.test(id))
    throw new Error(`モデル名の形でない: ${JSON.stringify(cell)}`);
  return id;
}

/** OpenAI の料金ページ（Markdown）の「Standard pricing data」の表を読む。 */
export function parseOpenai(markdown: string): Prices {
  const found = tables(section(markdown, "Standard pricing data", 3));
  if (found.length === 0) throw new Error("「Standard pricing data」の下に表が無い");
  const prices: Prices = new Map();
  for (const { header, rows } of found) {
    if (!OPENAI_HEADERS.some((h) => sameHeader(header, h))) {
      throw new Error(`「Standard pricing data」の表の列が知らない形: ${header.join("・")}`);
    }
    for (const row of rows) {
      const id = openaiModelId(row[0] ?? "");
      const price: Price = {};
      header.forEach((column, i) => {
        const field = OPENAI_COLUMNS[column];
        if (field === undefined) return;
        const value = openaiPrice(row[i] ?? "", `${id} の ${column}`);
        if (value !== undefined) price[field] = value;
      });
      addPrice(prices, id, price);
    }
  }
  return prices;
}

// ---- 料金ページ

export type PageSpec = {
  name: string;
  url: string;
  /** そのページが持ち、単価表と比べる項目。 */
  fields: readonly Field[];
  parse: (markdown: string) => Prices;
};

/** 読む料金ページ。どちらも URL の末尾に `.md` を付けると Markdown を返す。 */
export const PAGES: readonly [PageSpec, PageSpec] = [
  {
    name: "Anthropic",
    url: "https://platform.claude.com/docs/en/about-claude/pricing.md",
    fields: ANTHROPIC_FIELDS,
    parse: parseAnthropic,
  },
  {
    name: "OpenAI",
    url: "https://developers.openai.com/api/docs/pricing.md",
    fields: OPENAI_FIELDS,
    parse: parseOpenai,
  },
];

export type PageResult =
  | { spec: PageSpec; ok: true; prices: Prices }
  | { spec: PageSpec; ok: false; reason: string };

export type Fetcher = (url: string) => Promise<string>;

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

/** 料金ページを取得して読む。取得や解析の失敗は、例外にせず読めなかった結果として返す。モデルが 0 件のときも読めなかったとする。 */
export async function readPage(spec: PageSpec, fetcher: Fetcher): Promise<PageResult> {
  try {
    const prices = spec.parse(await fetcher(spec.url));
    if (prices.size === 0) throw new Error("モデルの行が 0 件");
    return { spec, ok: true, prices };
  } catch (error) {
    return { spec, ok: false, reason: errorMessage(error) };
  }
}

// ---- 単価表と記録

/**
 * 同梱の単価表の models を、時刻 at に有効な期間の単価にして読む。読み方と形の検査は agent-usage と同じ処理を使う。
 * 最初の期間がまだ始まっていないモデル（単価を先に足したもの）は、最初の期間の単価と比べる。
 */
export function parseTable(text: string, at: number): Prices {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || !isRecord(raw.models)) throw new Error("単価表に models が無い");
  const prices: Prices = new Map();
  for (const [model, value] of Object.entries(raw.models)) {
    const periods = parsePricePeriods(value, `単価表の ${model}`);
    const price = priceAt(periods, at) ?? periods[0]?.price;
    if (price !== undefined) prices.set(model, price);
  }
  return prices;
}

/**
 * 記録のうち、費用が空（cost_source が unknown）の usage の行を、モデルごとに数える。
 * 同じ key の行は最新の 1 行だけを使い、打ち消した行（retracted が 1）は数えない。
 */
export function unknownCostModels(recordsDir: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (!existsSync(recordsDir)) return counts;
  const { rows } = readRecords(recordsDir);
  for (const row of latestByKey(rows).values()) {
    if (row.kind !== "usage" || row.cost_source !== "unknown" || row.retracted === "1") continue;
    const model = normalizeModel(row.model ?? "") || "（モデル名なし）";
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  return counts;
}

// ---- 比較

export type Finding = {
  kind: "unreadable" | "missing-in-table" | "missing-on-page" | "price-mismatch" | "unknown-cost";
  target: string;
  detail: string;
};

const fmt = (v: number | undefined): string => (v === undefined ? "なし" : `$${v}`);

/** 単価が違う項目を `項目: 単価表 → 料金ページ` の形で挙げる。違わなければ空。 */
export function priceDiff(table: Price, page: Price, fields: readonly Field[]): string[] {
  return fields
    .filter((f) => table[f] !== page[f])
    .map((f) => `${f}: ${fmt(table[f])} → ${fmt(page[f])}`);
}

const byTarget = (a: Finding, b: Finding): number =>
  a.target < b.target ? -1 : a.target > b.target ? 1 : 0;

/** 1 つの料金ページから、単価表に無いモデルと単価が違うモデルを挙げる。読めなければ読めなかったことを挙げる。 */
function pageFindings(table: Prices, page: PageResult): Finding[] {
  if (!page.ok) {
    return [
      { kind: "unreadable", target: page.spec.name, detail: `${page.spec.url}: ${page.reason}` },
    ];
  }
  const findings: Finding[] = [];
  for (const [model, price] of page.prices) {
    const own = table.get(model);
    if (own === undefined) {
      findings.push({
        kind: "missing-in-table",
        target: model,
        detail: `${page.spec.name} の料金ページにある`,
      });
      continue;
    }
    const diff = priceDiff(own, price, page.spec.fields);
    if (diff.length > 0)
      findings.push({ kind: "price-mismatch", target: model, detail: diff.join("、") });
  }
  return findings.sort(byTarget);
}

/** 単価表にあり、どの料金ページにも無いモデル。どれかのページを読めなければ、そのページのモデルも入るので挙げない。 */
function missingOnPage(table: Prices, pages: readonly PageResult[]): Finding[] {
  const listed = new Set<string>();
  for (const page of pages) {
    if (!page.ok) return [];
    for (const model of page.prices.keys()) listed.add(model);
  }
  return [...table.keys()]
    .filter((m) => !listed.has(m))
    .sort()
    .map((m): Finding => ({
      kind: "missing-on-page",
      target: m,
      detail: "どの料金ページにも無い",
    }));
}

/** 記録で費用が空のモデル。単価表にあるモデルの行は、report を実行し直すと費用が入るので挙げない。 */
function unknownCost(table: Prices, unknown: ReadonlyMap<string, number>): Finding[] {
  return [...unknown]
    .filter(([m]) => !table.has(m))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([m, n]): Finding => ({
      kind: "unknown-cost",
      target: m,
      detail: `費用が空の行が ${n} 行`,
    }));
}

/** 単価表・料金ページ・記録から差を挙げる。 */
export function compare(
  table: Prices,
  pages: readonly PageResult[],
  unknown: ReadonlyMap<string, number>,
): Finding[] {
  return [
    ...pages.flatMap((page) => pageFindings(table, page)),
    ...missingOnPage(table, pages),
    ...unknownCost(table, unknown),
  ];
}

// ---- 本文

const KIND_LABEL: Record<Finding["kind"], string> = {
  unreadable: "料金ページを読めなかった",
  "missing-in-table": "単価表に無い",
  "missing-on-page": "料金ページに無い",
  "price-mismatch": "単価が違う",
  "unknown-cost": "記録の費用が空",
};

const tracking = kindTracking("check-pricing-drift", KIND_LABEL);
export const { previousKeys } = tracking;

// ---- 報告済みのモデル

/** 一度報告したら、次の実行から挙げない種類。単価表に足さないと決めたモデルを毎月挙げないためである。 */
const ONCE_KINDS: ReadonlySet<Finding["kind"]> = new Set(["missing-in-table", "unknown-cost"]);
const SEEN_MARKER = "check-pricing-drift-seen";
const SEEN_FORM = /^(missing-in-table|unknown-cost) \S(.*\S)?$/u;

/** 前回の本文から、これまでに報告したモデルの識別子を読む。目印が無ければ（初めての実行）空にする。 */
export function previousSeen(body: string): string[] {
  return readKeys(body, SEEN_MARKER, SEEN_FORM);
}

/**
 * 今回の報告。`findings` は載せるもの、`acknowledged` は前回までに報告したので載せないものの識別子、
 * `seen` は次の実行に渡す、これまでに報告したモデルの識別子（前回の一覧に今回の分を足したもの）である。
 */
export type Report = { findings: Finding[]; acknowledged: string[]; seen: string[] };

/** compare の結果から、前回までに報告した「単価表に無い」と「記録の費用が空」を除く。 */
export function selectReport(all: readonly Finding[], seenBefore: readonly string[]): Report {
  const before = new Set(seenBefore);
  const seen = new Set(before);
  const findings: Finding[] = [];
  const acknowledged: string[] = [];
  for (const f of all) {
    const key = tracking.keyOf(f);
    if (!ONCE_KINDS.has(f.kind)) findings.push(f);
    else if (before.has(key)) acknowledged.push(key);
    else {
      findings.push(f);
      seen.add(key);
    }
  }
  return { findings, acknowledged, seen: [...seen].sort() };
}

/** 料金ページを読めなかった実行でも確かめられる種類。ほかの種類は、読めなかったページの分を確かめていない。 */
const CHECKED_WITHOUT_PAGES: ReadonlySet<string> = new Set(["unreadable", "unknown-cost"]);

/**
 * 前回の識別子との差分。報告済みで載せなくなったものは、解消していないので「解消」に入れない。
 * 料金ページを読めなかった実行では、ページと比べる種類（単価表に無い・料金ページに無い・単価が違う）を「解消」に入れない。
 * 比べていないので、解消したかが分からないからである。
 */
function reportDiff(report: Report, previous: readonly string[]): KeyDiff {
  const diff = tracking.diff(report.findings, previous);
  const acknowledged = new Set(report.acknowledged);
  const pagesUnread = report.findings.some((f) => f.kind === "unreadable");
  const resolved = diff.resolved.filter(
    (k) =>
      !acknowledged.has(k) && (!pagesUnread || CHECKED_WITHOUT_PAGES.has(k.split(" ")[0] ?? "")),
  );
  return { ...diff, resolved };
}

function pageTable(pages: readonly PageResult[]): string[] {
  const lines = ["| 料金ページ | 結果 |", "| --- | --- |"];
  for (const p of pages) {
    const result = p.ok ? `読めた（${p.prices.size} モデル）` : "読めなかった";
    lines.push(`| [${p.spec.name}](${p.spec.url}) | ${result} |`);
  }
  return [...lines, ""];
}

/** 追跡 Issue の本文。最後の行に、次の実行が差分に使う識別子の一覧を埋める。 */
export function formatBody(
  report: Report,
  pages: readonly PageResult[],
  previous: readonly string[] = [],
): string {
  const { findings } = report;
  const { kept, resolved } = reportDiff(report, previous);
  const lines = [
    "agent-usage の同梱の単価表（`skills/agent-usage/assets/pricing.json`）と、公式の料金ページの差です。単価表を直すかは人が決めます。",
    "この Issue は `Check pricing drift` ワークフローが作成・更新・クローズします。読み方と直す手順は `docs/pricing-drift.md` にあります。",
    "",
    ...pageTable(pages),
    ...(pages.every((p) => p.ok)
      ? []
      : ["料金ページを読めなかったので、「料金ページに無い」は挙げていません。", ""]),
    `差と、記録で費用が空のモデル: ${findings.length} 件`,
    "",
    ...tracking.table(findings, kept, "種類"),
    ...(findings.length > 0 ? [""] : []),
    `前回までに報告したので挙げなかった「単価表に無い」「記録の費用が空」のモデル: ${report.acknowledged.length} 件`,
    "",
    markerLine(SEEN_MARKER, report.seen),
  ];
  return tracking.finish(lines, findings, resolved);
}

export function formatComment(report: Report, previous: readonly string[]): string {
  return formatDiffComment(
    "差と、記録で費用が空のモデル",
    report.findings.length,
    reportDiff(report, previous),
  );
}

// ---- 実行

/** `options` はテストが偽の取得と一時ファイルを渡すためにある。ワークフローはデフォルトで呼ぶ。 */
export async function main(
  args: readonly string[],
  options: { fetcher?: Fetcher; pricing?: string; records?: string } = {},
): Promise<number> {
  const cli = parseTrackingCli(args);
  if (cli === null) {
    console.error(
      "使い方: node scripts/monthly/check-pricing-drift.ts --out <本文のパス> --comment-out <コメントのパス> [--previous <前回の本文のパス>]",
    );
    return 2;
  }
  try {
    // --previous は最後の追跡 Issue の本文である。open の Issue が無いときは、クローズ済みの最後の Issue の本文を渡す。
    const previousBody = cli.previous === undefined ? "" : readFileSync(cli.previous, "utf8");
    const previous = previousKeys(previousBody);
    const seenBefore = previousSeen(previousBody);
    const table = parseTable(readFileSync(options.pricing ?? PRICING, "utf8"), Date.now());
    const unknown = unknownCostModels(options.records ?? RECORDS);
    const fetcher = options.fetcher ?? defaultFetcher;
    const pages = await Promise.all(PAGES.map((spec) => readPage(spec, fetcher)));
    for (const p of pages)
      if (!p.ok) console.error(`${p.spec.name} の料金ページを読めない: ${p.reason}`);
    const report = selectReport(compare(table, pages, unknown), seenBefore);
    writeFileSync(cli.out, formatBody(report, pages, previous));
    writeFileSync(cli.commentOut, formatComment(report, previous));
    console.log(`due=${report.findings.length}`);
    return 0;
  } catch (error) {
    console.error(`check-pricing-drift: 確かめられない: ${errorMessage(error)}`);
    return 1;
  }
}

if (isCliEntry(import.meta.url)) process.exit(await main(process.argv.slice(2)));
