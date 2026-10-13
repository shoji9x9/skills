#!/usr/bin/env node
// 配布スキルの `.mjs` で、型の検査を警告なしに外す JSDoc の書き方を検査する（lefthook pre-commit + CI）。
// `.mjs` は `tsconfig.skills.json` の `checkJs` で型を検査するが、次の書き方は検査を外してもエラーにならない。
// TypeScript の側で同じ書き方を禁じている `oxlint.config.ts` の規則は、JavaScript の JSDoc を読まないので、ここで検査する。
//   - JSDoc の型の表明 `/** @type {X} */ (v)`。TypeScript の `as X` と同じで、絞り込みを確かめずに型を付ける。
//     宣言の注釈（`/** @type {X} */ const v = ...`）・`@satisfies`・`/** @type {const} */ (v)` は、型を外さないので許す。
//   - JSDoc の型の `any`・`*`・`?` と、`Function`・型引数の無い `Object`・型引数の足りない `Generator`・`Iterable` など。
//     どれも `any` として扱われるか、型引数が `any` になる。
//     `Function` も、呼び出しの戻り値が `any` になるので同じ扱いにする。
//   - `@ts-ignore`・`@ts-expect-error`・`@ts-nocheck` のコメント。
// 対象は `tsconfig.skills.json` の include と同じ、`skills/*/**/*.mjs`。
// 構文は TypeScript のパーサで読む。文字列・正規表現・テンプレートの中の `/**` や `@ts-ignore` を、コメントとして扱わない。
// 型引数の数の判定だけは、`tsconfig.skills.json` から作った Program の型チェッカーで名前を解決して調べる。
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { listFiles, repoRoot } from "./check-js-extensions.ts";
import { errorMessage } from "../../lib/errors.ts";

const TARGET_RE = /^skills\/[^/]+\/.*\.mjs$/;
// TypeScript が指示として読む位置の @ts-*。行コメントは先頭、ブロックコメントは最後の行の先頭だけを読む
// （TypeScript の scanner の commentDirectiveRegExSingleLine / MultiLine と同じ）。説明の文章の途中の語や、
// 複数行のブロックコメントの途中の行は指示ではないので数えない。@ts-nocheck は行コメントでだけ有効になる。
const LINE_DIRECTIVE_RE = /^\/\/\/?\s*(@ts-(?:ignore|expect-error|nocheck))\b/;
const BLOCK_DIRECTIVE_RE = /^(?:\/|\*)*\s*(@ts-(?:ignore|expect-error))\b/;

/** コメント 1 つの中の @ts-* の指示と、その位置（コメントの先頭からの文字数）。指示でなければ null。 */
function directiveOf(comment: string): { name: string; offset: number } | null {
  if (comment.startsWith("//")) {
    const m = LINE_DIRECTIVE_RE.exec(comment);
    return m ? { name: m[1], offset: 0 } : null;
  }
  const lastLineStart = comment.lastIndexOf("\n") + 1;
  const m = BLOCK_DIRECTIVE_RE.exec(comment.slice(lastLineStart));
  return m ? { name: m[1], offset: lastLineStart } : null;
}
// 型引数の一部を省いても tsc がエラーにせず、省いた型引数のデフォルトが any になるジェネリック型がある。
// `Generator<T = unknown, TReturn = any, TNext = any>` は 3 つ、`IteratorResult<T, TReturn = any>` は 2 つ書く必要がある。
// 型の名前ではなく、型チェッカーで解決した宣言の型引数を調べる。名前で照合すると、同じ名前の別の型（自分で @typedef した
// Iterator など）を誤検知し、修飾した名前（globalThis.Generator）を見逃すためである。
// 書いていない位置のうち、デフォルトが any になる最後の位置までを、書く必要のある数とする。
// `Array`・`Promise`・`Map` などデフォルトの無いものは、型引数を省くと tsc が TS2314 で失敗にするので、ここには入らない。

/** 型引数を持ちうる型の宣言（interface・type・class・JSDoc の @typedef と @callback）。 */
function declaresTypeParameters(d: ts.Node): d is ts.DeclarationWithTypeParameters {
  return (
    ts.isInterfaceDeclaration(d) ||
    ts.isTypeAliasDeclaration(d) ||
    ts.isClassLike(d) ||
    ts.isJSDocTypedefTag(d) ||
    ts.isJSDocCallbackTag(d)
  );
}

/** 型参照が指す宣言で、any を避けるのに書く必要のある型引数の数（デフォルトが any の最後の位置 + 1）。 */
function anyDefaultArity(name: ts.Node, checker: ts.TypeChecker): number {
  let symbol = checker.getSymbolAtLocation(name);
  if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  let arity = 0;
  // 同じ名前の宣言が複数の lib にあれば（版ごとの Iterator など）、多いほうに合わせる。
  for (const declaration of symbol?.declarations ?? []) {
    if (!declaresTypeParameters(declaration)) continue;
    ts.getEffectiveTypeParameterDeclarations(declaration).forEach((p, i) => {
      if (
        p.default !== undefined &&
        checker.getTypeFromTypeNode(p.default).flags & ts.TypeFlags.Any
      ) {
        arity = Math.max(arity, i + 1);
      }
    });
  }
  return arity;
}

/** 検査の対象のパス（リポジトリのルートからの `/` 区切り）か。 */
export const isTarget = (path: string): boolean => TARGET_RE.test(path);

/** JSDoc の型のうち、`any` として扱われるものなら、その書き方を返す。 */
function anyLike(node: ts.Node, sf: ts.SourceFile, checker: () => ts.TypeChecker): string | null {
  if (node.kind === ts.SyntaxKind.AnyKeyword) return "any";
  if (node.kind === ts.SyntaxKind.JSDocAllType) return "*";
  if (node.kind === ts.SyntaxKind.JSDocUnknownType) return "?";
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "Object" &&
    node.typeArguments === undefined
  )
    return "Object";
  // `Function` は呼び出しの戻り値が `any` になる（`f().x` を tsc が検査しない）。
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    (node.typeName.text === "Function" || node.typeName.text === "function")
  )
    return "Function";
  // 型引数を省くと、デフォルトの any が入るジェネリック型（`Generator<string>` は `Generator<string, any, any>`）。
  // `import("x").T` の形（ImportTypeNode）も同じく調べる。`@types/node` の `ReadableStream<R = any>` のように、
  // import した先の型もデフォルトが any でありうる。
  // `typeof import("x").C` は値（クラスそのもの）の型で、型引数で具体化しないので対象にしない。
  const target = ts.isTypeReferenceNode(node)
    ? { ref: node.typeName, typeArguments: node.typeArguments }
    : ts.isImportTypeNode(node) && !node.isTypeOf && node.qualifier !== undefined
      ? { ref: node.qualifier, typeArguments: node.typeArguments }
      : // `@extends {X}`・`@augments {X}`・`@implements {X}` の X も、省いた型引数に any が入る。
        // タグの無い `class S extends X {}` は対象にしない。このチェックが調べるのは JSDoc に書いた型で、
        // 型を書いていない継承（X の型引数はデフォルトになる）は、書き方の誤りとして検出する対象の外にある。
        ts.isExpressionWithTypeArguments(node) &&
          (ts.isJSDocAugmentsTag(node.parent) || ts.isJSDocImplementsTag(node.parent))
        ? { ref: node.expression, typeArguments: node.typeArguments }
        : undefined;
  if (target !== undefined) {
    const { ref, typeArguments } = target;
    const arity = anyDefaultArity(ref, checker());
    if ((typeArguments?.length ?? 0) < arity)
      return `型引数の足りない ${ref.getText(sf)}（${arity} つ書く）`;
  }
  return null;
}

/**
 * 括弧に付いた `@type` が、型の検査を外す表明か。`@type {const}` は TypeScript の `as const` と同じで、
 * 値から型を狭めるだけで検査を外さないので、表明として扱わない（`oxlint.config.ts` も `as const` を許している）。
 */
function isCast(tag: ts.JSDocTypeTag | undefined): boolean {
  if (tag === undefined) return false;
  const type = tag.typeExpression.type;
  return !(
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "const"
  );
}

/**
 * 括弧そのものに付いた `@type`。`getJSDocTypeTag` は親の宣言の JSDoc までさかのぼるので、
 * `/** @type {X} *\/ const v = (w);` の宣言の注釈まで表明として数えてしまう。TypeScript が表明として読むのは、
 * 括弧の直前に置いた JSDoc だけである。
 */
function ownTypeTag(node: ts.ParenthesizedExpression): ts.JSDocTypeTag | undefined {
  const tag = ts.getJSDocTypeTag(node);
  return tag?.parent.parent === node ? tag : undefined;
}

// テストのメモリの上の Program だけが使う設定。言語の設定（target・lib・module・strict）は `tsconfig.skills.json` に
// 揃える。型の宣言（`types: ["node"]`）と `paths` は読まない。テストの結果を、リポジトリの node_modules と
// `types/skill-runtime/` の中身に依存させないためである。import した先の型の判定は、宣言のファイルを置いた
// 一時リポジトリで CLI を実行して確かめる（`check-jsdoc-types.test.ts`）。
const MEMORY_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: true,
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2024,
  lib: ["lib.es2024.d.ts", "lib.dom.d.ts"],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  types: [],
};
// lib の構文木は、メモリの上の Program の間で使い回す（毎回読み直すと 1 件ごとに 1 秒近くかかる）。
const libCache = new Map<string, ts.SourceFile>();

/** 1 ファイルだけのメモリの上の Program で、違反を求める（テストと、断片の検査に使う）。 */
export function findEscapes(path: string, text: string): string[] {
  const abs = resolve("/", path);
  const host = ts.createCompilerHost(MEMORY_OPTIONS, true);
  const readLib = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    if (fileName === abs)
      return ts.createSourceFile(abs, text, languageVersion, true, ts.ScriptKind.JS);
    const cached = libCache.get(fileName);
    if (cached !== undefined) return cached;
    const sf = readLib(fileName, languageVersion, ...rest);
    if (sf !== undefined) libCache.set(fileName, sf);
    return sf;
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileName === abs || fileExists(fileName);
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => (fileName === abs ? text : readFile(fileName));
  const program = ts.createProgram([abs], MEMORY_OPTIONS, host);
  const sf = program.getSourceFile(abs);
  if (sf === undefined) throw new Error(`${path} を Program に読み込めない`);
  return findEscapesIn(sf, () => program.getTypeChecker());
}

/** 1 ファイルの違反（`行: 理由`）。型チェッカーは、型参照を見つけたときだけ作る。 */
export function findEscapesIn(sf: ts.SourceFile, checker: () => ts.TypeChecker): string[] {
  const text = sf.text;
  const out: string[] = [];
  const seenComments = new Set<number>();
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const visit = (node: ts.Node) => {
    // コメントは、トークンを含むすべての子の前と後ろに付く。同じコメントを 2 回数えないよう、位置で重複を除く。
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    ]) {
      if (seenComments.has(range.pos)) continue;
      seenComments.add(range.pos);
      const d = directiveOf(text.slice(range.pos, range.end));
      if (d) out.push(`${lineOf(range.pos + d.offset)}: ${d.name} で型の検査を外さない`);
    }
    if (ts.isParenthesizedExpression(node) && isCast(ownTypeTag(node))) {
      out.push(
        `${lineOf(node.getStart(sf))}: JSDoc の型の表明（/** @type {X} */ (v)）を使わない。型ガードで絞る`,
      );
    }
    const any = anyLike(node, sf, checker);
    if (any) out.push(`${lineOf(node.getStart(sf))}: JSDoc の型に ${any} を書かない`);
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  return out;
}

export const TSCONFIG_PATH = "tsconfig.skills.json";

/** `tsconfig.skills.json` から Program を作る。読めない設定は例外にする（型を解決できないまま通さない）。 */
function skillsProgram(root: string): ts.Program {
  const path = join(root, TSCONFIG_PATH);
  if (!existsSync(path))
    throw new Error(`${TSCONFIG_PATH} が無い。型を解決できないので判定できない`);
  const config = ts.readConfigFile(path, (p) => ts.sys.readFile(p));
  if (config.error) {
    throw new Error(
      `${TSCONFIG_PATH} を読めない: ${ts.flattenDiagnosticMessageText(config.error.messageText, "\n")}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, path);
  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    throw new Error(`${TSCONFIG_PATH} の設定が不正: ${messages.join(" / ")}`);
  }
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
}

export function main(cwd = "."): number {
  let root: string;
  let files: string[];
  try {
    root = repoRoot(cwd);
    files = listFiles(root).filter(isTarget);
  } catch (error) {
    console.error(`jsdoc-types: ${errorMessage(error)}`);
    return 2;
  }
  // 対象が 0 件なのは、対象が無いのではなく走査の範囲を取り違えている（判定できない）。
  if (files.length === 0) {
    console.error(`jsdoc-types: 対象のファイルが 0 件（${root}）。判定できないので失敗にする`);
    return 2;
  }
  let program: ts.Program;
  try {
    program = skillsProgram(root);
  } catch (error) {
    console.error(`jsdoc-types: ${errorMessage(error)}`);
    return 2;
  }
  // 型チェッカーを先に作る。作ると構文木に親が付き、括弧に付いた JSDoc（型の表明）を読めるようになる。
  const typeChecker = program.getTypeChecker();
  const checker = () => typeChecker;
  const violations: string[] = [];
  for (const file of files) {
    // 作業ツリーから消して、まだ index に残っているファイルは、消す途中なので読まない。
    if (!existsSync(join(root, file))) continue;
    // 対象なのに Program に無いのは、tsconfig の include と対象の判定が食い違っている（型を解決できない）。
    const sf = program.getSourceFile(join(root, file));
    if (sf === undefined) {
      console.error(
        `jsdoc-types: ${file} が ${TSCONFIG_PATH} の対象に無い。判定できないので失敗にする`,
      );
      return 2;
    }
    for (const v of findEscapesIn(sf, checker)) violations.push(`${file}:${v}`);
  }
  if (violations.length) {
    console.error("jsdoc-types: 型の検査を外す JSDoc の書き方:");
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "Fix: 型ガード・instanceof・typeof で絞り、JSDoc には具体的な型か unknown を書く（docs/tooling.md「JavaScript の拡張子」）。",
    );
    return 1;
  }
  console.log(`jsdoc-types: OK（${files.length} 件）`);
  return 0;
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`jsdoc-types: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main());
