// ページで実行する関数のソースを組み立てて出す CLI の処理（role-probe.mjs・asset-probe.mjs が使う）。
// chrome-devtools MCP の evaluate_script は、`function` 引数に渡した関数のソースをページで呼び出し、返り値を JSON で返す。
// ページへ渡るのはソースだけなので、ページで実行するコードは別のファイル（page/*.page.mjs）に置く。
// そのファイルは、最後の行で本体だけを export し、ほかに import も export も持たない。
// 本体を export するのは、ファイルの中で本体を参照させ、利用者の lint が本体を使われない関数として報告しないためである。
// ここでその最後の行だけを外し、残りの本文をそのまま `() => { <本文>\nreturn <本体>();\n}` の関数式で包む。
// コメントは関数式の本体に入れても有効なので、外さない。
// 本文のトップレベルの宣言は関数式の中のローカルの宣言になるので、本体とヘルパーは同じ名前で互いを呼べる。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { errorMessage } from "./errors.mjs";
import { parseFlags } from "./flags.mjs";

/**
 * ページで実行するコードのファイルを読み、最後の行の本体の export だけを外して、関数式で包んだソースを返す。
 * 最後の空でない行が `export { <本体> };` でないときと、包んだソースが関数式として構文解析できないとき
 * （ほかに import・export・`import.meta` がある、など）は、例外を投げる。
 * @param {URL} pageFile ページで実行するコードのファイル。トップレベルに関数の宣言と定数だけを持つ
 * @param {string} mainName 本体の関数の名前。包んだ関数式がこれを呼んで返す
 * @returns {string}
 */
function pageFunctionSource(pageFile, mainName) {
  const lines = readFileSync(pageFile, "utf8").trimEnd().split("\n");
  const exportLine = `export { ${mainName} };`;
  if (lines.pop() !== exportLine) {
    throw new Error(`${fileURLToPath(pageFile)} の最後の行が「${exportLine}」でない`);
  }
  const source = `() => {\n${lines.join("\n")}\nreturn ${mainName}();\n}`;
  // 関数の本体では静的な import・export と import.meta が構文の誤りになる。行の字面ではなく構文解析で確かめる。
  try {
    new vm.Script(`(${source})`);
  } catch (error) {
    throw new Error(
      `${fileURLToPath(pageFile)} を関数式で包むと構文として読めない（最後の行のほかの import・export など）: ${errorMessage(error)}`,
    );
  }
  return source;
}

/**
 * プローブの CLI を実行する。引数は取らない。
 * 引数が無ければソースを stdout に出して 0 を、あれば理由と使い方を stderr に出して 2 を返す。
 * @param {string[]} argv
 * @param {{ source: () => string, usage: string }} probe ソースを返す関数と、使い方の文
 * @returns {number}
 */
function runProbeCli(argv, { source, usage }) {
  const parsed = parseFlags(argv, {});
  if (parsed.error !== undefined) {
    process.stderr.write(`${parsed.error}\n${usage}\n`);
    return 2;
  }
  /** @type {string} */
  let text;
  try {
    text = source();
  } catch (error) {
    // ページ用のファイルが無い・最後の行の export の形が違うなど。スタックトレースで終わらせず、理由を出して 2 を返す。
    process.stderr.write(`ページ用のソースを組み立てられない: ${errorMessage(error)}\n`);
    return 2;
  }
  process.stdout.write(`${text}\n`);
  return 0;
}

export { pageFunctionSource, runProbeCli };
