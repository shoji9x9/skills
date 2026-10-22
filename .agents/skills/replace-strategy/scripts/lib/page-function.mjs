// ページで実行する関数のソースを組み立てる（role-probe.mjs・asset-probe.mjs が使う）。
// chrome-devtools MCP の evaluate_script は、`function` 引数に渡した関数のソースをページで呼び出し、返り値を JSON で返す。
// ページへ渡るのはソースだけなので、渡す関数はモジュールの名前を参照できない。
// そこで、本体の関数とページ側のヘルパーを別々のトップレベルの関数に書き、ここで 1 つの関数式のソースにまとめる。
// 本体はヘルパーの一覧（`h`）を引数で受け取り、ヘルパーどうしも `h` を通して呼ぶ。

import { isDeepStrictEqual } from "node:util";

/**
 * 関数でない値を、ページへ渡すソースの文字列にする。
 * JSON で往復しても同じ値に戻らないもの（RegExp・Map・Set・undefined・NaN など）は、ページで別の値になるので例外を投げる。
 * 例えば RegExp は JSON にすると `{}` になり、ページで `.test` を呼んだときに初めて TypeError になる。
 * @param {string} name ヘルパーの一覧での名前
 * @param {unknown} value
 * @returns {string}
 */
function jsonSource(name, value) {
  const json = JSON.stringify(value);
  if (json === undefined || !isDeepStrictEqual(JSON.parse(json), value)) {
    throw new TypeError(
      `ページへ渡すヘルパーの ${name} は、関数でも JSON で往復できる値でもない（RegExp・Map・Set などは関数の中で作る）`,
    );
  }
  return json;
}

/**
 * ページで実行する関数式のソースを返す。`() => (<本体>)({ <名前>: <ヘルパー>, ... })` の形にする。
 * 関数の値は `Function.prototype.toString` のソースのまま、それ以外の値（定数の配列など）は JSON にして埋め込む。
 * 関数の宣言のソース（`function name(...) {...}`）は、プロパティの値の位置に置くと関数式として評価される。
 * @param {(h: never) => unknown} main 本体の関数。ヘルパーの一覧を 1 つ目の引数で受け取る。
 * @param {Record<string, unknown>} helpers ページ側のヘルパーと定数の一覧。
 * @returns {string}
 */
function pageFunctionSource(main, helpers) {
  const entries = Object.entries(helpers).map(
    ([name, value]) =>
      `${name}: ${typeof value === "function" ? String(value) : jsonSource(name, value)}`,
  );
  return `() => (${main})({\n${entries.join(",\n")}\n})`;
}

export { pageFunctionSource };
