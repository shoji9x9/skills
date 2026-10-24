// 当たっている CSS 規則の採取（採取の仕方はこのスクリプトで定義する）。
// 原本はこのスキルの中にあり、**プロジェクトへコピーせずスキルの中からそのまま実行する**
// （`gh skill update` の自動更新を反映させるため。SKILL.md「成果物」と references/capture.md も同じ取り決めである）。
// `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーするのは、`parity-suite` 同梱の差分ツールと
// 特性採取ツールのほうで、このスクリプトはコピーしない。
//
// 何を採るか: 論理名を付けた要素に当たりうる CSS 規則を列挙する。
// 規則ごとに、宣言（プロパティ・値・`!important`）、成立に必要な状態擬似クラス・擬似要素、
// 条件（`@media` / `@supports` / `@container`）、カスケードレイヤ、出所（スタイルシートの URL と規則の位置）を付ける。
// あわせて、`style` 属性の宣言を `inline_declarations` として採る。この宣言はどのスタイルシートにも現れないので、
// 規則の走査だけでは 1 件も残らない。インスタンス固有の値がここで当たっている部品では、
// 出所と `!important` の優先度を計算後スタイルから復元できない。
//
// 何を採らないか: **どの宣言が勝つか（カスケードの解決結果）は採らない。** 勝った宣言は計算後スタイルに
// 現れ、それは `parity-suite` の trait-capture.mjs が採る。このツールが補うのは、計算後スタイルに現れないほうである。
// 計算値は「いまの状態の結果」なので、`:hover` の宣言も `!important` の競合も見えない。
// 採った規則は、実装者が何を反映するかを決めるための一次資料であり、合否の判定の入力ではない
// （合否は画素の比較と特性の照合で決まる）。
//
// Chrome 149.0.7827.155 で実測した結果は次のとおりである（CDP の Page.setDocumentContent と Runtime.evaluate で確かめた）。
//   1. `CSSImportRule` は `cssRules` を持たない（`"cssRules" in rule === false`）。
//      持つのは `styleSheet` で、`@import` の先の規則はそこからしか辿れない。
//   2. `CSSStyleRule` は（CSS 入れ子のため）`cssRules` を持つ。入れ子が無くても length 0 の
//      空 CSSRuleList になる。このため `if (rule.cssRules) 再帰する; else 数える;` の走査は
//      通常の規則を 1 件も数えない（同じ入力で 6 件が 1 件になることを確認した）。
//   3. 入れ子の規則の `selectorText` は `&` を保った形で返る（`.inner` と書いても `& .inner`）。
//      `el.matches("&:hover")` は throw せず false を返すため、`&` を解決しないと警告なしに取りこぼす。
//   4. `el.matches(".btn::after")` も throw せず false を返す。擬似要素も剥がさないと同じ取りこぼしになる。
// 1 と 2 は、実際の移行で報告された現象と同じである（辿らないと 883 件、辿ると 3,206 件。883 件のはずが 4 件）。
// どちらも、取りこぼしても例外が出ないので、走査が誤っていることが出力から分からない。
// そのため、このツールは**数えられなかったものを必ず出力に残す**（`inaccessible` / `unresolved`）。
//
// Playwright はピア前提であり import しない。Locator は引数で受け取り、
// locator.evaluate() 経由でブラウザ内 DOM を操作する（型は JSDoc のみ。TypeScript 構文は使わない）。
// locator.evaluate は渡した関数のソースだけをページへ送るので、ページで実行する関数はモジュールの名前を参照できない。
// そのため、ページで実行する本体（collectInPage）は `page/css-rules-capture.page.mjs` に、本体が呼ぶ関数を
// 入れ子にした 1 つの関数として置く。captureMatchedRules はそれを import し、そのまま evaluate へ渡す。
// 本体が使う集合（STATE_PSEUDO_CLASSES・STRUCTURAL_PSEUDO_CLASSES）は、このファイルで定義して引数で渡す。
// `page/` のファイルもスキルの中に置いたまま使うので、このスクリプトだけを別の場所へコピーしても動かない。
//
// 本体がページで動くことも確かめた。Chrome for Testing 153.0.8010.12 の chrome-headless-shell を使った。
// Playwright 1.64.0 の chromium.launch({ executablePath }) で起動し、captureMatchedRules で同じページの複数の要素を採った。
// 要素には、`:hover` などの状態擬似クラス・`@media`・`@import`・`!important`・シャドウ DOM・
// クロスオリジンで読めないスタイルシートが当たる。
// 偽の CSSOM に対するユニットテストは、配布元のリポジトリにある（素朴な走査が同じ入力で取りこぼすことも、あわせて示している）。

import { isArray } from "./lib/is-array.mjs";
import { collectInPage } from "./page/css-rules-capture.page.mjs";

// 要素 1 つの採取を Node から直接呼ぶ関数。利用者のコードが import しうる公開の名前なので、本体の別名として export する。
export { collectInPage as collectMatchedRules };

/**
 * ツールのバージョン（このスクリプトで定義する）。採取スキーマ（出力の形・状態擬似クラスの集合）を変えたら上げる。
 * 2: `inline_declarations`（style 属性の宣言）と `counts.outer_scope_skipped` を足した。
 *    シャドウツリーの中の要素では、走査を自分の根に限った（外側の document の規則は
 *    カプセル化で当たらないため matched に入れず、`::part()` だけを unresolved に残す）。
 *    1 で採った css-rules.json は、インラインの指定が「無い」のか「採っていない」のかを区別できない。
 *    また、シャドウの部品では外側の規則を当たったものとして含んでいるので、採り直す。
 *    ホスト自身のシャドウルートは `:host` 系だけを unresolved に残し、残りを
 *    `counts.host_scope_skipped` に数える（`shadow_host` で対象がホストだったかを出す）。
 *    **2 の定義は、この PR がマージされた状態を指す**。版を上げてから同じ PR の中で 2 の形を
 *    足しているが、2 が main に入ったことは一度も無いので、外に「別の 2」で採った成果物は存在しない。
 * 3: 自分の根にある `::part()` / `::slotted()` の規則を matched に入れず unresolved に残す。
 *    2 はそれを擬似要素として剥がして判定し、`.host::part(label)` をホストに、`::slotted(*)` を
 *    任意の要素に当たった規則として記録していた（偽の根拠）。2 で採った css-rules.json は採り直す。
 * 4: 擬似クラス・擬似要素の名前を大文字小文字を区別せずに判定し、`states` / `pseudo_element` には小文字で記録する。
 *    3 は小文字の綴りしか認識せず、`.host::PART(label)` をホストに当たった規則として matched に入れ、
 *    `:HOVER` を未知の擬似クラスとして unresolved に入れていた。3 で採った css-rules.json は採り直す。
 * metadata.json の `capture.tools.css_rules_version` に記録する値はこれを使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "4";

/**
 * 構造・関係を表す擬似クラスで、状態ではないもの（セレクタに残したまま matches() へ渡してよい）。
 * この集合にも STATE_PSEUDO_CLASSES にも無い擬似クラスは、**未知**として unresolved に入れる。
 * `:popover-open` / `:user-valid` / `:fullscreen` のような動的な状態を知らないまま残すと、
 * その状態でない要素に対して matches() が false を返す。すると、当たるはずの規則が記録も警告も無く消える。
 * 集合を増やすときは「その状態でなくても当たるか（構造）」「状態のときだけ当たるか（状態）」で分ける。
 * @type {readonly string[]}
 */
export const STRUCTURAL_PSEUDO_CLASSES = [
  "any-link",
  "dir",
  "empty",
  "first-child",
  "first-of-type",
  "has",
  "host",
  "host-context",
  "is",
  "lang",
  "last-child",
  "last-of-type",
  "matches",
  "not",
  "nth-child",
  "nth-last-child",
  "nth-last-of-type",
  "nth-of-type",
  "only-child",
  "only-of-type",
  "root",
  "scope",
  "where",
];

/**
 * 状態を表す擬似クラスの集合（このスクリプトで定義する）。
 * これらは「その状態のときだけ当たる」ことを意味するので、セレクタから剥がして
 * 残りで要素に当たるかを判定し、剥がした名前を `states` として記録する。
 * 剥がさずに matches() へ渡すと、hover 中でない要素に対して常に false になり、
 * `:hover` の宣言が 1 件も採れない（計算値だけでは足りない箇所）。
 * @type {readonly string[]}
 */
export const STATE_PSEUDO_CLASSES = [
  "active",
  "checked",
  "default",
  "disabled",
  "enabled",
  "focus",
  "focus-visible",
  "focus-within",
  "hover",
  "indeterminate",
  "invalid",
  "link",
  "optional",
  "placeholder-shown",
  "read-only",
  "read-write",
  "required",
  "target",
  "valid",
  "visited",
];

/**
 * 1 つの要素の採取の結果（形は page/css-rules-capture.page.mjs で定義する）。
 * @typedef {import("./page/css-rules-capture.page.mjs").MatchedRulesCapture} MatchedRulesCapture
 */

/**
 * 論理名を付けた要素ごとに、当たっている CSS 規則を採る。
 *
 * @param {{
 *   name: string,
 *   locator: {
 *     evaluate(
 *       fn: (el: Element, arg: { statePseudoClasses: readonly string[], structuralPseudoClasses: readonly string[] }) => unknown,
 *       arg: { statePseudoClasses: readonly string[], structuralPseudoClasses: readonly string[] },
 *     ): Promise<unknown>,
 *   },
 * }[]} entries 論理名と Playwright Locator の組。
 * @param {{ statePseudoClasses?: readonly string[], structuralPseudoClasses?: readonly string[] }} [options]
 * @returns {Promise<({ name: string, tool_version: string } & MatchedRulesCapture)[]>} 論理名ごとの採取の結果。
 */
export async function captureMatchedRules(entries, options = {}) {
  /**
   * 採取の結果の形か（collectInPage は常にこの形を返す）。
   * @param {unknown} value
   * @returns {value is MatchedRulesCapture}
   */
  const isCapture = (value) =>
    typeof value === "object" &&
    value !== null &&
    "matched" in value &&
    isArray(value.matched) &&
    "unresolved" in value &&
    isArray(value.unresolved) &&
    "inaccessible" in value &&
    isArray(value.inaccessible) &&
    "inline_declarations" in value &&
    isArray(value.inline_declarations);
  const resolved = {
    statePseudoClasses: options.statePseudoClasses || STATE_PSEUDO_CLASSES,
    structuralPseudoClasses: options.structuralPseudoClasses || STRUCTURAL_PSEUDO_CLASSES,
  };
  const results = [];
  for (const entry of entries) {
    const captured = await entry.locator.evaluate(collectInPage, resolved);
    // collectInPage は常にこの形を返すので、ここで投げることは起きない（型の絞り込みのため）。
    if (!isCapture(captured))
      throw new Error(`css rules capture returned an unexpected shape: ${entry.name}`);
    results.push({ name: entry.name, tool_version: VERSION, ...captured });
  }
  return results;
}
