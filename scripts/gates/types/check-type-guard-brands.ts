#!/usr/bin/env node
// 絞る型の値にも false を返す型ガードが、ブランド型に絞っているかを検査する（lefthook pre-commit + CI）。
// `v is string` と書いた型ガードが空文字や空白に false を返すと、false の側から string が取り除かれ、
// 実際には来る "" や "  " が型の上で消える（#606）。そうした型ガードは、絞る型を
// `string & { readonly __<名前>: true }` のブランド型にして、false の側に元の型を残す。
//
// 型述語と絞る型は、TypeScript の型チェッカーで読む。構文をたどる方法では、型述語を書ける場所
// （注釈・JSDoc・オーバーロード・文脈の型・別名）の数だけ分岐が要り、抜けが続いたためである。
// 本体を持つ関数ごとに、次の型述語を集める。
//   - 関数そのもののシグネチャ（TypeScript の戻り値の型、JS の JSDoc の @returns・@type）
//   - 名前の付いた関数の宣言では、同じ名前のすべてのシグネチャ（オーバーロード・@overload）
//   - 関数式とアロー関数では、置いた先の文脈の型のシグネチャ（変数・欄・代入の注釈、satisfies）
//
// 対象にするのは、絞る型がプリミティブ（string・number・bigint・boolean・symbol）と null・undefined と、
// それらの配列だけで組み立てた型の型ガードである。リテラル型・オブジェクトの形の型ガードは、
// 判定が型と一致するかを決められないので対象にしない（書いた人とレビューする人が確かめる）。
// ブランドの印（欄を 1 つ以上持つオブジェクト型）を持つ交差の型は対象にしない。印の無い交差（`string & {}`）は、
// false の側から string が消えるので、交差の中のプリミティブを絞る型として検査する。
//
// 判定が型と一致するかは、本体が true を返す値の種類の集合と、絞る型の種類の集合が一致するかで決める。
// 本体の種類を求められるのは、次の式を || と括弧で組み合わせたものだけである。
//   - `typeof x === "<型>"`（string・number・bigint・boolean・symbol・undefined）
//   - `x === null`・`x === undefined`
//   - `isArray(x) && x.every((e) => <同じ形の式>)`（`Array.isArray` も）
//   - `isArray(x) && x.every(isS)`。`isS` は名前で渡した型ガードで、型チェッカーで宣言をたどり（import の別名も）、
//     その判定が型述語と一致するときだけ、型述語の種類を要素の種類にする
// これ以外の条件（`x !== ""`・`x.trim()`・`Number.isFinite(x)`・否定・他の関数の呼び出し）を持つ本体は、
// 絞る型の値にも false を返しうるので、ブランド型でなければ違反にする。
// 名前で渡した型ガードが追加の条件を持つ・ブランド型に絞る・宣言をたどれない（引数・let と var の変数・
// 解決できない import・互いに名前で渡し合う型ガード）ときも、種類を求められない形として扱い、違反にする。
// 名前で渡した型ガードの否定（`x !== null`）は、要素がどの種類の値でもありうるので、引数の宣言した型から差し引かない。
// 絞る型に無い種類にも true を返す本体は、ブランド型にしても直らないので、判定か絞る型を直すよう別の言葉で報告する。
// 否定（`!==`・`!=`）は、引数の宣言した型の種類から差し引いて読む。`== null` は null と undefined の両方に当たる。
// ブランド型と他の型を並べた union（`(string & { readonly __f: true }) | number`）は、対象にしない。
//
// 次のものは対象にしない。
//   - `asserts x is T`（false の側が無い）
//   - 呼び出しの引数に直接渡した関数（filter・find・every など、関数をそのまま返すラッパーを含む）。false の側を使うかは呼び出し先が決め、
//     配列のメソッドは false の側で元の配列を絞らない
// 対象のファイルは、scripts/ と skills/ の .ts・.mjs と、private skill の .ts・.mjs である。
//
// 引数にファイルを渡すと（lefthook の pre-commit が stage したファイルを渡す）、そのうち対象のファイルだけを
// 検査する。型チェッカーは渡したファイルだけを起点に作り、import 先はディスクから読むので、全件を読むより速い。
// 引数が無ければ（CI）、すべての対象のファイルを検査する。
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { listFiles, privateSkillNames, repoRoot } from "../code/check-js-extensions.ts";
import { errorMessage } from "../../lib/errors.ts";

const TYPEOF_NAMES = new Set(["string", "number", "bigint", "boolean", "symbol", "undefined"]);
const BRANDED = "branded";

const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowImportingTsExtensions: true,
  types: [],
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
};

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

/** 欄を 1 つ以上持つオブジェクト型（ブランドの印）か。欄の名前には依らない。欄の無い `{}` は印にしない。 */
function isBrandMark(t: ts.Type): boolean {
  return (t.flags & ts.TypeFlags.Object) !== 0 && t.getProperties().length > 0;
}

/**
 * 絞る型の種類の集合。ブランド型なら BRANDED。
 * プリミティブと null・undefined と、それらの配列だけで組み立てた型でなければ null。
 */
function typeKinds(t: ts.Type, checker: ts.TypeChecker): Set<string> | typeof BRANDED | null {
  if (t.isUnion()) {
    // boolean は true と false の union として現れる。両方がそろうときだけ boolean として読む。
    const members = t.types;
    const bools = members.filter((m) => (m.flags & ts.TypeFlags.BooleanLiteral) !== 0);
    const rest = members.filter((m) => (m.flags & ts.TypeFlags.BooleanLiteral) === 0);
    if (bools.length === 1) return null;
    const parts: (Set<string> | typeof BRANDED | null)[] = rest.map((m) => typeKinds(m, checker));
    if (parts.includes(BRANDED)) return BRANDED;
    const merged = union(parts.filter((p) => p !== BRANDED));
    if (merged !== null && bools.length === 2) merged.add("boolean");
    return merged;
  }
  if (t.isIntersection()) {
    if (t.types.some(isBrandMark)) return BRANDED;
    const prims = t.types.filter((m) => (m.flags & ts.TypeFlags.Object) === 0);
    return prims.length === 1 ? typeKinds(prims[0], checker) : null;
  }
  const f = t.flags;
  if (f & ts.TypeFlags.String) return new Set(["string"]);
  if (f & ts.TypeFlags.Number) return new Set(["number"]);
  if (f & ts.TypeFlags.BigInt) return new Set(["bigint"]);
  if (f & ts.TypeFlags.Boolean) return new Set(["boolean"]);
  if (f & ts.TypeFlags.ESSymbol) return new Set(["symbol"]);
  if (f & ts.TypeFlags.Undefined) return new Set(["undefined"]);
  if (f & ts.TypeFlags.Null) return new Set(["null"]);
  if (checker.isArrayType(t)) {
    const element = checker.getIndexTypeOfType(t, ts.IndexKind.Number);
    if (element === undefined) return null;
    const inner = typeKinds(element, checker);
    if (inner === BRANDED) return BRANDED;
    return inner === null ? null : new Set([arrayKind(inner)]);
  }
  return null;
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

/** `x.every((e) => <式>)` か `x.every(<関数名>)` の要素の種類の集合。この形でなければ null。 */
function everyKinds(
  e: ts.Expression,
  name: string,
  { checker = null, seen = new Set() }: KindContext,
): Set<string> | null {
  const u = unwrap(e);
  if (!ts.isCallExpression(u) || u.arguments.length !== 1) return null;
  const callee = u.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "every") return null;
  if (!isParam(callee.expression, name)) return null;
  const cb = unwrap(u.arguments[0]);
  if (ts.isIdentifier(cb)) return namedGuardKinds(cb, checker, seen);
  if (!ts.isArrowFunction(cb) || cb.parameters.length !== 1) return null;
  const p = cb.parameters[0].name;
  const body = bodyExpression(cb);
  return ts.isIdentifier(p) && body !== null
    ? acceptedKinds(body, p.text, { checker, seen })
    : null;
}

/**
 * 名前が指す関数の宣言（関数の宣言か、関数式・アロー関数で初期化した const の変数）。import の別名もたどる。
 * let・var の変数は、後から別の関数を代入できるので、初期化式を宣言として読まない。
 */
function functionDeclarationOf(
  id: ts.Identifier,
  checker: ts.TypeChecker,
): ts.SignatureDeclaration | null {
  let sym = checker.getSymbolAtLocation(id);
  if (sym !== undefined && (sym.flags & ts.SymbolFlags.Alias) !== 0) {
    sym = checker.getAliasedSymbol(sym);
  }
  const decls = sym?.declarations ?? [];
  // オーバーロードを持つ関数の宣言は、シグネチャだけの宣言と本体を持つ宣言が並ぶ。本体を持つ宣言を読む。
  // 型述語は、predicatesOf が名前の型のシグネチャ（オーバーロード）からも集める。
  if (decls.length > 1 && decls.every(ts.isFunctionDeclaration)) {
    const impls = decls.filter((x) => x.body !== undefined);
    return impls.length === 1 ? impls[0] : null;
  }
  if (decls.length !== 1) return null;
  const d = decls[0];
  if (ts.isFunctionDeclaration(d)) return d;
  if (
    ts.isVariableDeclaration(d) &&
    d.initializer !== undefined &&
    (ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const) !== 0
  ) {
    const init = unwrap(d.initializer);
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  }
  return null;
}

/**
 * `every` に名前で渡した型ガードが絞る種類の集合。
 * 判定が絞る型と一致するとき（本体が true を返す種類と、型述語の種類が同じとき）だけ返し、
 * 追加の条件を持つ・ブランド型に絞る・種類を求められないときは null を返す。
 */
function namedGuardKinds(
  id: ts.Identifier,
  checker: ts.TypeChecker | null,
  seen: ReadonlySet<ts.Node>,
): Set<string> | null {
  if (checker === null) return null;
  const fn = functionDeclarationOf(id, checker);
  // 互いに名前で渡し合う型ガードは、判定を読み終えられないので、種類を求められない形として扱う。
  if (fn === null || seen.has(fn) || fn.parameters.length !== 1) return null;
  const param = fn.parameters[0];
  if (!ts.isIdentifier(param.name)) return null;
  // 関数の宣言は、宣言そのもののシグネチャと名前の型のシグネチャで同じ型述語が 2 回集まる。
  // 型述語が 1 つも無いか、絞る種類が型述語ごとに違えば、種類を決められない。
  const targets = predicatesOf(fn, checker)
    .filter((p) => p.parameterIndex === 0)
    .map((p) => typeKinds(p.type, checker));
  if (targets.length === 0) return null;
  const target = targets[0];
  if (target === null || target === BRANDED) return null;
  if (!targets.every((t) => t !== null && t !== BRANDED && sameSet(t, target))) return null;
  const body = bodyExpression(fn);
  if (body === null) return null;
  // every に渡る要素は、isArray が unknown を any[] に絞るので、どの種類の値でもありうる。
  // そのため、否定（`!==`・`!=`）を型ガードの引数の宣言した型から差し引いて読まない（params に null を渡す）。
  const accepted = acceptedKinds(body, param.name.text, { checker, seen: new Set([...seen, fn]) });
  return accepted !== null && sameSet(accepted, target) ? target : null;
}

/** 集合 a から b の要素を除いた集合。a が null なら null。 */
function minus(a: ReadonlySet<string> | null, b: readonly string[]): Set<string> | null {
  return a === null ? null : new Set([...a].filter((x) => !b.includes(x)));
}

const EQ_KINDS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/**
 * 種類の集合を求めるときに引き継ぐ値。
 * `params` は引数の宣言した型の種類の集合で、否定（`!==`・`!=`）を読むときに、そこから差し引く。
 * `checker` は名前で渡した型ガードを読むのに使い、`seen` は読んでいる途中の関数の集合である。
 */
type KindContext = {
  params?: ReadonlySet<string> | null;
  checker?: ts.TypeChecker | null;
  seen?: ReadonlySet<ts.Node>;
};

/** 本体の式が true を返す値の種類の集合。求められない形なら null。 */
function acceptedKinds(
  expr: ts.Expression,
  name: string,
  ctx: KindContext = {},
): Set<string> | null {
  const e = unwrap(expr);
  if (!ts.isBinaryExpression(e)) return null;
  const op = e.operatorToken.kind;
  if (op === ts.SyntaxKind.BarBarToken) {
    return union([acceptedKinds(e.left, name, ctx), acceptedKinds(e.right, name, ctx)]);
  }
  if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
    if (!isArrayCall(e.left, name)) return null;
    const inner = everyKinds(e.right, name, ctx);
    return inner === null ? null : new Set([arrayKind(inner)]);
  }
  if (!EQ_KINDS.has(op)) return null;
  return equalityKinds(e, name, ctx.params ?? null);
}

/** 比較の式（`===`・`!==`・`==`・`!=`）が true を返す値の種類の集合。求められない形なら null。 */
function equalityKinds(
  e: ts.BinaryExpression,
  name: string,
  params: ReadonlySet<string> | null,
): Set<string> | null {
  const op = e.operatorToken.kind;
  const negated =
    op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    op === ts.SyntaxKind.ExclamationEqualsToken;
  const loose =
    op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
  const [a, b] = [unwrap(e.left), unwrap(e.right)];
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    let hit: string[] | null = null;
    if (ts.isTypeOfExpression(x) && isParam(x.expression, name)) {
      if (!ts.isStringLiteral(y) || !TYPEOF_NAMES.has(y.text)) return null;
      hit = [y.text];
    } else if (isParam(x, name)) {
      const isNull = y.kind === ts.SyntaxKind.NullKeyword;
      const isUndefined = (ts.isIdentifier(y) && y.text === "undefined") || ts.isVoidExpression(y);
      if (!isNull && !isUndefined) return null;
      // `== null` と `== undefined` は、null と undefined の両方に true を返す。
      hit = loose ? ["null", "undefined"] : [isNull ? "null" : "undefined"];
    }
    if (hit !== null) return negated ? minus(params, hit) : new Set(hit);
  }
  return null;
}

/** 配列の種類の名前から、要素の種類の集合を取り出す。配列でなければ null。 */
function arrayInner(kind: string): Set<string> | null {
  const m = /^array<(.*)>$/.exec(kind);
  return m ? new Set(m[1].split("|")) : null;
}

/** 種類 k の値が、絞る型の種類のどれかに含まれるか。配列は、要素の種類が絞る型の要素に含まれれば含まれる。 */
function covered(k: string, target: ReadonlySet<string>): boolean {
  if (target.has(k)) return true;
  const inner = arrayInner(k);
  if (inner === null) return false;
  return [...target].some((t) => {
    const ti = arrayInner(t);
    return ti !== null && [...inner].every((x) => covered(x, ti));
  });
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

/** 括弧を外側へたどった、関数を包む最も外側の式。 */
function outer(fn: ts.Node): ts.Node {
  let n = fn;
  while (ts.isParenthesizedExpression(n.parent)) n = n.parent;
  return n;
}

/** 呼び出しの引数に直接渡した関数か（false の側を使うかは呼び出し先が決める）。 */
function isCallArgument(fn: ts.Node): boolean {
  const arg = outer(fn);
  const call = arg.parent;
  return (
    (ts.isCallExpression(call) || ts.isNewExpression(call)) &&
    (call.arguments ?? []).some((a) => a === arg)
  );
}

/** 関数に付く型述語（識別子の型述語だけ）。関数そのもの、同じ名前のシグネチャ、文脈の型の順に集める。 */
function predicatesOf(
  fn: ts.SignatureDeclaration,
  checker: ts.TypeChecker,
): ts.IdentifierTypePredicate[] {
  const sigs: ts.Signature[] = [];
  const own = checker.getSignatureFromDeclaration(fn);
  if (own) sigs.push(own);
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) {
    sigs.push(...checker.getTypeAtLocation(fn.name).getCallSignatures());
  }
  if (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) {
    const ctx = checker.getContextualType(fn);
    if (ctx) sigs.push(...ctx.getCallSignatures());
  }
  const out: ts.IdentifierTypePredicate[] = [];
  for (const s of sigs) {
    const p = checker.getTypePredicateOfSignature(s);
    if (p && p.kind === ts.TypePredicateKind.Identifier) out.push(p);
  }
  return out;
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

/** 1 つのソースの中の違反。`<行>: <説明>` の一覧。 */
function violationsIn(sf: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionLike(node) &&
      "body" in node &&
      node.body !== undefined &&
      !isCallArgument(node)
    ) {
      const reported = new Set<string>();
      for (const pred of predicatesOf(node, checker)) {
        const target = typeKinds(pred.type, checker);
        if (target === null || target === BRANDED) continue;
        const param = node.parameters[pred.parameterIndex];
        if (param === undefined || !ts.isIdentifier(param.name)) continue;
        const declared = typeKinds(checker.getTypeAtLocation(param), checker);
        const params = declared === BRANDED ? null : declared;
        const body = bodyExpression(node);
        const accepted =
          body === null
            ? null
            : acceptedKinds(body, param.name.text, { params, checker, seen: new Set([node]) });
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const where = `${line + 1}: ${nameOf(node)} は ${checker.typeToString(pred.type)}`;
        let message: string | null = null;
        // 絞る型に無い種類にも true を返す本体は、ブランド型にしても直らない（true の側の型が誤っている）。
        if (accepted !== null && [...accepted].some((k) => !covered(k, target))) {
          message = `${where} に無い種類の値にも true を返す。判定か絞る型を直す`;
        } else if (accepted === null || !sameSet(accepted, target)) {
          message = `${where} の値にも false を返しうるのに、ブランド型に絞っていない`;
        }
        if (message !== null && !reported.has(message)) {
          reported.add(message);
          out.push(message);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** ディスクから読んだ標準ライブラリなどの構文木。Program を作るたびに読み直さないために持つ。 */
const diskSourceFiles = new Map<string, ts.SourceFile | undefined>();

/** 名前と中身を渡したファイルだけを読む Program を作る（標準ライブラリはディスクから読む）。 */
function virtualProgram(files: ReadonlyMap<string, string>): ts.Program {
  const base = ts.createCompilerHost(COMPILER_OPTIONS);
  // 渡したファイルの祖先のディレクトリ。import の解決で、ディスクに無い置き場所（テストの /virtual/）も
  // ディレクトリとして扱うのに使う。呼ばれるたびに全件を調べないよう、先に 1 回だけ作る。
  const dirs = new Set<string>();
  for (const f of files.keys()) {
    for (let d = dirname(f); !dirs.has(d) && d !== dirname(d); d = dirname(d)) dirs.add(d);
  }
  const host: ts.CompilerHost = {
    ...base,
    getSourceFile: (name, lang) => {
      const text = files.get(name);
      if (text !== undefined) return ts.createSourceFile(name, text, lang, true);
      if (!diskSourceFiles.has(name)) diskSourceFiles.set(name, base.getSourceFile(name, lang));
      return diskSourceFiles.get(name);
    },
    fileExists: (name) => files.has(name) || base.fileExists(name),
    // 渡したファイルの置き場所がディスクに無くても（テストの /virtual/）、import の解決でディレクトリとして扱う。
    directoryExists: (dir) => dirs.has(dir) || (base.directoryExists?.(dir) ?? false),
    readFile: (name) => files.get(name) ?? base.readFile(name),
  };
  return ts.createProgram([...files.keys()], COMPILER_OPTIONS, host);
}

/** ソースの中で、ブランド型に絞っていない型ガードのうち、判定が型と一致しないもの。`<行>: <説明>` の一覧。 */
export function findViolations(
  text: string,
  fileName: string,
  others: Readonly<Record<string, string>> = {},
): string[] {
  const name = `/virtual/${fileName}`;
  // others は、検査するソースが import する別のファイル（名前は /virtual/ からのパス）。検査はしない。
  const program = virtualProgram(
    new Map([
      [name, text],
      ...Object.entries(others).map(([f, t]): [string, string] => [`/virtual/${f}`, t]),
    ]),
  );
  const sf = program.getSourceFile(name);
  if (sf === undefined) throw new Error(`${fileName} を読めない`);
  return violationsIn(sf, program.getTypeChecker());
}

/** 検査の対象か。scripts/ と skills/ の .ts・.mjs と、private skill の .ts・.mjs。 */
export function isTarget(file: string, privateSkills: ReadonlySet<string>): boolean {
  if (!/\.(ts|mjs)$/.test(file) || file.endsWith(".d.ts")) return false;
  if (/^(scripts|skills)\//.test(file)) return true;
  const m = /^\.agents\/skills\/([^/]+)\//.exec(file);
  return m !== null && privateSkills.has(m[1]);
}

/**
 * 引数で渡したファイルを、リポジトリの直下からのパスにする。リポジトリの外を指すものは null。
 * lefthook はリポジトリの直下から相対パスで渡すが、cwd がサブディレクトリでも同じ結果にする。
 */
export function normalizeArgs(args: readonly string[], cwd: string, root: string): string[] | null {
  const out: string[] = [];
  for (const a of args) {
    const rel = relative(root, resolve(cwd, a)).split("\\").join("/");
    if (rel.startsWith("../") || rel === ".." || /^[A-Za-z]:\//.test(rel)) return null;
    out.push(rel);
  }
  return out;
}

/**
 * 引数で渡したファイルを、リポジトリの直下からのパスにして返す。
 * リポジトリの外のファイル・無いファイル・ディレクトリを渡されたら、理由を stderr に出して null を返す。
 */
function givenFiles(args: readonly string[], root: string): string[] | null {
  const given = normalizeArgs(args, process.cwd(), root);
  if (given === null) {
    console.error(`type-guard-brands: リポジトリ（${root}）の外のファイルを渡された`);
    return null;
  }
  // lefthook の {staged_files} は消したファイルとディレクトリを含まないので、無いファイルとディレクトリは
  // パスの誤りとして扱う。
  const missing = given.filter((f) => !existsSync(join(root, f)));
  if (missing.length > 0) {
    console.error(`type-guard-brands: 渡されたファイルが無い: ${missing.join(", ")}`);
    return null;
  }
  const dirs = given.filter((f) => !statSync(join(root, f)).isFile());
  if (dirs.length > 0) {
    const shown = dirs.map((f) => (f === "" ? "." : f)).join(", ");
    console.error(`type-guard-brands: ファイルではないものを渡された: ${shown}`);
    return null;
  }
  return given;
}

/** 対象のファイルをまとめて型の検査にかけ、違反を `<ファイル>:<行>: <説明>` の一覧で返す。読めないファイルがあれば null。 */
function collectViolations(root: string, targets: readonly string[]): string[] | null {
  const program = virtualProgram(
    new Map(targets.map((f) => [join(root, f), readFileSync(join(root, f), "utf8")])),
  );
  const checker = program.getTypeChecker();
  const violations: string[] = [];
  for (const file of targets) {
    const sf = program.getSourceFile(join(root, file));
    if (sf === undefined) {
      console.error(`type-guard-brands: ${file} を読めない。判定できないので失敗にする`);
      return null;
    }
    for (const v of violationsIn(sf, checker)) violations.push(`${file}:${v}`);
  }
  return violations;
}

function main(args: readonly string[]): number {
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
  let candidates = files;
  if (args.length > 0) {
    const given = givenFiles(args, root);
    if (given === null) return 2;
    candidates = given;
  }
  // 作業ツリーから消して、まだ index に残っているファイルは、消す途中なので読まない。
  const targets = candidates
    .filter((f) => isTarget(f, privateSkills))
    .filter((f) => existsSync(join(root, f)));
  if (args.length > 0 && targets.length === 0) {
    // stage したファイルが対象の外（インストール済みのコピーなど）だけなら、検査するものが無い。
    console.log(`type-guard-brands: 渡された ${args.length} 件に対象のファイルが無い`);
    return 0;
  }
  if (targets.length === 0) {
    console.error(
      `type-guard-brands: 対象のファイルが 0 件（${root}）。判定できないので失敗にする`,
    );
    return 2;
  }
  const violations = collectViolations(root, targets);
  if (violations === null) return 2;
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

if (isCliEntry()) process.exit(main(process.argv.slice(2)));
