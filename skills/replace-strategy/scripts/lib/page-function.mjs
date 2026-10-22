// ページで実行する関数のソースを組み立てる（role-probe.mjs・asset-probe.mjs が使う）。
// chrome-devtools MCP の evaluate_script は、`function` 引数に渡した関数のソースをページで呼び出し、返り値を JSON で返す。
// ページへ渡るのはソースだけなので、渡す関数はモジュールの名前を参照できない。
// そこで、本体の関数とページ側のヘルパーを別々のトップレベルの関数に書き、ここで 1 つの関数式のソースにまとめる。
// ヘルパーと定数は関数式の中のローカルの宣言として並べるので、本体とヘルパーは、モジュールのトップレベルと同じ名前で互いを呼べる。

import { isDeepStrictEqual } from "node:util";
import { Script } from "node:vm";

/** 宣言の名前に使えない語（予約語と、strict mode で束縛できない名前）。 */
const RESERVED_WORDS = new Set(
  (
    "await break case catch class const continue debugger default delete do else enum export extends " +
    "false finally for function if implements import in instanceof interface let new null package " +
    "private protected public return static super switch this throw true try typeof var void while " +
    "with yield arguments eval"
  ).split(" "),
);

/**
 * 名前が、ページで宣言できる識別子かを確かめる。関数なら、関数自身の名前（fn.name）と一致することも確かめる。
 * 一致しないと、Node のモジュールで呼んでいる名前と、ページで宣言する名前が別になる。
 * @param {string} name ヘルパーの一覧での名前
 * @param {unknown} value
 */
function assertDeclarableName(name, value) {
  if (!/^[A-Za-z_$][\w$]*$/u.test(name) || RESERVED_WORDS.has(name)) {
    throw new TypeError(
      `ページへ渡すヘルパーの名前 ${JSON.stringify(name)} は、宣言できる識別子でない`,
    );
  }
  if (typeof value === "function" && value.name !== name) {
    throw new TypeError(
      `ページへ渡すヘルパーの ${name} は、関数の名前（${JSON.stringify(value.name)}）と一致しない`,
    );
  }
}

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
 * ページで実行する関数式のソースを返す。
 * `() => { const <名前> = <ヘルパー>; ...; return (<本体>)(); }` の形にする。
 * 関数の値は `Function.prototype.toString` のソースのまま、それ以外の値（定数の配列など）は JSON にして埋め込む。
 * 組み立てたソースは構文だけを確かめる（実行はしない）。構文の誤りは、ページへ渡す前にここで例外になる。
 * @param {() => unknown} main 本体の関数。引数を取らない。
 * @param {Record<string, unknown>} helpers ページ側のヘルパーと定数の一覧。名前は宣言の名前になる。
 * @returns {string}
 */
function pageFunctionSource(main, helpers) {
  const declarations = Object.entries(helpers).map(([name, value]) => {
    assertDeclarableName(name, value);
    const source = typeof value === "function" ? String(value) : jsonSource(name, value);
    return `const ${name} = ${source};`;
  });
  const source = `() => {\n${declarations.join("\n")}\nreturn (${main})();\n}`;
  new Script(`(${source})`);
  return source;
}

export { pageFunctionSource };
