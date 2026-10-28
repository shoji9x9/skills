#!/usr/bin/env node
// fallow の設定（`.fallowrc.json`）を生成する（lefthook pre-commit + CI の --check）。
// 元にするのは、手で書く設定（`.config/fallow/base.jsonc`）と、意図したコピーの宣言（`identical-copies.json`）である。
//
// なぜ要るか: 配布スキルは単独でインストールされるので、同じコードをコピーして持つ。fallow はコピーどうしの関係を知らず、
// テストが import しない側のコピーの export を、使われていないと判定する（テストは組の 1 つのコピーだけを import する）。
// コピーの宣言を原本にして、基準（組の最初のファイル）以外のコピーの export を `ignoreExports` に挙げる。
// 基準のコピーは検査に残すので、どのコピーでも使われていない export は、基準のコピーで検出される。
// ただし base.jsonc が `skills/**` の export をすべて外すので、基準が `skills/` にある組では検出されない。
// fallow の `extends` は `ignoreExports` を子の側の値で置き換えるので、手で書く例外とコピーの分を 1 つの一覧にまとめ、
// 設定の全体を生成する。fallow をそのまま起動しても（`-c` なし）、この設定が使われる。
//
// 生成の規則:
// - ファイル全体の組は、基準以外のコピーのすべての export を外す（`"*"`）。
// - 範囲（`region`）の組は、基準以外のコピーで、印の間で export する名前だけを外す。範囲の外の export は検査に残す。
//   名前は TypeScript の構文の解析で読む。
// - JavaScript・TypeScript でないファイル（Markdown・シェルなど）は fallow が読まないので挙げない。
// - 手で書く `ignoreExports` を先に置き、コピーの分をファイルの名前の順で後に置く。同じファイルは 1 つにまとめる。
// - 出力は oxfmt で整形する（pre-commit と CI の整形の検査を通すため）。
// - `--index` を付けると、作業ツリーではなく index の内容から生成する（一部だけを stage した commit に、stage していない内容を入れない）。
// - `--check` を付けると書き換えず、生成した内容と `.fallowrc.json` が違えば exit 1 にする。
// - 範囲の中で export しないコピーは、外す名前が無いので挙げない。
// - 入力が読めない・形が違う・範囲の印が崩れている・名前を読めない export は、生成できないので書き換えずに exit 2。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ParseError, parse } from "jsonc-parser";
import ts from "typescript";
import { errorMessage } from "../../../lib/errors.ts";
import { isRecord } from "../../../lib/guards.ts";
import { isArray } from "../../../lib/is-array.ts";
import {
  type CopyGroup,
  DECLARATION_PATH,
  extractRegion,
  parseGroups,
} from "./check-identical-copies.ts";
import { isCliEntry } from "../../../lib/cli/entry.ts";

/** oxfmt を入れたリポジトリ（このスクリプトのリポジトリ）。pnpm exec はここで実行する。 */
const TOOL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export const BASE_PATH = ".config/fallow/base.jsonc";
export const OUTPUT_PATH = ".fallowrc.json";

/** fallow が読む拡張子。 */
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;

export type IgnoreExport = { file: string; exports: string[] };

/** 生成の元にするファイルを、作業ツリーか index から読む。 */
export type Source = { fromIndex?: boolean };

function readSource(root: string, path: string, { fromIndex = false }: Source): string {
  if (!fromIndex) {
    if (!existsSync(join(root, path))) throw new Error(`${path} が無い`);
    return readFileSync(join(root, path), "utf8");
  }
  try {
    return execFileSync("git", ["show", `:${path}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`index の ${path} を読めない: ${errorMessage(error)}`, { cause: error });
  }
}

/** JSONC を読む。構文の誤りは例外にする（誤りを読み飛ばした設定から生成しない）。 */
export function parseJsonc(text: string, where: string): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: false });
  if (errors.length > 0)
    throw new Error(`${where} を JSONC として読めない（${errors.length} 件の誤り）`);
  return value;
}

/** 手で書く ignoreExports を読む。無ければ空。形が違えば例外にする。 */
export function baseIgnores(base: Record<string, unknown>): IgnoreExport[] {
  const list = base.ignoreExports;
  if (list === undefined) return [];
  if (!isArray(list)) throw new Error(`${BASE_PATH} の ignoreExports が配列でない`);
  return list.map((e, i) => {
    const file = isRecord(e) ? e.file : undefined;
    const exports = isRecord(e) ? e.exports : undefined;
    if (typeof file !== "string" || file === "")
      throw new Error(`${BASE_PATH} の ignoreExports[${i}].file が空でない文字列でない`);
    if (
      !isArray(exports) ||
      exports.length === 0 ||
      !exports.every((x) => typeof x === "string" && x !== "")
    ) {
      throw new Error(`${BASE_PATH} の ignoreExports[${i}].exports が空でない文字列の配列でない`);
    }
    return { file, exports: exports.map(String) };
  });
}

const hasModifier = (n: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === kind);

/** 名前を持つ宣言（関数・クラス・interface・型・enum）か。 */
const isNamedDeclaration = (
  s: ts.Statement,
): s is
  | ts.FunctionDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.EnumDeclaration =>
  ts.isFunctionDeclaration(s) ||
  ts.isClassDeclaration(s) ||
  ts.isInterfaceDeclaration(s) ||
  ts.isTypeAliasDeclaration(s) ||
  ts.isEnumDeclaration(s);

/** `export` を付けた宣言の名前。読めない形は例外にする（外す名前を取りこぼさない）。 */
function declarationNames(s: ts.Statement, path: string): string[] {
  if (hasModifier(s, ts.SyntaxKind.DefaultKeyword)) return ["default"];
  if (ts.isVariableStatement(s)) {
    return s.declarationList.declarations.map((d) => {
      if (!ts.isIdentifier(d.name)) throw new Error(`${path}: 分割代入の export は名前を読めない`);
      return d.name.text;
    });
  }
  if (isNamedDeclaration(s) && s.name) return [s.name.text];
  throw new Error(`${path}: export の形を読めない（${ts.SyntaxKind[s.kind]}）`);
}

/** 1 つの文が export する名前。 */
function statementNames(s: ts.Statement, path: string): string[] {
  if (ts.isExportDeclaration(s)) {
    if (s.exportClause && ts.isNamedExports(s.exportClause)) {
      return s.exportClause.elements.map((e) => e.name.text);
    }
    if (s.exportClause && ts.isNamespaceExport(s.exportClause)) return [s.exportClause.name.text];
    // `export * from` は名前を持たないので、外す名前を決められない。
    throw new Error(`${path}: export * の名前を読めない`);
  }
  if (ts.isExportAssignment(s)) return ["default"];
  return hasModifier(s, ts.SyntaxKind.ExportKeyword) ? declarationNames(s, path) : [];
}

/** モジュールが export する名前（宣言の export と `export { a, b as c }`）。`export default` は "default"。 */
export function exportedNames(text: string, path: string): string[] {
  const kind = /\.[cm]?tsx?$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
  return [...new Set(sf.statements.flatMap((s) => statementNames(s, path)))].sort();
}

/** 範囲の印の間の行。印が崩れていれば例外にする。 */
function regionText(text: string, region: string, path: string): string {
  const m = extractRegion(text, region);
  if ("error" in m) throw new Error(`${path}: ${m.error}`);
  return m.body;
}

/** コピーの組から、基準（組の最初のファイル）以外のコピーの ignoreExports を作る。 */
export function copyIgnores(
  groups: readonly CopyGroup[],
  read: (path: string) => string,
): IgnoreExport[] {
  // 基準以外のコピーごとの、外す名前。範囲の中で export しないコピー（関数をファイルの中だけで使う雛形など）は空になる。
  const found = (g: CopyGroup, file: string) =>
    g.region === undefined ? ["*"] : exportedNames(regionText(read(file), g.region, file), file);
  const copies = groups.flatMap((g) =>
    g.files.slice(1).flatMap((file) => (SOURCE_EXT.test(file) ? [{ g, file }] : [])),
  );
  const byFile = new Map<string, Set<string>>();
  for (const { g, file } of copies) {
    const names = byFile.get(file) ?? new Set<string>();
    for (const n of found(g, file)) names.add(n);
    if (names.size > 0) byFile.set(file, names);
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, names]) => ({ file, exports: names.has("*") ? ["*"] : [...names].sort() }));
}

/** oxfmt で JSON を整形する。 */
function format(text: string): string {
  const res = spawnSync("pnpm", ["exec", "oxfmt", `--stdin-filepath=${OUTPUT_PATH}`], {
    cwd: TOOL_ROOT,
    input: text,
    encoding: "utf8",
    // oxfmt は 1 ファイルなら 1 秒かからない。止まったときに待ち続けないよう打ち切る。
    timeout: 60_000,
  });
  if (res.error) throw res.error;
  if (res.status !== 0)
    throw new Error(`oxfmt が終了コード ${res.status} で失敗した: ${res.stderr}`);
  return res.stdout;
}

/** 生成する設定の全文。 */
export function renderConfig(root: string, source: Source = {}): string {
  const base = parseJsonc(readSource(root, BASE_PATH, source), BASE_PATH);
  if (!isRecord(base)) throw new Error(`${BASE_PATH} が object でない`);
  if (base.extends !== undefined)
    throw new Error(`${BASE_PATH} に extends を書かない（生成した設定が全体を持つ）`);
  const groups = parseGroups(JSON.parse(readSource(root, DECLARATION_PATH, source)));
  const ignoreExports = [
    ...baseIgnores(base),
    ...copyIgnores(groups, (p) => readSource(root, p, source)),
  ];
  // $schema は設定のファイルの場所から読むので、生成した設定（リポジトリの直下）からのパスにする。
  const config = { ...base, $schema: "./node_modules/fallow/schema.json", ignoreExports };
  return format(`${JSON.stringify(config, null, 2)}\n`);
}

/** 生成して書く（check なら書かずに比べる）。0: 同じか書いた、1: check で違う、2: 生成できない。 */
export function main(argv: string[], root = process.cwd()): number {
  const args = argv.filter((a) => a !== "--");
  const unknown = args.filter((a) => a !== "--index" && a !== "--check");
  if (unknown.length > 0) {
    console.error(
      `fallow-config: 知らない引数: ${unknown.join(" ")}（使い方: [--index] [--check]）`,
    );
    return 2;
  }
  let expected: string;
  try {
    expected = renderConfig(root, { fromIndex: args.includes("--index") });
  } catch (error) {
    console.error(`fallow-config: ${OUTPUT_PATH} を生成できない: ${errorMessage(error)}`);
    return 2;
  }
  const path = join(root, OUTPUT_PATH);
  const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (current === expected) {
    console.log("fallow-config: 変更なし");
    return 0;
  }
  if (args.includes("--check")) {
    console.error(
      `fallow-config: ${OUTPUT_PATH} が ${BASE_PATH} と ${DECLARATION_PATH} から生成した内容と違う。` +
        " node scripts/gates/packaging/copies/generate-fallow-config.ts で生成し直す（手で直さない）",
    );
    return 1;
  }
  writeFileSync(path, expected);
  console.log(`fallow-config: ${OUTPUT_PATH} を生成し直した`);
  return 0;
}

if (isCliEntry(import.meta.url)) process.exit(main(process.argv.slice(2)));
