// ページで実行する page ファイルで、export した本体を入れ子の関数と分けて行数を数えるルール（Issue #758）。
//
// Playwright の evaluate は、渡した関数のソースだけをページへ送る。そのため、本体が呼ぶ関数は本体の中に入れ子で書くしかない。
// 組み込みの `max-lines-per-function` は入れ子の関数の行も本体に数えるので、本体を外すオプションが無いと、本体は必ず上限を超える。
// そこで、ファイルの最上位で export した関数の宣言（本体）は、入れ子の関数とコメントを空白に置き換えたうえで、
// 空白でない文字が残る行の数に上限を当てる。入れ子の関数と同じ行にある本体の処理（`n += xs.filter((x) => x.ok).length;`）は本体の行に数える。
// 空行とコメントだけの行を数えないのは、入れ子の関数の JSDoc と区切りの空行が本体の行として残るからである
// （組み込みのルールの skipBlankLines・skipComments と同じ考え方）。
// 本体の外の関数と入れ子の関数には、max-lines-except-describe.ts と同じ数え方（空行とコメントも数える・即時実行の関数は
// 数えない）で、全体の行数に上限を当てる。
// complexity と max-depth は組み込みのルールが関数ごとに数え、入れ子の関数を本体に数えないので、組み込みのまま当てる。
import { type AstNode, countedNode, isIife, maxOf } from "./max-lines-except-describe.ts";

const RULE = "max-lines-per-function-except-page-entry";

/** コメントと関数のうち、ルールが読む欄（ファイルの中の位置。UTF-16 の位置）。 */
type Ranged = { range?: [number, number] };
type Comment = Ranged;

type Context = {
  options: readonly unknown[];
  sourceCode: { text: string; getAllComments: () => Comment[] };
  report: (d: { node: AstNode; message: string }) => void;
};

/**
 * コードのある行（1 始まりの行番号）の集合。masked（コメントと入れ子の関数）を空白に置き換えてから、空白でない文字が残る行を数える。
 * 範囲（range）を読めなければ、判定できないので例外にする。
 */
export function codeLines(text: string, masked: readonly Ranged[]): Set<number> {
  // range は UTF-16 の位置なので、code unit の配列で置き換える。
  const units = text.split("");
  for (const c of masked) {
    if (!c.range) throw new Error(`${RULE}: コメントか関数の範囲（range）を読めない`);
    for (let i = c.range[0]; i < c.range[1]; i++) if (units[i] !== "\n") units[i] = " ";
  }
  const lines = new Set<number>();
  units
    .join("")
    .split("\n")
    .forEach((line, i) => {
      if (line.trim() !== "") lines.add(i + 1);
    });
  return lines;
}

/** export した関数の宣言（`export function f() {}`）か。export の宣言はモジュールの最上位にしか書けないので、親だけを見る。 */
export function isPageEntry(fn: AstNode): boolean {
  const parent = fn.parent;
  return fn.type === "FunctionDeclaration" && parent?.type === "ExportNamedDeclaration";
}

const FUNCTION_TYPES = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"];

/** fn を包む、最も近い関数（即時実行の関数は除く）。無ければ null。 */
export function enclosingFunction(fn: AstNode): AstNode | null {
  let node = fn.parent;
  while (node) {
    if (FUNCTION_TYPES.includes(node.type) && !isIife(node)) return node;
    node = node.parent;
  }
  return null;
}

/** 行を数える範囲（始まりと終わりの行）。 */
function spanOf(fn: AstNode): [number, number] {
  const { loc } = countedNode(fn);
  return [loc.start.line, loc.end.line];
}

/** 本体の行のうち、code にある行の数。 */
function ownLines(entry: AstNode, code: Set<number>): number {
  const [start, end] = spanOf(entry);
  let own = 0;
  for (let line = start; line <= end; line++) if (code.has(line)) own++;
  return own;
}

export const maxLinesExceptPageEntry = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "最上位で export した関数は入れ子の関数とコメントを除いてコードの残る行の数で、他の関数は全体の行数で上限を当てる",
    },
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
    /** 本体ごとの、すぐ内側の関数。 */
    const nested = new Map<AstNode, Ranged[]>();
    const check = (fn: AstNode & Ranged) => {
      if (isIife(fn) || isPageEntry(fn)) return;
      const outer = enclosingFunction(fn);
      if (outer !== null && isPageEntry(outer))
        nested.set(outer, [...(nested.get(outer) ?? []), fn]);
      const [start, end] = spanOf(fn);
      const lines = end - start + 1;
      if (lines > max)
        context.report({
          node: fn,
          message: `関数が ${lines} 行ある。上限は ${max} 行。処理を別の関数に分ける`,
        });
    };
    const checkEntry = (fn: AstNode) => {
      if (!isPageEntry(fn)) return;
      const masked = [...context.sourceCode.getAllComments(), ...(nested.get(fn) ?? [])];
      const own = ownLines(fn, codeLines(context.sourceCode.text, masked));
      if (own > max)
        context.report({
          node: fn,
          message: `本体が入れ子の関数とコメントを除いて ${own} 行ある。上限は ${max} 行。処理を入れ子の関数に分ける`,
        });
    };
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
      "FunctionDeclaration:exit": checkEntry,
    };
  },
};
