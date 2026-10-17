#!/usr/bin/env node
// 絞る型の値にも false を返す型ガードが、ブランド型に絞っているかを検査する（lefthook pre-commit + CI）。
// `v is string` と書いた型ガードが空文字や空白に false を返すと、false の側から string が取り除かれ、
// 実際には来る "" や "  " が型の上で消える（#606）。そうした型ガードは、絞る型を
// `string & { readonly __<名前>: true }` のブランド型にして、false の側に元の型を残す。
//
// 対象にする型ガードは、絞る型がプリミティブ（string・number・bigint・boolean）と null・undefined と、
// それらの配列だけで組み立てた型のものである。オブジェクトの形の型ガードは、判定が型と一致するかを
// 構文から決められないので対象にしない（レビューで確かめる）。
// ブランド型（`string & { readonly __<名前>: true }`）は交差の型なので、この対象に入らない。
// 判定が型と一致する本体は、次の式を && と || と括弧で組み合わせたものだけとする。
//   - `typeof x === "<型>"`（`!==` も）
//   - `x === null`・`x === undefined`（`!==` も）
//   - `isArray(x)`・`Array.isArray(x)`
//   - `x.every((e) => <同じ形の式>)`
// これ以外の条件（`x !== ""`・`x.trim()`・`Number.isFinite(x)`・他の関数の呼び出し）を持つ本体は、
// 絞る型の値にも false を返しうるので、ブランド型でなければ違反にする。
// 次の 2 つは false の側が無いので対象にしない。`asserts x is T` と、`filter`・`find`・`findLast` に直接渡すコールバックである。
// 対象のファイルは、scripts/ と skills/ の .ts・.mjs と、private skill の .ts・.mjs である。
// 構文は TypeScript のパーサで読む。JSDoc の `@returns {x is T}` と `@type {(x: unknown) => x is T}` も読む。
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { listFiles, privateSkillNames, repoRoot } from "../code/check-js-extensions.ts";
import { errorMessage } from "../../lib/errors.ts";

const PRIMITIVE_KINDS = new Set([
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.BigIntKeyword,
  ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.UndefinedKeyword,
]);
const TYPEOF_NAMES = new Set(["string", "number", "bigint", "boolean", "undefined"]);
const NO_FALSE_SIDE_METHODS = new Set(["filter", "find", "findLast"]);

/** 絞る型がプリミティブと null・undefined と、それらの配列だけで組み立てた型か。 */
function isPrimitiveTarget(node: ts.TypeNode): boolean {
  if (PRIMITIVE_KINDS.has(node.kind)) return true;
  if (ts.isLiteralTypeNode(node)) return node.literal.kind === ts.SyntaxKind.NullKeyword;
  if (ts.isParenthesizedTypeNode(node)) return isPrimitiveTarget(node.type);
  if (ts.isArrayTypeNode(node)) return isPrimitiveTarget(node.elementType);
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return isPrimitiveTarget(node.type);
  }
  if (ts.isUnionTypeNode(node)) return node.types.every(isPrimitiveTarget);
  return false;
}

function unwrap(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e;
}

function isParam(e: ts.Expression, name: string): boolean {
  const u = unwrap(e);
  return ts.isIdentifier(u) && u.text === name;
}

const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/** 本体の式が、判定が型と一致する形だけで組み立てられているか。 */
function isExactCheck(expr: ts.Expression, name: string): boolean {
  const e = unwrap(expr);
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
      return isExactCheck(e.left, name) && isExactCheck(e.right, name);
    }
    if (!EQUALITY.has(op)) return false;
    const [a, b] = [unwrap(e.left), unwrap(e.right)];
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      if (ts.isTypeOfExpression(x) && isParam(x.expression, name)) {
        return ts.isStringLiteral(y) && TYPEOF_NAMES.has(y.text);
      }
      if (isParam(x, name)) {
        return (
          y.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(y) && y.text === "undefined")
        );
      }
    }
    return false;
  }
  if (ts.isCallExpression(e) && e.arguments.length === 1) {
    const callee = e.expression;
    const isArrayCall =
      (ts.isIdentifier(callee) && callee.text === "isArray") ||
      (ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Array" &&
        callee.name.text === "isArray");
    if (isArrayCall) return isParam(e.arguments[0], name);
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "every" &&
      isParam(callee.expression, name)
    ) {
      const cb = e.arguments[0];
      if (!ts.isArrowFunction(cb) || cb.parameters.length !== 1) return false;
      const p = cb.parameters[0].name;
      const body = bodyExpression(cb);
      return ts.isIdentifier(p) && body !== null && isExactCheck(body, p.text);
    }
  }
  return false;
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

/** 関数の型述語。TypeScript の戻り値の型、JSDoc の @returns、変数の JSDoc の @type の順に探す。 */
function predicateOf(fn: ts.SignatureDeclaration): ts.TypePredicateNode | undefined {
  if (fn.type && ts.isTypePredicateNode(fn.type)) return fn.type;
  const tag = ts.getJSDocReturnTag(fn);
  if (tag?.typeExpression && ts.isTypePredicateNode(tag.typeExpression.type)) {
    return tag.typeExpression.type;
  }
  const decl = fn.parent;
  if (ts.isVariableDeclaration(decl)) {
    const t = ts.getJSDocType(decl);
    if (t && ts.isFunctionTypeNode(t) && ts.isTypePredicateNode(t.type)) return t.type;
  }
  return undefined;
}

/** filter・find・findLast の引数に直接渡したコールバックか（false の側が無い）。 */
function isNoFalseSideCallback(fn: ts.Node): boolean {
  const call = fn.parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments.some((a) => a === fn) &&
    ts.isPropertyAccessExpression(call.expression) &&
    NO_FALSE_SIDE_METHODS.has(call.expression.name.text)
  );
}

function nameOf(fn: ts.SignatureDeclaration): string {
  if (fn.name) return fn.name.getText();
  if (ts.isVariableDeclaration(fn.parent)) return fn.parent.name.getText();
  return "(無名の関数)";
}

/** ソースの中で、ブランド型に絞っていない型ガードのうち、判定が型と一致しないもの。`<行>: <説明>` の一覧。 */
export function findViolations(text: string, fileName: string): string[] {
  const kind = fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) {
      const pred = predicateOf(node);
      if (
        pred?.type &&
        pred.assertsModifier === undefined &&
        ts.isIdentifier(pred.parameterName) &&
        isPrimitiveTarget(pred.type) &&
        !isNoFalseSideCallback(node)
      ) {
        const body = bodyExpression(node);
        if (body === null || !isExactCheck(body, pred.parameterName.text)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const target = pred.type.getText(sf);
          out.push(
            `${line + 1}: ${nameOf(node)} は ${target} の値にも false を返しうるのに、ブランド型に絞っていない`,
          );
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
