// テストが起動する子プロセスのタイムアウト（Issue #663）。
//
// docs/testing.md「実行環境を固定する」は、テストが起動する子プロセスにタイムアウトを付けると決めている。
// 付けないと、止まった子プロセスを待つテストは vitest の testTimeout まで待ってから失敗し、どの子プロセスで止まったかが出力に残らない。
// CHILD_TIMEOUT_MS は testTimeout（vitest.config.ts の 30 秒）より短くし、子プロセスのタイムアウトが先に起きるようにする。
// findUntimedChildCalls は、子プロセスの起動の呼び出しのうち、タイムアウトを付けていないものと、
// 付けたタイムアウトがテストの打ち切りより先に起きないものを返す。
// 文字列の中のコード（テストが一時ディレクトリに書くテストの本文など）は呼び出しではないので、構文木で読んで対象から外す。
import ts from "typescript";
import { jsCommentRanges } from "../text/code-comments.ts";

/** テストが起動する子プロセスのタイムアウト（ミリ秒）。 */
export const CHILD_TIMEOUT_MS = 25_000;

/** vitest.config.ts の testTimeout（ミリ秒）。テストの timeout を書いていない呼び出しは、この値で打ち切られるとみなす。 */
export const TEST_TIMEOUT_MS = 30_000;

/** 子プロセスを起動する node:child_process の関数。 */
const SPAWNERS = new Set([
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
]);

/**
 * タイムアウトを付けない理由を書く印。呼び出しが始まる行の末尾か、その直前のコメントだけの行に置く。
 * 印はコメントとして読む。文字列の中の印や、前の行の呼び出しの末尾に付けた印では免除しない。
 */
const EXEMPT = /^\/\/ child-timeout-ok: \S/u;

/** child_process のモジュール名。 */
const MODULES = new Set(["node:child_process", "child_process"]);

/** spawnAsync（scripts/lib/spawn-async.ts）を import するモジュール名の形。中で spawn を起動する。 */
const SPAWN_ASYNC_MODULE = /(^|\/)spawn-async(\.ts)?$/u;

/** 免除の印のある行と、その行がコメントだけの行か。 */
function exemptLines(source: ts.SourceFile, sourceText: string, fileName: string) {
  const lines = new Map<number, boolean>();
  for (const range of jsCommentRanges(sourceText, fileName)) {
    if (range.kind !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
    if (!EXEMPT.test(sourceText.slice(range.pos, range.end))) continue;
    const { line } = source.getLineAndCharacterOfPosition(range.pos);
    const lineStart = source.getPositionOfLineAndCharacter(line, 0);
    lines.set(line, sourceText.slice(lineStart, range.pos).trim() === "");
  }
  return lines;
}

/**
 * `import("node:child_process")` か `require("node:child_process")` か。
 * 取り出した関数を追えないので、読み込む呼び出しそのものを返す。
 */
function isDynamicImport(call: ts.CallExpression): boolean {
  const callee = call.expression;
  const dynamic =
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require");
  const [specifier] = call.arguments;
  return (
    dynamic &&
    specifier !== undefined &&
    ts.isStringLiteralLike(specifier) &&
    MODULES.has(specifier.text)
  );
}

/** 起動の関数を import した名前。関数の別名は元の関数名を、名前空間は呼び出せる関数名の集合を持つ。 */
type SpawnerNames = { functions: Map<string, string>; namespaces: Map<string, Set<string>> };

/** node:child_process と spawn-async から import した名前（関数の別名と名前空間）を集める。 */
function childProcessNames(source: ts.SourceFile): SpawnerNames {
  const functions = new Map<string, string>();
  const namespaces = new Map<string, Set<string>>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const module = statement.moduleSpecifier.text;
    const members = MODULES.has(module)
      ? SPAWNERS
      : SPAWN_ASYNC_MODULE.test(module)
        ? new Set(["spawnAsync"])
        : undefined;
    if (members === undefined) continue;
    const defaultName = statement.importClause?.name;
    if (defaultName !== undefined) namespaces.set(defaultName.text, members);
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.set(bindings.name.text, members);
      continue;
    }
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (members.has(imported)) functions.set(element.name.text, imported);
    }
  }
  return { functions, namespaces };
}

/** 呼び出しが起動する関数の名前（起動の呼び出しでなければ undefined）。 */
function spawnerOf(call: ts.CallExpression, names: SpawnerNames): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return names.functions.get(callee.text);
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    names.namespaces.get(callee.expression.text)?.has(callee.name.text) === true
  ) {
    return callee.name.text;
  }
  return undefined;
}

/** 名前を宣言する位置か（変数・引数・関数・分割代入の名前と、オブジェクトのキー）。参照ではない。 */
function isDeclarationName(id: ts.Identifier): boolean {
  const parent = id.parent;
  return (
    ((ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isBindingElement(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)) &&
      parent.name === id) ||
    (ts.isBindingElement(parent) && parent.propertyName === id) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === id)
  );
}

/** 型の中の参照か（`typeof spawnSync` など）。子プロセスを起動しない。 */
function inTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isTypeNode(current)) return true;
    if (ts.isStatement(current)) return false;
  }
  return false;
}

/**
 * 起動の関数を、呼び出し以外で参照しているか（変数への代入・引数として渡す・`promisify`・分割代入・`cp["spawn"]` など）。
 * 参照した先の呼び出しを追えないので、参照そのものを返す。返すのは参照した関数名か名前空間の名前。
 */
function untrackedReference(id: ts.Identifier, names: SpawnerNames): string | undefined {
  if (isDeclarationName(id) || inTypePosition(id)) return undefined;
  const parent = id.parent;
  const spawner = names.functions.get(id.text);
  if (spawner !== undefined)
    return ts.isCallExpression(parent) && parent.expression === id ? undefined : spawner;
  const members = names.namespaces.get(id.text);
  if (members === undefined) return undefined;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === id) {
    // 起動の関数以外のメンバー（`cp.ChildProcess` など）は対象にしない。起動の関数は、呼び出すときだけ追える。
    if (!members.has(parent.name.text)) return undefined;
    const call = parent.parent;
    return ts.isCallExpression(call) && call.expression === parent ? undefined : parent.name.text;
  }
  return id.text;
}

/** オブジェクトのリテラルが自分のキーに持つ `timeout` のプロパティ（無ければ undefined）。 */
function timeoutProperty(
  object: ts.ObjectLiteralExpression,
): ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === "timeout",
  );
}

/**
 * 起動の引数に付けた `timeout` の値。付いていなければ undefined、値を読めなければ null を返す。
 * 読めるのは、数値のリテラル（`_` の区切りを含む）と `CHILD_TIMEOUT_MS` と、`x ?? <読める値>` である。
 * Node は `timeout: 0` をタイムアウトなしとして扱うので、0 は付いていないものとして返す。
 * `timeout` の後ろにスプレッドがあると、スプレッドの中の `timeout`（`undefined` や 0 を含む）が上書きしうるので、付いていないものとして返す。
 */
function childTimeout(call: ts.CallExpression): number | null | undefined {
  for (const arg of call.arguments) {
    if (!ts.isObjectLiteralExpression(arg)) continue;
    const property = timeoutProperty(arg);
    if (property === undefined) continue;
    const index = arg.properties.indexOf(property);
    if (arg.properties.slice(index + 1).some((p) => ts.isSpreadAssignment(p))) return undefined;
    const ms = ts.isPropertyAssignment(property) ? msOf(property.initializer) : null;
    return ms === 0 ? undefined : ms;
  }
  return undefined;
}

/** 数値のリテラルか `CHILD_TIMEOUT_MS` のミリ秒。`x ?? y` は y の値を返す。それ以外の式は null。 */
function msOf(expression: ts.Expression): number | null {
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (ts.isIdentifier(expression) && expression.text === "CHILD_TIMEOUT_MS")
    return CHILD_TIMEOUT_MS;
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  )
    return msOf(expression.right);
  return null;
}

/** vitest のテストを登録する呼び出しの名前（`test`・`it` と、`.skip`・`.each(...)`・型引数などを付けた形）。 */
const TEST_CALLEE = /^(test|it)(\.\w+|<[^]*>|\([^]*\))*$/u;

/** vitest の Hook を登録する呼び出しの名前。Hook は testTimeout ではなく hookTimeout で打ち切られる。 */
const HOOK_CALLEE = /^(beforeAll|beforeEach|afterAll|afterEach)$/u;

/** vitest の hookTimeout のデフォルト（ミリ秒）。vitest.config.ts は hookTimeout を書かない。 */
export const HOOK_TIMEOUT_MS = 10_000;

/** テストか Hook の timeout の値。0 と読めない式は null（比べない）。 */
function limitOf(expression: ts.Expression): number | null {
  const ms = msOf(expression);
  return ms === 0 ? null : ms;
}

/**
 * 呼び出しを囲むテストか Hook の timeout（ミリ秒）。どちらの本体の中にも無ければ undefined を返す。
 * timeout を書いていなければ TEST_TIMEOUT_MS か HOOK_TIMEOUT_MS、読めない式なら null を返す。
 */
function enclosingTestTimeout(node: ts.Node, source: ts.SourceFile): number | null | undefined {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (!ts.isCallExpression(current)) continue;
    const callee = current.expression.getText(source);
    const hook = HOOK_CALLEE.test(callee);
    if (!hook && !TEST_CALLEE.test(callee)) continue;
    // テストの名前や each の表の中ではなく、本体の関数の中にあるときだけ、そのテストで打ち切られる。
    const body = current.arguments.find((arg) => ts.isFunctionLike(arg));
    if (body === undefined || node.pos < body.pos || node.end > body.end) continue;
    // timeout は、本体の前のオプションのオブジェクト（`test(name, { timeout }, fn)`）か、本体の後ろの引数（`test(name, fn, ms)`）に書く。
    const index = current.arguments.indexOf(body);
    const after = current.arguments[index + 1];
    if (after !== undefined && !ts.isObjectLiteralExpression(after)) return limitOf(after);
    for (const arg of [...current.arguments.slice(0, index), ...(after ? [after] : [])]) {
      const property = ts.isObjectLiteralExpression(arg) ? timeoutProperty(arg) : undefined;
      if (property !== undefined)
        return ts.isPropertyAssignment(property) ? limitOf(property.initializer) : null;
    }
    return hook ? HOOK_TIMEOUT_MS : TEST_TIMEOUT_MS;
  }
  return undefined;
}

/** 起動の呼び出しのタイムアウトの問題。問題が無ければ undefined、付いていなければ空文字を返す。 */
function timeoutProblem(
  call: ts.CallExpression,
  dynamic: boolean,
  source: ts.SourceFile,
): string | undefined {
  if (dynamic) return "";
  const child = childTimeout(call);
  if (child === undefined) return "";
  // 囲むテストが無ければ testTimeout で打ち切られる。読めない（null）ときは比べない。`??` は null も置き換えるので使わない。
  const enclosing = enclosingTestTimeout(call, source);
  const limit = enclosing === undefined ? TEST_TIMEOUT_MS : enclosing;
  if (child === null || limit === null || child < limit) return undefined;
  return `（timeout ${child} がテストの timeout ${limit} 以上）`;
}

/**
 * タイムアウトに問題がある起動の呼び出しを返す。返す形は次の 3 つである。
 * - `行番号: 関数名`: タイムアウトを付けていない。タイムアウトは、引数のオブジェクトのリテラルに `timeout` のキーがあるときだけ付いているとみなす。
 *   オプションを変数やスプレッドだけで渡す呼び出しは、中身を読めないので付いていないものとして返す。
 *   child_process を動的に読み込む呼び出し（`import()`・`require()`）は、取り出した関数を追えないので `行番号: import` で返す。
 * - `行番号: 関数名（timeout <子> がテストの timeout <テスト> 以上）`: 子プロセスのタイムアウトが、テストの打ち切りより先に起きない。
 *   テストの打ち切りは、呼び出しを囲むテストか Hook の timeout で決める。
 *   どちらにも囲まれない呼び出し（補助の関数の中など）は、testTimeout で打ち切られるとみなす。
 *   どちらかの値を読めなければ（変数や式）、比べずに通す。
 * - `行番号: 名前（呼び出し以外で参照）`: 起動の関数を、呼び出し以外で参照している。参照した先の呼び出しを追えない。
 * 1 つのテストの中で順に起動する子プロセスの timeout の合計は比べない。
 */
export function findUntimedChildCalls(sourceText: string, fileName = "input.ts"): string[] {
  if (!sourceText.includes("child_process") && !sourceText.includes("spawnAsync")) return [];
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = childProcessNames(source);
  const exempts = exemptLines(source, sourceText, fileName);
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    const exempt = exempts.has(line) || exempts.get(line - 1) === true;
    if (!exempt) found.push(`${line + 1}: ${text}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isCallExpression(node)) {
      const dynamic = isDynamicImport(node);
      const spawner = dynamic ? "import" : spawnerOf(node, names);
      const problem = spawner === undefined ? undefined : timeoutProblem(node, dynamic, source);
      if (spawner !== undefined && problem !== undefined) report(node, `${spawner}${problem}`);
    }
    if (ts.isIdentifier(node)) {
      const referenced = untrackedReference(node, names);
      if (referenced !== undefined) report(node, `${referenced}（呼び出し以外で参照）`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
