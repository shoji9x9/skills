#!/usr/bin/env node
// 重複したコード（JS/TS・シェル・Markdown。テストを含む）を jscpd で検出し、ベースラインに無い重複を失敗にする（lefthook pre-commit + CI）。
//
// なぜ要るか: 同じ処理を複数の箇所にコピーすると、片方だけを直して食い違う。配布スキルは単独で動くよう作りとしてコードを
// コピーするので、登録していないコピーが繰り返し生じる。
//
// 判定規則:
// - jscpd の設定（閾値・形式・除外）は `.jscpd.json` に置く。インストール済みのコピーとリンク、外部のパッケージから作った生成物は、
//   `scripts/lib/source-scope.ts` から計算して除く（jscpd は `.agents/` も走査するので、コピーの名前を設定に書き写さない）。
// - 意図したコピー（`identical-copies.json` の組）どうしの重複は数えない。一致は `check-identical-copies.ts` が確かめる。
//   ファイル全体の組は、同じ組の 2 つのファイルの間の重複を外す。範囲（`region`）を持つ組は、両方の断片がそれぞれの
//   ファイルの範囲と重なる重複を外す。範囲の中に収まる条件にしないのは、範囲の印の行や直前の説明のコメントも同じなので、
//   jscpd の断片が範囲の外へ数行広がるからである。範囲と重ならない重複は、登録していないコピーとして数える。
// - 既存の重複はベースライン（`.config/jscpd/baseline.json`。jscpd の指紋）に載せる。ベースラインに無い重複（jscpd の `isNew`）を失敗にする。
//   直すかどうかは内容を見て決め、残すなら `--update-baseline` で載せ直す。
// - `--update-baseline` は登録済みのコピーの重複もベースラインに載せる（jscpd のレポートは指紋を出さないので、ベースラインから除けない）。
//   そのため、載せたときの組を `.config/jscpd/declared-groups.json` に控える。控えた組の 2 つのファイルの重複は、
//   組を宣言から外した後はベースラインにあっても失敗にする（外した組のコピーが、登録していないコピーとして残るのを見逃さない）。
// - ベースラインか控えが無い・jscpd が失敗した・レポートを読めない・走査したファイルが 0 件・範囲の印が崩れている、は判定できないので exit 2。
//   ベースラインが無いと jscpd はすべての重複を新しくないと報告するので、無いまま合格にしない。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "../../lib/errors.ts";
import { isRecord } from "../../lib/guards.ts";
import { isArray } from "../../lib/is-array.ts";
import { VENDORED_GLOBS, agentCopyGlobs } from "../../lib/source-scope.ts";
import {
  type CopyGroup,
  loadGroups,
  regionMarkers,
} from "../packaging/copies/check-identical-copies.ts";

/** jscpd を入れたリポジトリ（このスクリプトのリポジトリ）。pnpm exec はここで実行する。 */
const TOOL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const CONFIG_PATH = ".jscpd.json";
export const BASELINE_PATH = ".config/jscpd/baseline.json";
/** ベースラインを作り直したときの、登録済みのコピーの組（ファイルの一覧）。 */
export const DECLARED_PATH = ".config/jscpd/declared-groups.json";

/** jscpd のレポートの 1 つの断片。行番号は 1 始まりで、両端を含む。 */
export type Fragment = { name: string; start: number; end: number };
export type Clone = {
  format: string;
  lines: number;
  isNew: boolean;
  first: Fragment;
  second: Fragment;
};

function fragmentOf(value: unknown, where: string): Fragment {
  if (!isRecord(value)) throw new Error(`${where} が object でない`);
  const { name, start, end } = value;
  if (typeof name !== "string" || name === "")
    throw new Error(`${where}.name が空でない文字列でない`);
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(`${where}.start と ${where}.end が整数でない`);
  }
  return { name, start: Number(start), end: Number(end) };
}

/** jscpd の JSON のレポートから、重複と走査したファイルの数を読む。形が違えば例外にする（読めないレポートを 0 件として扱わない）。 */
export function parseReport(value: unknown): { sources: number; clones: Clone[] } {
  if (!isRecord(value)) throw new Error("レポートが object でない");
  const { duplicates, statistics } = value;
  if (!isArray(duplicates)) throw new Error("duplicates が配列でない");
  const total = isRecord(statistics) && isRecord(statistics.total) ? statistics.total : undefined;
  if (!total || !Number.isInteger(total.sources))
    throw new Error("statistics.total.sources が整数でない");
  const clones = duplicates.map((d, i) => {
    if (!isRecord(d)) throw new Error(`duplicates[${i}] が object でない`);
    const { format, lines, isNew } = d;
    if (typeof isNew !== "boolean") throw new Error(`duplicates[${i}].isNew が真偽値でない`);
    if (typeof format !== "string" || format === "")
      throw new Error(`duplicates[${i}].format が空でない文字列でない`);
    if (!Number.isInteger(lines) || Number(lines) < 1)
      throw new Error(`duplicates[${i}].lines が 1 以上の整数でない`);
    return {
      format,
      lines: Number(lines),
      isNew,
      first: fragmentOf(d.firstFile, `duplicates[${i}].firstFile`),
      second: fragmentOf(d.secondFile, `duplicates[${i}].secondFile`),
    };
  });
  return { sources: Number(total.sources), clones };
}

/** 範囲の中身の行（1 始まり、両端を含む）。印が崩れていれば例外にする。 */
type Range = { start: number; end: number };

/**
 * 意図したコピーどうしの重複か。同じ組に属する 2 つのファイルの間の重複で、範囲を持つ組なら両方の断片がそれぞれの範囲と重なるもの。
 * rangeOf は、ファイルと範囲の名前から、範囲の中身の行を返す。
 */
export function isDeclaredCopy(
  clone: Clone,
  groups: readonly CopyGroup[],
  rangeOf: (file: string, region: string) => Range,
): boolean {
  const { first, second } = clone;
  if (first.name === second.name) return false;
  const overlaps = (f: Fragment, r: Range) => f.start <= r.end && f.end >= r.start;
  return groups.some((g) => {
    if (!g.files.includes(first.name) || !g.files.includes(second.name)) return false;
    if (g.region === undefined) return true;
    return (
      overlaps(first, rangeOf(first.name, g.region)) &&
      overlaps(second, rangeOf(second.name, g.region))
    );
  });
}

/** 控えた組のどれかに 2 つのファイルが入っていて、今の組のどれにも一緒に入っていない重複か（組を宣言から外した後に残ったコピー）。 */
export function isUndeclaredCopy(
  clone: Clone,
  declared: readonly (readonly string[])[],
  groups: readonly CopyGroup[],
): boolean {
  const { first, second } = clone;
  if (first.name === second.name) return false;
  const together = (files: readonly string[]) =>
    files.includes(first.name) && files.includes(second.name);
  return declared.some(together) && !groups.some((g) => together(g.files));
}

/** 控えた組を読む。形が違えば例外にする。 */
export function loadDeclared(root: string): string[][] {
  const data: unknown = JSON.parse(readFileSync(join(root, DECLARED_PATH), "utf8"));
  const groups = isRecord(data) ? data.groups : undefined;
  const isFiles = (g: unknown): g is string[] =>
    isArray(g) && g.every((f) => typeof f === "string" && f !== "");
  if (!isArray(groups) || !groups.every(isFiles)) {
    throw new Error(`${DECLARED_PATH} の groups がファイルの一覧の配列でない`);
  }
  return groups;
}

/** ファイルの範囲の中身の行を返す関数。読んだ結果を覚えておく。 */
export function regionReader(root: string): (file: string, region: string) => Range {
  const cache = new Map<string, Range>();
  return (file, region) => {
    const key = `${file}#${region}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const m = regionMarkers(readFileSync(join(root, file), "utf8"), region);
    if ("error" in m) throw new Error(`${file}: ${m.error}`);
    // 0 始まりの印の行の間を、1 始まりの行番号にする（begin の次の行から、end の前の行まで）。
    const range = { start: m.begin + 2, end: m.end };
    cache.set(key, range);
    return range;
  };
}

/** 設定の除外（`.jscpd.json` の `ignore`）。引数の `--ignore` は設定の除外を置き換えるので、読んで引数に含める。 */
export function configIgnores(root: string): string[] {
  const config: unknown = JSON.parse(readFileSync(join(root, CONFIG_PATH), "utf8"));
  const ignore = isRecord(config) ? config.ignore : undefined;
  if (!isArray(ignore) || !ignore.every((g) => typeof g === "string" && g !== "")) {
    throw new Error(`${CONFIG_PATH} の ignore が空でない文字列の配列でない`);
  }
  return ignore.map(String);
}

/** jscpd に渡す引数。除外は、設定の除外に、コピーとリンクと生成物を足す。 */
function jscpdArgs(root: string, output: string, updateBaseline: boolean): string[] {
  const ignore = [...configIgnores(root), ...agentCopyGlobs(root), ...VENDORED_GLOBS].join(",");
  // 走査するリポジトリ（root）は絶対パスで渡す。jscpd はこのスクリプトのリポジトリから起動するので、root がその外にあってもよい。
  return [
    "exec",
    "jscpd",
    root,
    "--config",
    join(root, CONFIG_PATH),
    "--ignore",
    ignore,
    "--baseline",
    join(root, BASELINE_PATH),
    ...(updateBaseline ? ["--update-baseline"] : []),
    "--absolute",
    "--reporters",
    "json",
    "--output",
    output,
    "--silent",
  ];
}

/** jscpd を実行してレポートを読む。断片の名前は root からの相対パスにする。失敗は例外にする。 */
function runJscpd(root: string, updateBaseline: boolean): { sources: number; clones: Clone[] } {
  const output = mkdtempSync(join(tmpdir(), "jscpd-"));
  // jscpd はベースラインを作るときに親のディレクトリを作らない。
  if (updateBaseline) mkdirSync(dirname(join(root, BASELINE_PATH)), { recursive: true });
  try {
    const res = spawnSync("pnpm", jscpdArgs(root, output, updateBaseline), {
      cwd: TOOL_ROOT,
      encoding: "utf8",
      // jscpd はリポジトリ全体でも 1 秒ほどで終わる。止まったときに待ち続けないよう打ち切る。
      timeout: 120_000,
    });
    if (res.error) throw res.error;
    if (res.status !== 0)
      throw new Error(`jscpd が終了コード ${res.status} で失敗した: ${res.stderr}`);
    const report = parseReport(JSON.parse(readFileSync(join(output, "jscpd-report.json"), "utf8")));
    const rel = (f: Fragment) => ({ ...f, name: relative(root, f.name) });
    return {
      ...report,
      clones: report.clones.map((c) => ({ ...c, first: rel(c.first), second: rel(c.second) })),
    };
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

function describe(c: Clone): string {
  const at = (f: Fragment) => `${f.name}:${f.start}-${f.end}`;
  return `${at(c.first)} と ${at(c.second)}（${c.format}・${c.lines} 行）`;
}

/** ベースラインに無く登録済みのコピーでもない重複と、組を宣言から外した後に残ったコピーを報告する。終了コードを返す。 */
function report(root: string, sources: number, clones: Clone[]): number {
  const groups = loadGroups(root);
  const declared = loadDeclared(root);
  const rangeOf = regionReader(root);
  const fresh = clones.filter((c) =>
    c.isNew ? !isDeclaredCopy(c, groups, rangeOf) : isUndeclaredCopy(c, declared, groups),
  );
  if (fresh.length === 0) {
    console.log(
      `duplicates: OK（${sources} ファイル・${clones.length} 件の重複はすべてベースラインか登録済みのコピー）`,
    );
    return 0;
  }
  console.error(
    `duplicates: ベースラインに無いか、宣言から外した組に残った重複が ${fresh.length} 件:`,
  );
  for (const c of fresh) console.error(`  - ${describe(c)}`);
  console.error(
    "Fix: 共通化できるならまとめる。配布スキルの間のように共通化できないコピーは scripts/gates/packaging/copies/identical-copies.json に" +
      ` 組として登録する。残すと決めた重複は node scripts/gates/code/check-duplicates.ts --update-baseline で ${BASELINE_PATH} に載せる。`,
  );
  return 1;
}

/** 検査して終了コードを返す。0: 新しい重複なし、1: 新しい重複あり、2: 判定できない。 */
export function main(argv: string[], root = process.cwd()): number {
  const updateBaseline = argv.includes("--update-baseline");
  const unknown = argv.filter((a) => a !== "--update-baseline" && a !== "--");
  if (unknown.length) {
    console.error(`duplicates: 知らない引数: ${unknown.join(" ")}（使い方: [--update-baseline]）`);
    return 2;
  }
  const missing = [BASELINE_PATH, DECLARED_PATH].filter((p) => !existsSync(join(root, p)));
  if (!updateBaseline && missing.length) {
    console.error(
      `duplicates: ${missing.join("・")} が無いので判定できない。` +
        "既存の重複を載せるなら --update-baseline で作る",
    );
    return 2;
  }
  try {
    const { sources, clones } = runJscpd(root, updateBaseline);
    if (sources === 0) {
      console.error("duplicates: 走査したファイルが 0 件（設定の形式と除外を確かめる）");
      return 2;
    }
    if (!updateBaseline) return report(root, sources, clones);
    const files = loadGroups(root).map((g) => [...g.files].sort());
    writeFileSync(join(root, DECLARED_PATH), `${JSON.stringify({ groups: files }, null, 2)}\n`);
    console.log(`duplicates: ベースラインを作り直した（${sources} ファイル・${clones.length} 件）`);
    return 0;
  } catch (error) {
    console.error(`duplicates: 判定できない: ${errorMessage(error)}`);
    return 2;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
