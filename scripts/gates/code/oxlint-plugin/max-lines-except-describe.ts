// テストのファイルで、`describe` のコールバックを除いて関数の行数を数えるルール（Issue #658）。
//
// 組み込みの `max-lines-per-function` は、`describe` のコールバックだけを外すオプションを持たない。
// `describe` はファイルの大半を包むので、長くなってもよいとし、それ以外の関数（`test` のコールバック・ヘルパー関数）に上限を当てる。
// 数え方は組み込みのルールのデフォルト（空行とコメントも数える・即時実行の関数は数えない）に合わせる。
// メソッドと getter・setter は、組み込みのルールと同じく、キーを含む親の行から数える。
import { isRecord } from "../../../lib/guards.ts";

/** ルールが読む AST の節点。oxlint は型を公開していないので、読む欄だけを書く。 */
export type AstNode = {
  type: string;
  loc: { start: { line: number }; end: { line: number } };
  parent?: AstNode | null;
  name?: string;
  object?: AstNode;
  property?: AstNode;
  computed?: boolean;
  callee?: AstNode;
  tag?: AstNode;
  method?: boolean;
  kind?: string;
};

/** Program の直下の文のうち、import の宣言が読む欄。 */
export type Statement = {
  type: string;
  source?: { value?: unknown };
  specifiers?: { type: string; imported?: { name?: string }; local?: { name?: string } }[];
};

type Context = {
  options: readonly unknown[];
  report: (d: { node: AstNode; message: string }) => void;
};

export const DEFAULT_MAX = 50;
/**
 * `describe` と同じく、テストをまとめるだけの関数（vitest の `suite` は `describe` の別名）。
 * vitest から import した名前だけを数える（別名の import は、ファイルの中の名前で数える）。
 * 同じ名前の自前の関数（`const suite = ...`）に渡したコールバックまで外さないためである。
 */
const GROUPING_CALLEES = ["describe", "suite"];
/** describe の修飾（`describe.skip`・`describe.each(t)` など）。これ以外のメンバー（`suite.add`）は describe として扱わない。 */
const GROUPING_MODIFIERS = [
  "each",
  "for",
  "skip",
  "only",
  "concurrent",
  "sequential",
  "shuffle",
  "todo",
  "skipIf",
  "runIf",
];

/**
 * 呼び出しの callee から、名前の根（`describe.each(t)` なら `describe`）をたどる。
 * 途中のメンバーが describe の修飾でなければ（`suite.add`・`describe["each"]`）、根を決めずに null にする。
 */
export function calleeRoot(callee: AstNode | undefined): string | null {
  let node = callee;
  while (node) {
    if (node.type === "Identifier") return node.name ?? null;
    if (node.type === "MemberExpression") {
      if (!isGroupingModifier(node)) return null;
      node = node.object;
    } else if (node.type === "CallExpression") node = node.callee;
    else if (node.type === "TaggedTemplateExpression") node = node.tag;
    else return null;
  }
  return null;
}

/** メンバーの参照が、計算しないプロパティ名で describe の修飾を指すか。 */
const isGroupingModifier = (member: AstNode): boolean =>
  member.computed !== true &&
  member.property?.type === "Identifier" &&
  GROUPING_MODIFIERS.includes(member.property.name ?? "");

/** ファイルの中で、vitest の describe・suite を指す名前（`import { describe as d } from "vitest"` なら d）。 */
export function groupingNames(body: readonly Statement[]): Set<string> {
  const names = new Set<string>();
  for (const stmt of body) {
    if (stmt.type !== "ImportDeclaration" || stmt.source?.value !== "vitest") continue;
    for (const spec of stmt.specifiers ?? []) {
      const imported = spec.imported?.name;
      const local = spec.local?.name;
      if (
        spec.type === "ImportSpecifier" &&
        imported &&
        local &&
        GROUPING_CALLEES.includes(imported)
      )
        names.add(local);
    }
  }
  return names;
}

/** 関数が `describe` の呼び出しの引数か。names は groupingNames の結果。 */
export function isGroupingCallback(fn: AstNode, names: ReadonlySet<string>): boolean {
  const parent = fn.parent;
  if (!parent || parent.type !== "CallExpression" || parent.callee === fn) return false;
  const root = calleeRoot(parent.callee);
  return root !== null && names.has(root);
}

/** 即時実行の関数か（組み込みのルールのデフォルトは数えない）。 */
const isIife = (fn: AstNode): boolean =>
  fn.parent?.type === "CallExpression" && fn.parent.callee === fn;

/** 行を数える節点。メソッドと getter・setter はキーを含む親から数える。 */
function countedNode(fn: AstNode): AstNode {
  const parent = fn.parent;
  if (!parent) return fn;
  if (parent.type === "MethodDefinition") return parent;
  if (parent.type === "Property" && (parent.method === true || parent.kind !== "init"))
    return parent;
  return fn;
}

/** オプション `{ max }` の上限。数でない値は、判定できないので例外にする。 */
export function maxOf(options: readonly unknown[]): number {
  const first = options[0];
  const value = isRecord(first) ? first.max : undefined;
  if (first === undefined || value === undefined) return DEFAULT_MAX;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new Error("max-lines-per-function-except-describe: max は 1 以上の整数にする");
  return value;
}

export const maxLinesExceptDescribe = {
  meta: {
    type: "suggestion",
    docs: { description: "describe のコールバックを除いて、関数の行数に上限を当てる" },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
  },
  create(context: Context) {
    const max = maxOf(context.options);
    let names: ReadonlySet<string> = new Set();
    const check = (fn: AstNode) => {
      if (isIife(fn) || isGroupingCallback(fn, names)) return;
      const { loc } = countedNode(fn);
      const lines = loc.end.line - loc.start.line + 1;
      if (lines > max)
        context.report({
          node: fn,
          message: `関数が ${lines} 行ある。上限は ${max} 行（describe のコールバックは数えない）。処理を別の関数に分ける`,
        });
    };
    return {
      Program(node: { body: readonly Statement[] }) {
        names = groupingNames(node.body);
      },
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
};
