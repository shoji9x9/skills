// ページで実行する関数のソースを組み立てて出す CLI の処理（role-probe.mjs・asset-probe.mjs が使う）。
// chrome-devtools MCP の evaluate_script は、`function` 引数に渡した関数のソースをページで呼び出し、返り値を JSON で返す。
// ページへ渡るのはソースだけなので、ページで実行するコードは別のファイル（page/*.page.mjs）に置く。
// そのファイルは、最後の行で本体だけを export し、ほかに import も export も持たない。
// 本体を export するのは、ファイルの中で本体を参照させ、利用者の lint が本体を使われない関数として報告しないためである。
// ここでその最後の行と、行全体がコメントの行を外し、残りを `() => { <本文>\nreturn <本体>();\n}` の関数式で包む。
// 本文のトップレベルの宣言は関数式の中のローカルの宣言になるので、本体とヘルパーは同じ名前で互いを呼べる。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * lines[start] で始まるブロックのコメントが終わる行の番号を返す。
 * 閉じる `*\/` が無いときと、その後ろに空白以外が続くときは、行ごと外せないので -1 を返す。
 * @param {string[]} lines
 * @param {number} start 空白を除いた先頭が `/*` の行
 * @returns {number}
 */
function blockCommentEnd(lines, start) {
  // 開く `/*` の直後から探す（`/*/` の `*/` を閉じと読まない）
  const from = lines[start].indexOf("/*") + 2;
  for (let i = start; i < lines.length; i += 1) {
    const at = lines[i].indexOf("*/", i === start ? from : 0);
    if (at >= 0) return lines[i].slice(at + 2).trim() === "" ? i : -1;
  }
  return -1;
}

/**
 * 行全体がコメントの行を外す。外すのは、空白を除いた先頭が `//` の行と、`/*` で始まり `*\/` で終わるブロックの行だけである。
 * コードの後ろに続くコメントは残す。
 * 文字列・テンプレートリテラル・正規表現が複数行にまたがると、その中の行をコメントと取り違えるので、
 * ページ用のファイルはそれを書かない（このリポジトリのテストが確かめる）。
 * @param {string[]} lines
 * @returns {string[]}
 */
function dropCommentLines(lines) {
  /** @type {string[]} */
  const kept = [];
  let i = 0;
  while (i < lines.length) {
    const head = lines[i].trimStart();
    const end = head.startsWith("/*") ? blockCommentEnd(lines, i) : -1;
    if (head.startsWith("//")) i += 1;
    else if (end >= 0) i = end + 1;
    else {
      kept.push(lines[i]);
      i += 1;
    }
  }
  return kept;
}

/**
 * ページで実行するコードのファイルを読み、本体の export の行とコメントの行を外して、関数式で包んだソースを返す。
 * 最後の空でない行が `export { <本体> };` でないときと、ほかに import・export の行があるときは、例外を投げる。
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
  const body = dropCommentLines(lines);
  const stray = body.find((line) => /^\s*(?:import|export)\b/u.test(line));
  if (stray !== undefined) {
    throw new Error(
      `${fileURLToPath(pageFile)} に、最後の行のほかの import か export がある: ${stray.trim()}`,
    );
  }
  return `() => {\n${body.join("\n")}\nreturn ${mainName}();\n}`;
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
  /** @type {string} */
  let text;
  try {
    text = source();
  } catch (error) {
    // ページ用のファイルが無い・最後の行の export の形が違うなど。スタックトレースで終わらせず、理由を出して 2 を返す。
    process.stderr.write(
      `ページ用のソースを組み立てられない: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  process.stdout.write(`${text}\n`);
  return 0;
}

export { pageFunctionSource, runProbeCli };
