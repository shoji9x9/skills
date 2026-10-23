// セマンティクス測定の role プローブ。
// 使い方: `node <このファイル>` を引数なしで実行し、stdout に出る関数式のソースを chrome-devtools MCP の evaluate_script の
// function 引数にそのまま渡す。Node はソースを組み立てて出すだけで、測定はしない（測るのはブラウザの document）。
// evaluate_script は渡された関数を自ら呼び出して実行し、返り値を JSON で返すため、IIFE 化（`(...)()`）は不要である。
// 引数を付けると、使い方を stderr に出して exit 2 で終わる。
//
// 測るもの: 可視の対象要素（インタラクティブ要素に加え、見出し・テーブル・画像など
// role ロケータの対象になる要素）のうち、role ＋アクセシブルネームで引ける割合。
// アクセシブルネームの算出は仕様（accname）の近似であり、値は目安として扱う
//（references/measurement.md を参照）。決定論的: 乱数・時刻に依存せず、document 順に走査する。
//
// ページで実行するコードは page/role-probe.page.mjs にある。この CLI は、その本文を関数式で包んで出す。

import { isCliEntry } from "./lib/cli.mjs";
import { pageFunctionSource, runProbeCli } from "./lib/page-function.mjs";

const USAGE =
  "usage: node role-probe.mjs（引数を取らない。stdout に evaluate_script へ渡す関数式を出す）";

/**
 * evaluate_script の function 引数に渡す関数式のソースを返す。
 * @returns {string}
 */
export function roleProbeSource() {
  return pageFunctionSource(
    new URL("./page/role-probe.page.mjs", import.meta.url),
    "roleProbeInPage",
  );
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = runProbeCli(process.argv.slice(2), { source: roleProbeSource, usage: USAGE });
}
