#!/usr/bin/env node
// 文書の階層（Tier）の表と、Markdown の分類をチェックする（lefthook pre-commit + CI）。
//
// 階層の原本は `scripts/gates/doc-tiers.json`。`.agents/rules/doc-altitude.md` の表はそこから生成する。
// 表を手で書くと、参照のチェック（check-doc-refs.js）が使う分類と食い違う。
//
// 判定規則:
// - doc-altitude.md の印（BEGIN と END）の間を、doc-tiers.json から生成した内容と比べる。
//   食い違いは exit 1。`--fix` を付けると生成した内容で書き換える。
// - Markdown（コピーとリンクを除く。scripts/lib/source-scope.js）は、glob を持つ項目のちょうど 1 つに当たること。
//   0 件（どの階層にも属さない）と 2 件以上（階層が重なる）は exit 1。
// - どの Markdown にも当たらない glob も exit 1（ファイルを移した後に残った項目を見つける）。
// - doc-tiers.json の形の誤り（Tier が 1〜4 の順でない・項目に glob も label も無い・「|」を含む・glob の重複）と、
//   印が無い・Markdown が 0 件は exit 2。
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listSources } from "./run-on-sources.js";

export const TIERS_PATH = "scripts/gates/doc-tiers.json";
export const TABLE_PATH = ".agents/rules/doc-altitude.md";
export const BEGIN = `<!-- doc-tiers:begin（${TIERS_PATH} から scripts/gates/check-doc-tiers.js --fix で生成する。手で直さない） -->`;
export const END = "<!-- doc-tiers:end -->";

const isText = (v) => typeof v === "string" && v.trim() !== "";

/**
 * glob を正規表現にする。`**` は 0 個以上のディレクトリ、`*` は `/` を含まない 0 文字以上。
 * ドットで始まる名前（`.replace/`・`.kaizen/`）にも当てる。node:path の matchesGlob は当てないので使わない。
 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const matchesGlob = (rel, glob) => globToRegExp(glob).test(rel);

/** doc-tiers.json を読み、形を確かめる。形の誤りは例外にする。 */
export function loadDocTiers(root) {
  const path = join(root, TIERS_PATH);
  if (!existsSync(path)) throw new Error(`${TIERS_PATH} が無い`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  const { tiers, outside } = data ?? {};
  if (!Array.isArray(tiers) || !Array.isArray(outside))
    throw new Error("tiers と outside は配列にする");
  if (tiers.map((t) => t?.tier).join(",") !== "1,2,3,4")
    throw new Error("tiers は tier 1〜4 をこの順に 1 つずつ持つ");
  const globs = new Set();
  const checkEntry = (e, where) => {
    if (!isText(e?.glob) && !isText(e?.label))
      throw new Error(`${where}: glob か label のどちらかを持つ`);
    for (const k of ["glob", "label", "note"]) {
      if (e[k] !== undefined && !isText(e[k])) throw new Error(`${where}: ${k} は空でない文字列`);
      if (e[k]?.includes("|")) throw new Error(`${where}: ${k} に「|」がある（表の列がずれる）`);
    }
    if (e.glob !== undefined) {
      if (globs.has(e.glob)) throw new Error(`${where}: glob「${e.glob}」が重複している`);
      globs.add(e.glob);
    }
  };
  for (const t of tiers) {
    if (!isText(t.contents) || t.contents.includes("|"))
      throw new Error(`tier ${t.tier}: contents は「|」を含まない空でない文字列`);
    if (!Array.isArray(t.docs) || t.docs.length === 0)
      throw new Error(`tier ${t.tier}: docs は空でない配列`);
    t.docs.forEach((e, i) => checkEntry(e, `tier ${t.tier} の docs[${i}]`));
  }
  outside.forEach((e, i) => {
    checkEntry(e, `outside[${i}]`);
    if (!isText(e.glob)) throw new Error(`outside[${i}]: glob を持つ`);
  });
  return { tiers, outside };
}

const show = (e) => `${e.label ?? `\`${e.glob}\``}${e.note ? `（${e.note}）` : ""}`;

/** 印の間に置く内容（印を含む）。 */
export function renderTable({ tiers, outside }) {
  return [
    BEGIN,
    "",
    "| Tier | 文書 | 置くもの |",
    "| --- | --- | --- |",
    ...tiers.map((t) => `| ${t.tier} | ${t.docs.map(show).join("、")} | ${t.contents} |`),
    "",
    `階層の外に置く文書: ${outside.map(show).join("、")}。`,
    "",
    END,
  ].join("\n");
}

/** glob を持つ項目の一覧（{ glob, tier }。階層の外は tier: null）。 */
export function globEntries({ tiers, outside }) {
  return [
    ...tiers.flatMap((t) =>
      t.docs.filter((e) => e.glob).map((e) => ({ glob: e.glob, tier: t.tier })),
    ),
    ...outside.map((e) => ({ glob: e.glob, tier: null })),
  ];
}

/**
 * リポジトリ相対パスの階層。当たる項目がちょうど 1 つならその tier（階層の外は null）、
 * 0 件か 2 件以上なら undefined。
 */
export function tierOf(config, rel) {
  const hits = globEntries(config).filter((e) => matchesGlob(rel, e.glob));
  return hits.length === 1 ? hits[0].tier : undefined;
}

/**
 * @param {string} root リポジトリルート（テストでは一時ディレクトリ）
 * @param {{ fix?: boolean }} options
 * @returns {{ files: string[], tableOk: boolean, fixed: boolean, violations: string[] }}
 */
export function checkDocTiers(root, { fix = false } = {}) {
  const config = loadDocTiers(root);
  const tablePath = join(root, TABLE_PATH);
  if (!existsSync(tablePath)) throw new Error(`${TABLE_PATH} が無い`);
  const text = readFileSync(tablePath, "utf8");
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  if (b < 0 || e < b) throw new Error(`${TABLE_PATH} に印（${BEGIN} と ${END}）が無い`);
  const expected = text.slice(0, b) + renderTable(config) + text.slice(e + END.length);
  let tableOk = expected === text;
  let fixed = false;
  if (!tableOk && fix) {
    writeFileSync(tablePath, expected);
    tableOk = true;
    fixed = true;
  }

  const files = listSources(root, ["md"]);
  if (files.length === 0) throw new Error("Markdown が 0 件。列挙できていない");
  const entries = globEntries(config);
  const used = new Set();
  const violations = [];
  for (const f of files) {
    const hits = entries.filter((x) => matchesGlob(f, x.glob));
    hits.forEach((x) => used.add(x.glob));
    if (hits.length === 0) violations.push(`${f}: どの階層にも属さない`);
    else if (hits.length > 1)
      violations.push(`${f}: 複数の項目に当たる（${hits.map((x) => x.glob).join("、")}）`);
  }
  for (const x of entries) {
    if (!used.has(x.glob))
      violations.push(`${TIERS_PATH}: glob「${x.glob}」に当たる Markdown が無い`);
  }
  return { files, tableOk, fixed, violations };
}

export function main(argv) {
  const args = argv.filter((a) => a !== "--");
  const fix = args.includes("--fix");
  const root = args.find((a) => a !== "--fix") ?? process.cwd();
  let result;
  try {
    result = checkDocTiers(root, { fix });
  } catch (error) {
    console.error(`doc-tiers: チェックできない: ${error.message}`);
    return 2;
  }
  const { files, tableOk, fixed, violations } = result;
  if (fixed) console.log(`doc-tiers: ${TABLE_PATH} の表を ${TIERS_PATH} から生成し直した`);
  if (!tableOk) {
    console.error(
      `doc-tiers: ${TABLE_PATH} の表が ${TIERS_PATH} と食い違う。` +
        "Fix: node scripts/gates/check-doc-tiers.js --fix",
    );
  }
  if (violations.length) {
    console.error(`doc-tiers: ${files.length} 件の Markdown のうち ${violations.length} 件の不備:`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      `Fix: ${TIERS_PATH} の項目を足すか直して、Markdown がちょうど 1 つの項目に当たるようにする。`,
    );
  }
  if (!tableOk || violations.length) return 1;
  console.log(`doc-tiers: OK（${files.length} 件の Markdown）`);
  return 0;
}

// CLI エントリ判定は両辺を実パスへ揃える（片側だけの解決は symlink 経由の起動で何もせずに終わる）。
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`doc-tiers: 起動パスを正規化できない: ${error.message}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
