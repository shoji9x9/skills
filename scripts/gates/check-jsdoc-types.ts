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
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { listFiles, repoRoot } from "./check-js-extensions.ts";
import { errorMessage } from "../lib/errors.ts";

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
// その型の名前と、any を避けるのに書く必要のある型引数の数を持つ（`Generator<T = unknown, TReturn = any, TNext = any>` は 3、
// `IteratorResult<T, TReturn = any>` は 2）。
// 名前を手で並べると、TypeScript の版で lib のデフォルトが変わったときに古くなる。
// そこで、TypeScript に同梱の lib の宣言（`lib.*.d.ts`）から、デフォルトが `any` の型引数を持つ型を毎回求める。
// `Array`・`Promise`・`Map` などデフォルトの無いものは、型引数を省くと tsc が TS2314 で失敗にするので、ここには入らない。
// 名前で照合するので、同じ名前の別の型（自分で @typedef した Iterator など）と、修飾した名前（globalThis.Generator）は
// 区別できない。区別するには、型を解決して調べる必要がある。
let anyDefaultArities: Map<string, number> | null = null;

/** lib の宣言から、デフォルトが `any` の型引数を持つ型の名前と、書く必要のある型引数の数を求める。 */
export function libAnyDefaultArities(): Map<string, number> {
  if (anyDefaultArities !== null) return anyDefaultArities;
  const dir = dirname(ts.getDefaultLibFilePath({}));
  const out = new Map<string, number>();
  for (const name of readdirSync(dir).filter((n) => /^lib\..*\.d\.ts$/.test(n))) {
    const sf = ts.createSourceFile(
      name,
      readFileSync(join(dir, name), "utf8"),
      ts.ScriptTarget.Latest,
    );
    const visit = (node: ts.Node) => {
      if (
        (ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isClassDeclaration(node)) &&
        node.name !== undefined &&
        node.typeParameters !== undefined
      ) {
        let last = -1;
        node.typeParameters.forEach((p, i) => {
          if (p.default?.kind === ts.SyntaxKind.AnyKeyword) last = i;
        });
        // 同じ名前の宣言が複数の lib にあれば（版ごとの Iterator など）、多いほうに合わせる。
        if (last >= 0) out.set(node.name.text, Math.max(out.get(node.name.text) ?? 0, last + 1));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  // 0 件なのは lib を読めていない（判定できない）。何も検出しないまま通さない。
  if (out.size === 0) throw new Error(`TypeScript の lib（${dir}）から型を 1 件も読めない`);
  anyDefaultArities = out;
  return out;
}

/** 検査の対象のパス（リポジトリのルートからの `/` 区切り）か。 */
export const isTarget = (path: string): boolean => TARGET_RE.test(path);

/** JSDoc の型のうち、`any` として扱われるものなら、その書き方を返す。 */
function anyLike(node: ts.Node): string | null {
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
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const arity = libAnyDefaultArities().get(node.typeName.text);
    if (arity !== undefined && (node.typeArguments?.length ?? 0) < arity)
      return `型引数の足りない ${node.typeName.text}（${arity} つ書く）`;
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

/** 1 ファイルの違反（`行: 理由`）。 */
export function findEscapes(path: string, text: string): string[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
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
    const any = anyLike(node);
    if (any) out.push(`${lineOf(node.getStart(sf))}: JSDoc の型に ${any} を書かない`);
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  return out;
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
  const violations: string[] = [];
  for (const file of files) {
    // 作業ツリーから消して、まだ index に残っているファイルは、消す途中なので読まない。
    if (!existsSync(join(root, file))) continue;
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch (error) {
      console.error(`jsdoc-types: ${file} を読めない: ${errorMessage(error)}`);
      return 2;
    }
    for (const v of findEscapes(file, text)) violations.push(`${file}:${v}`);
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
