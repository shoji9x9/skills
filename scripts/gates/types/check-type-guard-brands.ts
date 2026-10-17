#!/usr/bin/env node
// 絞る型の値にも false を返す型ガードが、ブランド型に絞っているかを検査する（lefthook pre-commit + CI）。
// `v is string` と書いた型ガードが空文字や空白に false を返すと、false の側から string が取り除かれ、
// 実際には来る "" や "  " が型の上で消える（#606）。そうした型ガードは、絞る型を
// `string & { readonly __<名前>: true }` のブランド型にして、false の側に元の型を残す。
//
// 対象にする型ガードは、絞る型がプリミティブ（string・number・bigint・boolean・symbol）と null・undefined と、
// それらの配列（`T[]`・`readonly T[]`・`Array<T>`・`ReadonlyArray<T>`）だけで組み立てた型のものである。
// オブジェクトの形の型ガードは、判定が型と一致するかを構文から決められないので対象にしない（レビューで確かめる）。
// ブランド型（`string & { readonly __<名前>: true }`）は交差の型なので、この対象に入らない。
// 判定が型と一致するかは、本体が true を返す値の種類の集合と、絞る型の種類の集合が一致するかで決める。
// 本体の種類を求められるのは、次の式を || と括弧で組み合わせたものだけである。
//   - `typeof x === "<型>"`（string・number・bigint・boolean・symbol・undefined）
//   - `x === null`・`x === undefined`
//   - `isArray(x) && x.every((e) => <同じ形の式>)`（`Array.isArray` も）
// これ以外の条件（`x !== ""`・`x.trim()`・`Number.isFinite(x)`・否定・他の関数の呼び出し）を持つ本体と、
// 種類の集合が絞る型と違う本体（`v is number | null` なのに null に false を返すなど）は、ブランド型でなければ違反にする。
// 次のものは対象にしない。false の側が無い `asserts x is T` と、`filter`・`find`・`findLast` に渡すコールバック。
// 本体の無い関数の形（関数の型・オーバーロードの宣言・引数の型）は、型ガードの実装ではないので対象にしない。
// 型述語は、戻り値の型、JSDoc の `@returns`、置いた先（変数・オブジェクトの欄・代入）の注釈から読む。
// 置いた先の注釈は、TypeScript の型と JSDoc の `@type` の両方を読む。
// 型の別名（`type G = ...`・`@typedef`・`@callback`）を通した型述語は、別名を解決しないので読まない。
// `x.every(isS)` のように関数を名前で渡す本体は、その関数の判定を読まないので、種類を求められない形として扱う。
// 絞る型に無い種類にも true を返す本体は、ブランド型にしても直らないので、判定か絞る型を直すよう別の言葉で報告する。
// 対象のファイルは、scripts/ と skills/ の .ts・.mjs と、private skill の .ts・.mjs である。
// 構文は TypeScript のパーサで読む。
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { listFiles, privateSkillNames, repoRoot } from "../code/check-js-extensions.ts";
import { errorMessage } from "../../lib/errors.ts";

const KEYWORD_KINDS = new Map([
  [ts.SyntaxKind.StringKeyword, "string"],
  [ts.SyntaxKind.NumberKeyword, "number"],
  [ts.SyntaxKind.BigIntKeyword, "bigint"],
  [ts.SyntaxKind.SymbolKeyword, "symbol"],
  [ts.SyntaxKind.BooleanKeyword, "boolean"],
  [ts.SyntaxKind.UndefinedKeyword, "undefined"],
]);
const TYPEOF_NAMES = new Set(["string", "number", "bigint", "boolean", "symbol", "undefined"]);
const ARRAY_NAMES = new Set(["Array", "ReadonlyArray"]);
const NO_FALSE_SIDE_METHODS = new Set(["filter", "find", "findLast"]);

/** 要素の種類の集合から、配列の種類の名前を作る（要素の順序に依らない）。 */
function arrayKind(inner: ReadonlySet<string>): string {
  return `array<${[...inner].sort().join("|")}>`;
}

function union(parts: (Set<string> | null)[]): Set<string> | null {
  const out = new Set<string>();
  for (const p of parts) {
    if (p === null) return null;
    for (const x of p) out.add(x);
  }
  return out;
}

/** 絞る型の種類の集合。プリミティブと null・undefined と、それらの配列だけで組み立てた型でなければ null。 */
function targetKinds(node: ts.TypeNode): Set<string> | null {
  const keyword = KEYWORD_KINDS.get(node.kind);
  if (keyword !== undefined) return new Set([keyword]);
  if (ts.isLiteralTypeNode(node)) {
    return node.literal.kind === ts.SyntaxKind.NullKeyword ? new Set(["null"]) : null;
  }
  if (ts.isParenthesizedTypeNode(node)) return targetKinds(node.type);
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return targetKinds(node.type);
  }
  if (ts.isUnionTypeNode(node)) return union(node.types.map(targetKinds));
  let element: ts.TypeNode | undefined;
  if (ts.isArrayTypeNode(node)) element = node.elementType;
  else if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    ARRAY_NAMES.has(node.typeName.text) &&
    node.typeArguments?.length === 1
  ) {
    element = node.typeArguments[0];
  }
  if (element === undefined) return null;
  const inner = targetKinds(element);
  return inner === null ? null : new Set([arrayKind(inner)]);
}

function unwrap(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e;
}

function isParam(e: ts.Expression, name: string): boolean {
  const u = unwrap(e);
  return ts.isIdentifier(u) && u.text === name;
}

/** `isArray(x)` か `Array.isArray(x)` か。 */
function isArrayCall(e: ts.Expression, name: string): boolean {
  const u = unwrap(e);
  if (!ts.isCallExpression(u) || u.arguments.length !== 1 || !isParam(u.arguments[0], name)) {
    return false;
  }
  const callee = u.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === "isArray") ||
    (ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "Array" &&
      callee.name.text === "isArray")
  );
}

/** `x.every((e) => <式>)` の要素の種類の集合。この形でなければ null。 */
function everyKinds(e: ts.Expression, name: string): Set<string> | null {
  const u = unwrap(e);
  if (!ts.isCallExpression(u) || u.arguments.length !== 1) return null;
  const callee = u.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "every") return null;
  if (!isParam(callee.expression, name)) return null;
  const cb = u.arguments[0];
  if (!ts.isArrowFunction(cb) || cb.parameters.length !== 1) return null;
  const p = cb.parameters[0].name;
  const body = bodyExpression(cb);
  return ts.isIdentifier(p) && body !== null ? acceptedKinds(body, p.text) : null;
}

/** 本体の式が true を返す値の種類の集合。求められない形なら null。 */
function acceptedKinds(expr: ts.Expression, name: string): Set<string> | null {
  const e = unwrap(expr);
  if (!ts.isBinaryExpression(e)) return null;
  const op = e.operatorToken.kind;
  if (op === ts.SyntaxKind.BarBarToken) {
    return union([acceptedKinds(e.left, name), acceptedKinds(e.right, name)]);
  }
  if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
    if (!isArrayCall(e.left, name)) return null;
    const inner = everyKinds(e.right, name);
    return inner === null ? null : new Set([arrayKind(inner)]);
  }
  if (op !== ts.SyntaxKind.EqualsEqualsEqualsToken) return null;
  const [a, b] = [unwrap(e.left), unwrap(e.right)];
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    if (ts.isTypeOfExpression(x) && isParam(x.expression, name)) {
      return ts.isStringLiteral(y) && TYPEOF_NAMES.has(y.text) ? new Set([y.text]) : null;
    }
    if (isParam(x, name)) {
      if (y.kind === ts.SyntaxKind.NullKeyword) return new Set(["null"]);
      if (ts.isIdentifier(y) && y.text === "undefined") return new Set(["undefined"]);
      return null;
    }
  }
  return null;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/** 関数の本体を 1 つの式として取り出す。`return` 1 文だけのブロックも受ける。それ以外は null。 */
function bodyExpression(fn: ts.SignatureDeclaration): ts.Expression | null {
  if (!("body" in fn) || fn.body === undefined) return null;
  const body = fn.body;
  if (!ts.isBlock(body)) return body;
  if (body.statements.length !== 1) return null;
  const only = body.statements[0];
  return ts.isReturnStatement(only) && only.expression ? only.expression : null;
}

/** 関数の型の注釈から、型述語を取り出す。 */
function predicateOfType(t: ts.TypeNode | undefined): ts.TypePredicateNode | undefined {
  if (t && ts.isParenthesizedTypeNode(t)) return predicateOfType(t.type);
  return t && ts.isFunctionTypeNode(t) && ts.isTypePredicateNode(t.type) ? t.type : undefined;
}

/** JSDoc の @type の型。代入の文に付いた JSDoc は ts.getJSDocType が読まないので、タグから読む。 */
function jsDocTypeOf(node: ts.Node): ts.TypeNode | undefined {
  const tag = ts.getJSDocTags(node).find(ts.isJSDocTypeTag);
  return tag?.typeExpression.type;
}

/** 括弧と条件式の枝を外側へたどった、関数を包む最も外側の式。 */
function outer(fn: ts.Node): ts.Node {
  let n = fn;
  for (;;) {
    const p = n.parent;
    if (ts.isParenthesizedExpression(p)) n = p;
    else if (ts.isConditionalExpression(p) && p.condition !== n) n = p;
    else return n;
  }
}

/** 本体を持つ関数の宣言の、同じ名前のオーバーロードの宣言（本体の無いもの）に書いた型述語。 */
function overloadPredicate(fn: ts.SignatureDeclaration): ts.TypePredicateNode | undefined {
  if (!(ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) || fn.name === undefined) {
    return undefined;
  }
  const name = fn.name.getText();
  const p = fn.parent;
  const siblings: readonly ts.Node[] = ts.isClassLike(p)
    ? p.members
    : ts.isSourceFile(p) || ts.isBlock(p) || ts.isModuleBlock(p)
      ? p.statements
      : [];
  for (const s of siblings) {
    if (
      (ts.isFunctionDeclaration(s) || ts.isMethodDeclaration(s)) &&
      s.body === undefined &&
      s.name?.getText() === name &&
      s.type &&
      ts.isTypePredicateNode(s.type)
    ) {
      return s.type;
    }
  }
  return undefined;
}

/** 関数の型述語。戻り値の型、JSDoc の @returns、置いた先（変数・オブジェクトの欄・代入）の注釈の順に探す。 */
function predicateOf(fn: ts.SignatureDeclaration): ts.TypePredicateNode | undefined {
  if (fn.type && ts.isTypePredicateNode(fn.type)) return fn.type;
  const tag = ts.getJSDocReturnTag(fn);
  if (tag?.typeExpression && ts.isTypePredicateNode(tag.typeExpression.type)) {
    return tag.typeExpression.type;
  }
  const overload = overloadPredicate(fn);
  if (overload) return overload;
  const holder = outer(fn).parent;
  if (ts.isVariableDeclaration(holder) || ts.isPropertyDeclaration(holder)) {
    return predicateOfType(holder.type) ?? predicateOfType(jsDocTypeOf(holder));
  }
  if (ts.isPropertyAssignment(holder)) return predicateOfType(jsDocTypeOf(holder));
  if (
    ts.isBinaryExpression(holder) &&
    holder.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isExpressionStatement(holder.parent)
  ) {
    return predicateOfType(jsDocTypeOf(holder.parent));
  }
  return undefined;
}

/** filter・find・findLast の引数に渡したコールバックか（false の側が無い）。括弧で囲んでもよい。 */
function isNoFalseSideCallback(fn: ts.Node): boolean {
  const arg = outer(fn);
  const call = arg.parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments.some((a) => a === arg) &&
    ts.isPropertyAccessExpression(call.expression) &&
    NO_FALSE_SIDE_METHODS.has(call.expression.name.text)
  );
}

function nameOf(fn: ts.SignatureDeclaration): string {
  if (fn.name) return fn.name.getText();
  const holder = outer(fn).parent;
  if (
    ts.isVariableDeclaration(holder) ||
    ts.isPropertyAssignment(holder) ||
    ts.isPropertyDeclaration(holder)
  ) {
    return holder.name.getText();
  }
  if (ts.isBinaryExpression(holder) && holder.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return holder.left.getText();
  }
  return "(無名の関数)";
}

/** ソースの中で、ブランド型に絞っていない型ガードのうち、判定が型と一致しないもの。`<行>: <説明>` の一覧。 */
export function findViolations(text: string, fileName: string): string[] {
  const kind = fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && "body" in node && node.body !== undefined) {
      const pred = predicateOf(node);
      const target = pred?.type ? targetKinds(pred.type) : null;
      if (
        pred?.type &&
        target !== null &&
        pred.assertsModifier === undefined &&
        ts.isIdentifier(pred.parameterName) &&
        !isNoFalseSideCallback(node)
      ) {
        const body = bodyExpression(node);
        const accepted = body === null ? null : acceptedKinds(body, pred.parameterName.text);
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const where = `${line + 1}: ${nameOf(node)} は ${pred.type.getText(sf)}`;
        // 絞る型に無い種類にも true を返す本体は、ブランド型にしても直らない（true の側の型が誤っている）。
        if (accepted !== null && [...accepted].some((k) => !target.has(k))) {
          out.push(`${where} に無い種類の値にも true を返す。判定か絞る型を直す`);
        } else if (accepted === null || !sameSet(accepted, target)) {
          out.push(`${where} の値にも false を返しうるのに、ブランド型に絞っていない`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** 検査の対象か。scripts/ と skills/ の .ts・.mjs と、private skill の .ts・.mjs。 */
export function isTarget(file: string, privateSkills: ReadonlySet<string>): boolean {
  if (!/\.(ts|mjs)$/.test(file) || file.endsWith(".d.ts")) return false;
  if (/^(scripts|skills)\//.test(file)) return true;
  const m = /^\.agents\/skills\/([^/]+)\//.exec(file);
  return m !== null && privateSkills.has(m[1]);
}

function main(): number {
  let root: string;
  let files: string[];
  try {
    root = repoRoot(process.cwd());
    files = listFiles(root);
  } catch (error) {
    console.error(`type-guard-brands: ${errorMessage(error)}`);
    return 2;
  }
  const privateSkills = new Set(privateSkillNames(files));
  const targets = files.filter((f) => isTarget(f, privateSkills));
  if (targets.length === 0) {
    console.error(
      `type-guard-brands: 対象のファイルが 0 件（${root}）。判定できないので失敗にする`,
    );
    return 2;
  }
  const violations: string[] = [];
  for (const file of targets) {
    // 作業ツリーから消して、まだ index に残っているファイルは、消す途中なので読まない。
    if (!existsSync(join(root, file))) continue;
    for (const v of findViolations(readFileSync(join(root, file), "utf8"), file)) {
      violations.push(`${file}:${v}`);
    }
  }
  if (violations.length) {
    console.error(
      "type-guard-brands: 絞る型の値にも false を返すのに、ブランド型に絞っていない型ガード:",
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "Fix: 絞る型を `string & { readonly __<名前>: true }` のブランド型にする（docs/tooling.md「型の検査」）。",
    );
    return 1;
  }
  console.log(`type-guard-brands: OK（${targets.length} 件）`);
  return 0;
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (error) {
    console.error(`type-guard-brands: 起動パスを正規化できない: ${errorMessage(error)}`);
    process.exit(1);
  }
}

if (isCliEntry()) process.exit(main());
