// 論理名付き要素の特性採取（正本）。
// 正本はこのスキル側にあり、実行時はプロジェクトの
// `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使う（配布スキルの成果物同梱規約）。
// コピー先はコピー専用のサブディレクトリで、プロジェクト自作ツールと同居させない（修正しない規約のため）。
// このファイルのスキーマ（FIXED_PROPERTIES・採取形状）を変えたら、成果物の
// `metadata.json` の `traits.property_set` も必ず更新する（parity-diff は property_set を正とする）。
//
// 何を採るか: 論理名（ロケータマッピングの契約名）を付けた要素について、
// 固定プロパティ集合の computed style ＋ 擬似要素（::before / ::after）の computed style ＋
// getBoundingClientRect() を採る。相対幾何（要素対の関係）は絶対座標ではなく
// この rect から trait-compare.mjs 側で導出する。
//
// 何を採らないか: box-shadow・opacity・letter-spacing 等はこの集合に含めない（名前無し要素の見た目差と
// 同様、画素経路＝スクリーンショット側に委ねる）。プロパティを足すときは、決定論的に採れ
// （乱数・時刻・アニメーションに依存せず）、両実装で意味が保たれる項目に限る。
//
// 画素経路へ委ねられるのは「静止画に写る」プロパティだけ。写らないものを外すと、特性照合でも
// 画素比較でも差が出ない＝どちらの経路にも現れない見た目になる（cursor の写し忘れが 12 状態 ×
// 2 ロケールの照合と画素比較を全部緑で通り抜け、利用者が触って気づいた実例がある）。
// 操作したときの手応えを決めるが静止画には出ない項目（cursor / user-select / pointer-events）は、
// 委ねる先が無いのでこの集合に入れる。足す候補を検討するときは「決定論的か」「両実装で意味が
// 保たれるか」に加えて「外したとき画素経路が拾えるか」を必ず問う。
//
// 状態遷移（hover / focus / active / disabled 等）はこの関数の責務ではない。呼び出し側
// （スイート）が状態へ遷移させたうえで captureTraits を呼ぶ。この関数は「今の状態」を採るだけ。
//
// Playwright はピア前提であり import しない。Locator は引数で受け取り、
// locator.evaluate() 経由でブラウザ内 DOM を操作する（型は JSDoc のみ。TypeScript 構文は使わない）。

/**
 * ツールのバージョン（正本）。採取スキーマ（FIXED_PROPERTIES・採取形状）を変えたら上げる。
 * metadata.json の traits.tool / differ に記録する「バージョン」はこの値を使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "2";

/**
 * 採取する computed style プロパティの固定集合（正本）。
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
  // 以下は静止画に写らないため画素経路へ委ねられない（上の「何を採らないか」を参照）。
  "cursor",
  "user-select",
  "pointer-events",
];

/**
 * ブラウザ内で 1 要素分の特性を採る純関数（locator.evaluate に渡す）。
 * el と props を受け取り、computed / before / after / rect を返す。
 * 擬似要素は content が "none"（＝生成コンテンツ無し）のとき null を返し、省略できるようにする。
 * この関数は文字列化して evaluate に渡るため、外部スコープを参照しない（props で受け取る）。
 * @param {Element} el
 * @param {readonly string[]} props
 */
function captureElement(el, props) {
  const pick = (pseudo) => {
    const style = getComputedStyle(el, pseudo);
    if (pseudo && style.content === "none") return null;
    const out = {};
    const unknown = [];
    for (const prop of props) {
      const value = style.getPropertyValue(prop);
      // getPropertyValue はブラウザが知らないプロパティ名に空文字を返す。空のまま採ると
      // 現・新の両側が同じ空文字になり「差が無い」と読めてしまう（集合に入れた意味が消える）。
      // 検出できないことを黙って通さず、どの名前が解決しなかったかを付けて落とす。
      if (value === "") unknown.push(prop);
      out[prop] = value;
    }
    if (unknown.length > 0) {
      throw new Error(
        `computed style did not resolve${pseudo ? ` for ${pseudo}` : ""}: ${unknown.join(", ")}`,
      );
    }
    return out;
  };
  const box = el.getBoundingClientRect();
  return {
    computed: pick(null),
    before: pick("::before"),
    after: pick("::after"),
    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
}

/**
 * 論理名付き要素の特性を採取する。呼び出し側が目的の状態へ遷移させたうえで呼ぶこと
 * （この関数は状態遷移を行わない）。
 *
 * 返り値の各要素:
 *   {
 *     name: string,              // 論理名（ロケータマッピングの契約名）
 *     computed: Record<string,string>,        // FIXED_PROPERTIES の computed 値
 *     before: Record<string,string> | null,   // ::before（content が none なら null）
 *     after:  Record<string,string> | null,   // ::after（content が none なら null）
 *     rect:   { x:number, y:number, width:number, height:number }
 *   }
 *
 * 採取に失敗したエントリ（ロケータが複数要素に解決した・0 件で待ちがタイムアウトした・
 * FIXED_PROPERTIES の名前をブラウザが解決しなかった等）は、
 * どの論理名で失敗したかを付けたエラーで報告する（既採取分を黙って失うより、失敗箇所の特定を優先）。
 * したがって「失敗した名前だけ落として続行したい」呼び出し側（強度ゲートの故障注入）は、
 * entries を 1 件ずつ渡して呼び、成功分を連結する（まとめて渡すと最初の失敗で既採取分ごと失う）。
 *
 * ただし**失敗を要素の欠落へ変換してよいのはロケータが解決しなかった場合だけ**。メッセージに
 * `computed style did not resolve` を含む失敗は FIXED_PROPERTIES の名前をそのブラウザが解決できない
 * ツール・環境側の欠陥であり、要素の欠落ではない。欠落に変換すると trait-compare が全論理名を
 * `missing`（＝赤）として出し、注入と無関係に「捕捉できた」に見える。この失敗は捕捉せず停止する。
 *
 * @param {{ name: string, locator: import('playwright').Locator }[]} entries
 * @returns {Promise<Array<{ name: string, computed: Record<string,string>, before: (Record<string,string>|null), after: (Record<string,string>|null), rect: { x:number, y:number, width:number, height:number } }>>}
 */
export async function captureTraits(entries) {
  const results = [];
  for (const entry of entries) {
    let captured;
    try {
      captured = await entry.locator.evaluate(captureElement, FIXED_PROPERTIES);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`trait capture failed for logical name "${entry.name}": ${message}`, {
        cause: err,
      });
    }
    results.push({ name: entry.name, ...captured });
  }
  return results;
}
