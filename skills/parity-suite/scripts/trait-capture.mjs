// 論理名付き要素の特性採取（原本）。
// 原本はこのスキル側にあり、実行時はプロジェクトの
// `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使う（配布スキルは、実行時に使う成果物を同梱する）。
// コピー先はコピー専用のサブディレクトリで、プロジェクト自作ツールと同居させない（修正しない規約のため）。
// このファイルのスキーマ（FIXED_PROPERTIES・採取形状）を変えたら、成果物の
// `metadata.json` の `traits.property_set` も必ず更新する（parity-diff は property_set を正とする）。
//
// 何を採るか: 論理名を付けた要素について、次のものを採る。
//   - 固定プロパティ集合の computed style
//   - 擬似要素（::before / ::after）の computed style
//   - getBoundingClientRect()
//   - 1 段下の子の inline style（child_inline_styles）
//   - 文字の持ち主（text_owners。部分木の中で文字を描いている要素ごとの書体・大きさ・文字の寸法）
//   - スクロールする領域の特性（scroll。スクロールバーの有無・厚み・見た目の宣言）
// 相対幾何（要素対の関係）は絶対座標ではなくこの rect から trait-compare.mjs 側で導出する。
//
// 採った対象が「画面に描かれているもの」かを、採取の中で 1 度だけ確かめる。特性照合は
// 「論理名を付けた要素そのもの」の固定プロパティ集合しか見ないため、名前が描かれていない要素へ
// 解決していると、全プロパティ一致のまま緑になり画素だけが差を出す（差が出ない形なので、
// 緑を根拠に先へ進める）。次の 2 つの形を防ぐ。
//   - 支援技術のためのコピー。市販部品は aria のための木を別に作り、getByRole が返す要素が
//     画面の外（y = -32000 など）に置かれていることがある。矩形が文書の外なら採取を失敗させる
//     （page/trait-capture.page.mjs の captureElement。getBoundingClientRect() は相対幾何のために既に読んでいる）。
//   - 装飾が子ノードに乗っている。名前を付けた要素の計算値は一致するのに、子の inline style が
//     見た目を変えている。子の計算値は採らず、inline style の在否と値だけを記録する。
//     画素の差を、フォントの版・ヒンティングの切り分けへ持っていかずに済むようにするためである
//     （照合には使わない診断材料。原本の説明は references/baseline.md）。
//
// 文字の持ち主（text_owners）: 固定集合の font 系は「名前を付けた要素そのもの」の値でしかない。
// 文字を持つのが子孫の要素だと（<button><div><span>設定</span></div></button>）、実際に文字を
// 描いている書体・大きさ・行の高さはどこにも採られず、新側が要素自身に文字を置く実装だと
// 要素の計算値が一致したまま特性照合が緑になる（文字の幅が 26px と 30.4px で違っていた）。
// そこで、部分木のテキストノードを平坦木の順に拾う（開いたシャドウルートの中と、<slot> に割り当てられた
// ノードを、描かれる位置で辿る）。平坦木の親要素（文字の持ち主。slot に割り当てられた文字は slot）ごとに 1 行を記録する。
// 記録するのは、TEXT_OWNER_PROPERTIES の計算値と、その要素が直接持つ文字の寸法である。
// 文字の寸法は、行の断片の幅の合計 advance・最大の高さ glyph_height・行の数 lines である。
// 行は文字が現れる順に並び、入れ子の深さに依らない。そのため、DOM の形が違う現・新でも、
// 「i 番目の文字の持ち主」どうしを trait-compare.mjs が突き合わせられる。
// 描かれていない文字（空白だけ・矩形の面積 0・visibility が visible でない・祖先の切り抜きで実質見えない〈sr-only 等〉）は
// 数えない。ボタンとして描く <input>（submit / button / reset）の value は文字として数える。
// 射程: 閉じたシャドウルートの中は辿れない。描画に使われた書体の実体（フォールバックの解決先）は
// 計算値に出ないので採らない。採取環境と利用者環境の乖離として、references/baseline.md の手順で確かめる。
//
// スクロールする領域（scroll）: 対象は、overflow-x / overflow-y の片方でも visible / clip でなく、display: inline でない HTML 要素である。
// 次のものを採る。
//   - はみ出しの有無（scrollWidth > clientWidth など）
//   - スクロールバー（とガター）が取った幅・高さ（offsetWidth − clientWidth − 左右の枠。縦のバーの幅）
//   - 見た目の宣言（SCROLLBAR_PROPERTIES と SCROLLBAR_PSEUDOS の計算値）
// 現行が overflow: auto で横スクロールバーを出し、新側が overflow-x: hidden で右端を切る場合を考える。
// 固定集合の overflow-x / overflow-y だけでは、この差のうち「バーが幅を取って中身がはみ出したか」が値に出ない。
// 実測では、628px のスクロール領域で現行だけ横スクロールバーが出た。
// バーの厚みは、撮影時のスクロールバーの扱いで変わる。--hide-scrollbars（Playwright のヘッドレス Chromium のデフォルト）では
// 0 になり、上の差は両側とも「はみ出し無し・厚み 0」に揃って消える。撮影条件の原本は references/baseline.md。
// スクロール領域でない要素は null（スクロール領域かどうかの差は overflow-x / overflow-y の差として固定集合に出る）。
// ::-webkit-scrollbar 系を読めないブラウザ（CSS.supports で判定）では webkit を "unsupported" にする
// （空の計算値を採って両側が一致したように見せない）。
//
// 何を採らないか: letter-spacing・text-transform・background-image など、要素の矩形の内側に
// そのまま撮影される項目は、この集合に含めない（名前無し要素の見た目差と同様、画素の比較＝要素
// スクリーンショット側に委ねる）。プロパティを足すときは、決定論的に採れ（乱数・時刻・
// アニメーションに依存せず）、両実装で意味が保たれる項目に限る。
//
// 画素の比較へ委ねられるのは、「要素の矩形を撮った静止画に表れる」プロパティだけである。表れないものを
// 外すと、特性照合でも画素比較でも差が出ず、どちらの比較方法にも現れない見た目になる
// （cursor を採り忘れたまま 12 状態 × 2 ロケールの照合と画素比較を全部緑で通り、利用者が
// 触って気づいた実例がある）。委ねる先が無いので、次の 4 種類はこの集合に入れる。
//
//   - 操作したときの手応えを決めるが、静止画には出ないもの。cursor / user-select / pointer-events
//   - 要素が**どこに置かれるか**を決めるもの。切り出しが要素についてくるため、矩形の中には出ない。
//     position / top / right / bottom / left（絶対座標そのものは rect が持つが、rect の差は
//     「ずれた」としか言わない。どの宣言がずらしているかは top / left の計算値でしか分からない）
//   - 要素の**矩形の外側**に描かれるもの、または下地に依存して区別できないもの。box-shadow（外側の影は
//     要素の矩形の外なので要素スクショに表れない）/ opacity（下地が違えば同じ値でも別の色になり、
//     逆に下地が同じでも、半透明と不透明の差が画素差として現れないことがある）
//   - 折り返し・省略を決めるもの。採取時の文字列が短ければ、静止画には差として出ない。
//     white-space / overflow-x / overflow-y / text-overflow / word-break
//     （実データが長くなった利用側で初めて表示が崩れる。部品カタログの見本では再現しない）
//
// 足す候補を検討するときは、「決定論的か」「両実装で意味が保たれるか」に加えて、「外したとき
// **要素の矩形を撮った**画素の比較が拾えるか」を必ず問う。ページ全体のスクショなら表れるものでも、
// 要素の矩形で切ると表れない。
//
// 計算値が url() を含みうる項目（cursor のカスタムカーソル等）は、相対 URL が自分のオリジンで
// 絶対化されるため、そのままでは現・新のホスト違いが偽の差分になる。captureElement が同一
// オリジンの url() だけを畳んで比較可能にしている（page/trait-capture.page.mjs の foldOrigin）。url() を持ちうる項目を
// 足すときは、この正規化で両側が揃うかを確かめる。
//
// 状態遷移（hover / focus / active / disabled 等）はこの関数の責務ではない。呼び出し側
// （スイート）が状態へ遷移させたうえで captureTraits を呼ぶ。この関数は「今の状態」を採るだけ。
//
// Playwright はピア前提であり import しない。Locator は引数で受け取り、
// locator.evaluate() 経由でブラウザ内 DOM を操作する（型は JSDoc のみ。TypeScript 構文は使わない）。
//
// ページで実行する本体（captureElement）は page/trait-capture.page.mjs にあり、ここから import して
// locator.evaluate へそのまま渡す。コピーするときは page/trait-capture.page.mjs も、コピー先の隣の page/ へ一緒にコピーする。

import { PAGE_VERSION, captureElement } from "./page/trait-capture.page.mjs";

/**
 * ツールのバージョン（原本）。採取スキーマ（FIXED_PROPERTIES・採取形状）を変えたら上げる。
 * 上げるときは、page/trait-capture.page.mjs の PAGE_VERSION も同じ値にする（違うと assertPageVersion が採らずに止める）。
 * metadata.json の traits.tool / differ に記録する「バージョン」はこの値を使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "6";

/**
 * page ファイルの PAGE_VERSION が、このスクリプトの VERSION と同じかを確かめる。違えば、片方だけを古い版のまま
 * コピーしてあるので、採らずに失敗する。
 * @param {string} pageVersion
 */
export function assertPageVersion(pageVersion) {
  if (pageVersion !== VERSION) {
    throw new Error(
      `trait capture: page/trait-capture.page.mjs has PAGE_VERSION ${pageVersion} but trait-capture.mjs has VERSION ${VERSION}; copy both files from the same version`,
    );
  }
}

/**
 * 採取する computed style プロパティの固定集合（原本）。
 * getComputedStyle が返す longhand 名で列挙する（決定論的に採れる項目のみ）。
 * @type {readonly string[]}
 */
export const FIXED_PROPERTIES = [
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "background-color",
  "border-top-width",
  "border-top-style",
  "border-top-color",
  "border-right-width",
  "border-right-style",
  "border-right-color",
  "border-bottom-width",
  "border-bottom-style",
  "border-bottom-color",
  "border-left-width",
  "border-left-style",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "text-align",
  "display",
  "visibility",
  // 以下は「要素の矩形を撮った静止画」に表れないため、画素の比較へ委ねられない
  // （上の「何を採らないか」の 4 族を参照）。
  "cursor",
  "user-select",
  "pointer-events",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "box-shadow",
  "opacity",
  "white-space",
  "overflow-x",
  "overflow-y",
  "text-overflow",
  "word-break",
];

/**
 * 文字の持ち主（text_owners）について採る computed style の固定集合（原本）。
 * 文字の見た目のうち、描いている要素の計算値でしか決まらない書体・大きさ・行の高さに絞る
 * （色や装飾は要素の矩形の内側に表れるので、画素の比較が拾う）。変えたら VERSION を上げる。
 * @type {readonly string[]}
 */
export const TEXT_OWNER_PROPERTIES = [
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
];

/**
 * スクロールする領域について採る、スクロールバーの見た目の宣言（原本）。変えたら VERSION を上げる。
 * @type {readonly string[]}
 */
export const SCROLLBAR_PROPERTIES = ["scrollbar-width", "scrollbar-color", "scrollbar-gutter"];

/**
 * スクロールする領域について計算値を採る、Chromium / WebKit のスクロールバーの擬似要素（原本）。変えたら VERSION を上げる。
 * @type {readonly string[]}
 */
export const SCROLLBAR_PSEUDOS = [
  "::-webkit-scrollbar",
  "::-webkit-scrollbar-thumb",
  "::-webkit-scrollbar-track",
  "::-webkit-scrollbar-corner",
  "::-webkit-scrollbar-button",
];

/**
 * スクロールバーの擬似要素ごとに採る computed style（原本）。幅・高さ・背景・角の丸み・枠。変えたら VERSION を上げる。
 * @type {readonly string[]}
 */
export const SCROLLBAR_PSEUDO_PROPERTIES = [
  "width",
  "height",
  "background-color",
  "background-image",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
];

/**
 * 1 要素分の採取の結果。
 * @typedef {ReturnType<typeof captureElement>} ElementTraits
 */

/**
 * 採取の結果の形か（captureElement は常にこの形を返す）。
 * @param {unknown} value
 * @returns {value is ElementTraits}
 */
function isElementTraits(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "computed" in value &&
    "before" in value &&
    "after" in value &&
    "rect" in value &&
    "child_inline_styles" in value &&
    "text_owners" in value &&
    "scroll" in value
  );
}

/**
 * 論理名付き要素の特性を採取する。呼び出し側が目的の状態へ遷移させたうえで呼ぶこと
 * （この関数は状態を遷移させない）。
 *
 * 返り値の各要素は次の形である。
 * ```js
 *   {
 *     name: string,              // 論理名
 *     computed: Record<string,string>,        // FIXED_PROPERTIES の computed 値
 *     before: Record<string,string> | null,   // ::before（content が none なら null）
 *     after:  Record<string,string> | null,   // ::after（content が none なら null）
 *     rect:   { x:number, y:number, width:number, height:number },
 *     child_inline_styles: { index:number, tag:string, style:string }[]  // 1 段下の子の inline style（診断材料）
 *     text_owners: {                   // 文字の持ち主（描画順。trait-compare.mjs が i 番目どうしを照合する）
 *       path: string,                  // el からの道筋（"" は el 自身。診断材料）
 *       tag: string,
 *       text: string,                  // その要素が直接持つ文字（空白を畳んだもの）
 *       style: Record<string,string>,  // TEXT_OWNER_PROPERTIES の computed 値
 *       advance: number,               // 文字の行の断片（Range.getClientRects）の幅の合計（照合する）
 *       glyph_height: number,          // 行の断片の高さの最大（照合する）
 *       lines: number,                 // 縦に重ならない行の帯の数（照合する。折り返しの差）
 *       rect: { x:number, y:number, width:number, height:number },  // 文字の外接矩形（診断材料）
 *     }[],
 *     scroll: {                        // スクロールする領域（overflow-x / overflow-y が visible / clip でない）でなければ null
 *       overflowing_x: boolean,        // scrollWidth > clientWidth
 *       overflowing_y: boolean,        // scrollHeight > clientHeight
 *       vertical_bar_px: number,       // 縦のスクロールバー（とガター）が取った幅（枠を除く）
 *       horizontal_bar_px: number,     // 横のスクロールバーが取った高さ（枠を除く）
 *       style: Record<string,string>,  // SCROLLBAR_PROPERTIES の computed 値
 *       webkit: Record<string, Record<string,string>> | "unsupported",  // SCROLLBAR_PSEUDOS ごとの SCROLLBAR_PSEUDO_PROPERTIES
 *     } | null
 *   }
 * ```
 *
 * 採取に失敗したエントリ（ロケータが複数要素に解決した・0 件で待ちがタイムアウトした・
 * FIXED_PROPERTIES の名前をブラウザが解決しなかった等）は、
 * どの論理名で失敗したかを付けたエラーで報告する（既採取分を警告なしに失うより、失敗箇所の特定を優先）。
 * したがって「失敗した名前だけ落として続行したい」呼び出し側（強度チェックの故障注入）は、
 * entries を 1 件ずつ渡して呼び、成功分を連結する（まとめて渡すと最初の失敗で既採取分ごと失う）。
 *
 * ただし**失敗を要素の欠落へ変換してよいのはロケータが解決しなかった場合だけ**。メッセージに
 * `computed style did not resolve` を含む失敗は FIXED_PROPERTIES の名前をそのブラウザが解決できない
 * ツール・環境側の欠陥であり、要素の欠落ではない。欠落に変換すると trait-compare が全論理名を
 * `missing`（＝赤）として出し、注入と無関係に「捕捉できた」に見える。この失敗は捕捉せず停止する。
 * `element is outside the document` も同じ扱いで、**論理名が描かれていない要素（支援技術のためのコピー）へ
 * 解決している**というマッピング側の欠陥である。欠落に変換すると、注入と無関係に赤が出るうえ、
 * コピーから採り続ける状態が残る。この失敗も捕捉せず停止し、ロケータマッピングを直してから採り直す。
 *
 * @param {{ name: string, locator: import('playwright').Locator }[]} entries
 * @returns {Promise<Array<{ name: string, computed: Record<string,string>, before: (Record<string,string>|null), after: (Record<string,string>|null), rect: { x:number, y:number, width:number, height:number }, child_inline_styles: { index:number, tag:string, style:string }[], text_owners: { path:string, tag:string, text:string, style: Record<string,string>, advance:number, glyph_height:number, lines:number, rect: { x:number, y:number, width:number, height:number } }[], scroll: ({ overflowing_x:boolean, overflowing_y:boolean, vertical_bar_px:number, horizontal_bar_px:number, style: Record<string,string>, webkit: (Record<string, Record<string,string>>|"unsupported") }|null) }>>}
 */
export async function captureTraits(entries) {
  assertPageVersion(PAGE_VERSION);
  const results = [];
  for (const entry of entries) {
    let captured;
    try {
      captured = await entry.locator.evaluate(captureElement, {
        fixed: FIXED_PROPERTIES,
        textOwner: TEXT_OWNER_PROPERTIES,
        scrollbar: SCROLLBAR_PROPERTIES,
        scrollbarPseudos: SCROLLBAR_PSEUDOS,
        scrollbarPseudoProps: SCROLLBAR_PSEUDO_PROPERTIES,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`trait capture failed for logical name "${entry.name}": ${message}`, {
        cause: err,
      });
    }
    // captureElement は常にこの形を返すので、ここで投げることは起きない（型の絞り込みのため）。
    if (!isElementTraits(captured))
      throw new Error(`trait capture returned an unexpected shape: ${entry.name}`);
    results.push({ name: entry.name, ...captured });
  }
  return results;
}
