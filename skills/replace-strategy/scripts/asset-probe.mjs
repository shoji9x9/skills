// 移行元の静的資産の棚卸しのプローブ。
// 使い方: `node <このファイル>` を引数なしで実行し、stdout に出る関数式のソースを chrome-devtools MCP の evaluate_script の
// function 引数にそのまま渡す。Node はソースを組み立てて出すだけで、測定はしない（測るのはブラウザの document）。
// 引数を付けると、使い方を stderr に出して exit 2 で終わる。使い方の原本は references/static-assets.md である。
//
// 測るもの: 現行画面が「実際に描いている」静的資産。img だけを見ると取りこぼすため、
// 同じ走査で疑似要素（::before / ::after）の content と書体、background-image 等の url()、
// document.fonts、@font-face の src、アイコンの link、読み込まれた資源を読む。
// 画面に出ていない img（display: none 等）は rendered: false として残す。
// 「出ていないから描かない」と決める前に、同じ場所を疑似要素が描いていないかを突き合わせるため。
// 決定論的: 乱数・時刻に依存せず、document 順に走査する（resources だけは読み込み順）。
//
// ページで実行するコードは page/asset-probe.page.mjs にある。この CLI は、その本文を関数式で包んで出す。

import { isCliEntry } from "./lib/cli.mjs";
import { pageFunctionSource, runProbeCli } from "./lib/page-function.mjs";

const USAGE =
  "usage: node asset-probe.mjs（引数を取らない。stdout に evaluate_script へ渡す関数式を出す）";

/**
 * evaluate_script の function 引数に渡す関数式のソースを返す。
 * @returns {string}
 */
export function assetProbeSource() {
  return pageFunctionSource(
    new URL("./page/asset-probe.page.mjs", import.meta.url),
    "assetProbeInPage",
  );
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = runProbeCli(process.argv.slice(2), { source: assetProbeSource, usage: USAGE });
}
