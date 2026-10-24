// ページで実行する page ファイルで、export した本体を除いて関数の行数を数えるルール（Issue #758）。
//
// Playwright の evaluate は、渡した関数のソースだけをページへ送る。そのため、本体が呼ぶ関数は本体の中に入れ子で書くしかない。
// 組み込みの `max-lines-per-function` は入れ子の関数の行も本体に数えるので、本体を外すオプションが無いと、本体は必ず上限を超える。
// そこで、ファイルの最上位で export した関数の宣言（本体）だけを数えず、入れ子の関数を含むそれ以外の関数に上限を当てる。
// 数え方は max-lines-except-describe.ts と同じ（空行とコメントも数える・即時実行の関数は数えない）。
// complexity と max-depth は組み込みのルールが関数ごとに数え、入れ子の関数を本体に数えないので、組み込みのまま当てる。
import { type AstNode, countedNode, isIife, maxOf } from "./max-lines-except-describe.ts";

const RULE = "max-lines-per-function-except-page-entry";

type Context = {
  options: readonly unknown[];
  report: (d: { node: AstNode; message: string }) => void;
};

/** export した関数の宣言（`export function f() {}`）か。export の宣言はモジュールの最上位にしか書けないので、親だけを見る。 */
export function isPageEntry(fn: AstNode): boolean {
  const parent = fn.parent;
  return fn.type === "FunctionDeclaration" && parent?.type === "ExportNamedDeclaration";
}

export const maxLinesExceptPageEntry = {
  meta: {
    type: "suggestion",
    docs: { description: "最上位で export した関数を除いて、関数の行数に上限を当てる" },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
  },
  create(context: Context) {
    const max = maxOf(context.options, RULE);
    const check = (fn: AstNode) => {
      if (isIife(fn) || isPageEntry(fn)) return;
      const { loc } = countedNode(fn);
      const lines = loc.end.line - loc.start.line + 1;
      if (lines > max)
        context.report({
          node: fn,
          message: `関数が ${lines} 行ある。上限は ${max} 行（最上位で export した本体は数えない）。処理を別の関数に分ける`,
        });
    };
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
};
