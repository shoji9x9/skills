// ページで実行する関数のソースを組み立てて出す CLI の処理（role-probe.mjs・asset-probe.mjs が使う）。
// chrome-devtools MCP の evaluate_script は、`function` 引数に渡した関数のソースをページで呼び出し、返り値を JSON で返す。
// ページへ渡るのはソースだけなので、ページで実行するコードは import も export も持たない別のファイル（page/*.page.mjs）に置く。
// ここでそのファイルの本文を `() => { <本文>\nreturn <本体>();\n}` の関数式で包む。
// 本文のトップレベルの宣言は関数式の中のローカルの宣言になるので、本体とヘルパーは同じ名前で互いを呼べる。

import { readFileSync } from "node:fs";

/**
 * ページで実行するコードのファイルを読み、本文を関数式で包んだソースを返す。
 * @param {URL} pageFile ページで実行するコードのファイル。トップレベルに関数の宣言と定数だけを持つ
 * @param {string} mainName 本体の関数の名前。包んだ関数式がこれを呼んで返す
 * @returns {string}
 */
function pageFunctionSource(pageFile, mainName) {
  const body = readFileSync(pageFile, "utf8").trimEnd();
  return `() => {\n${body}\nreturn ${mainName}();\n}`;
}

/**
 * プローブの CLI を実行する。引数は取らない。
 * 引数が無ければソースを stdout に出して 0 を、あれば理由と使い方を stderr に出して 2 を返す。
 * @param {string[]} argv
 * @param {{ source: () => string, usage: string }} probe ソースを返す関数と、使い方の文
 * @returns {number}
 */
function runProbeCli(argv, { source, usage }) {
  if (argv.length > 0) {
    process.stderr.write(`未知の引数: ${argv[0]}\n${usage}\n`);
    return 2;
  }
  process.stdout.write(`${source()}\n`);
  return 0;
}

export { pageFunctionSource, runProbeCli };
