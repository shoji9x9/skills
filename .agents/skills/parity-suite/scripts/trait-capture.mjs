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
//     （下記 captureElement。getBoundingClientRect() は相対幾何のために既に読んでいる）。
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
// オリジンの url() だけを畳んで比較可能にしている（下記 foldOrigin）。url() を持ちうる項目を
// 足すときは、この正規化で両側が揃うかを確かめる。
//
// 状態遷移（hover / focus / active / disabled 等）はこの関数の責務ではない。呼び出し側
// （スイート）が状態へ遷移させたうえで captureTraits を呼ぶ。この関数は「今の状態」を採るだけ。
//
// Playwright はピア前提であり import しない。Locator は引数で受け取り、
// locator.evaluate() 経由でブラウザ内 DOM を操作する（型は JSDoc のみ。TypeScript 構文は使わない）。

/**
 * ツールのバージョン（原本）。採取スキーマ（FIXED_PROPERTIES・採取形状）を変えたら上げる。
 * metadata.json の traits.tool / differ に記録する「バージョン」はこの値を使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "6";

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

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */
/** @typedef {{ top: number, bottom: number }} LineBand */
/** @typedef {{ full: number, lead: number, trail: number, blank: boolean }} TextSegment */
/**
 * @typedef {{ path: string, tag: string, text: string, style: Record<string, string>, advance: number, glyph_height: number, lines: number, rect: Rect }} TextOwner
 */

/**
 * ページへ渡す採取の設定（captureTraits が組み立てる）。
 * @typedef {{ fixed: readonly string[], textOwner: readonly string[], scrollbar: readonly string[], scrollbarPseudos: readonly string[], scrollbarPseudoProps: readonly string[] }} CaptureProps
 */

/**
 * 文字の持ち主を集める間の状態。1 要素の採取ごとに作る。
 * @typedef {object} TextState
 * @property {Element} el  - 採取する要素
 * @property {readonly string[]} textOwnerProps  - 持ち主ごとに採る計算値（TEXT_OWNER_PROPERTIES）
 * @property {Map<Element, TextOwner>} owners  - 持ち主の要素から行への索引
 * @property {TextOwner[]} textOwners  - 文字が現れた順の行
 * @property {Map<TextOwner, string>} rawText  - 持ち主ごとの生の文字列
 * @property {Map<TextOwner, LineBand[]>} bands  - 持ち主ごとの行の断片（縦の範囲）
 * @property {Map<TextOwner, TextSegment[]>} segments  - 持ち主ごとの文字の区切り
 * @property {CanvasRenderingContext2D | null} canvas  - ボタンとして描く <input> の文字を測る canvas
 */

/**
 * 持ち主へ足す 1 つ分の文字。r は外接矩形（診断材料）、fragments は行の断片（寸法の照合に使う）。
 * @typedef {{ owner: Element, path: string, raw: string, r: Rect, fragments: Rect[], segment: TextSegment }} TextPiece
 */

// ここから captureElement までの関数は、ページ側で実行される。
// locator.evaluate は渡した関数を文字列にしてページで実行するので、ページ側の関数はモジュールの名前を参照できない。
// そのため、ページ側の関数（PAGE_HELPERS に並べたもの）は引数と素のグローバル（getComputedStyle・location・document など）だけを読み、
// 互いを引数の一覧（`h`）を通して呼ぶ。captureTraits は、本体の captureElement と PAGE_HELPERS の関数のソースを
// new Function で 1 つの関数に組み立て、その関数を evaluate へ渡す（下記 getPageFunction）。
// Node から直接呼ぶ captureElementTraits は、組み立てずに同じ関数の一覧を渡す。

// 値が在ることを確かめる。採取の中で対にして作る値（持ち主ごとの区切りなど）と、必ず一致する正規表現の結果に使う。
// 無ければ、その値を読む行が TypeError で止まるのと同じく、ここで止める。
/**
 * @template T
 * @param {T | null | undefined} value
 * @returns {T}
 */
function present(value) {
  if (value === null || value === undefined) throw new TypeError("captureElement: missing value");
  return value;
}

/**
 * @param {Node} node
 * @returns {node is Element}
 */
function isElementNode(node) {
  return node.nodeType === 1;
}

// 同一オリジンの url() をオリジン非依存の印へ畳む。cursor: url(cur.png) のような相対 URL の
// 計算値は自分のオリジンで絶対化されるため（実測: 同じ CSS が :8811 と :8822 で別文字列になる）、
// 現・新がホストもポートも違う前提のパリティ比較では、同じ指定が偽の property 差分になる。
// 畳むのは自分のオリジンで始まる URL だけ。data: と他オリジンの URL は両側で同じ文字列に
// なるので触らない（畳むと別ホストの資産どうしが同一視され、本物の差分を消す）。
// 正規化できないとき（file:// 等で origin が "null"）は元の値のまま残す。偽の差分として
// 目に見える側として扱い、警告なしに一致させない。
//
// 置換は url() トークンの中身を取り出し、その URL 自体が自オリジンで始まるときだけ行う。
// 値全体への単純置換にすると、他オリジン URL のパス・クエリにたまたま自オリジンが現れた値
// （url("https://cdn.example/redirect/http://legacy.example:8811/x") 等）まで畳んで、
// 現・新で別物を指している外部参照を同値化し、本物の差分を消す。
//
// 射程: 畳むのは URL 文字列までで、参照先の資産の中身は照合しない。現新が同じパスで
// 別バイトの資産を配信していると、その見た目差は、この正規化にも画素にも現れない。
// 対象要素がある機能は gaps.md へ「採取値の射程外」として残す（確認済みにしない）。
/** @param {string} value */
function foldOrigin(value) {
  const origin = location.origin;
  const foldable = /^https?:\/\//.test(origin);
  if (!foldable || !value.includes("url(")) return value;
  return value.replace(/url\(\s*("[^"]*"|'[^']*'|[^)]*)\s*\)/g, (whole, raw) => {
    const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : "";
    const url = quote ? raw.slice(1, -1) : raw.trim();
    if (url !== origin && !url.startsWith(origin + "/")) return whole;
    return `url(${quote}<same-origin>${url.slice(origin.length)}${quote})`;
  });
}

/**
 * @overload
 * @param {PageHelpers} h
 * @param {Element} el
 * @param {{ pseudo: "::before" | "::after", names: readonly string[] }} request
 * @returns {Record<string, string> | null}
 */
/**
 * @overload
 * @param {PageHelpers} h
 * @param {Element} el
 * @param {{ pseudo: string | null, names: readonly string[] }} request
 * @returns {Record<string, string>}
 */
/**
 * 要素（pseudo を渡せばその擬似要素）の計算値のうち、names の値を採る。
 * @param {PageHelpers} h
 * @param {Element} el
 * @param {{ pseudo: string | null, names: readonly string[] }} request
 * @returns {Record<string, string> | null}
 */
function pick(h, el, { pseudo, names }) {
  const style = getComputedStyle(el, pseudo);
  // 生成コンテンツの有無で省けるのは ::before / ::after だけ（スクロールバーの擬似要素は content を持たない）
  if ((pseudo === "::before" || pseudo === "::after") && style.content === "none") return null;
  /** @type {Record<string, string>} */
  const out = {};
  const unknown = [];
  for (const prop of names) {
    const value = style.getPropertyValue(prop);
    // getPropertyValue はブラウザが知らないプロパティ名に空文字を返す。空のまま採ると
    // 現・新の両側が同じ空文字になり「差が無い」と読めてしまう（集合に入れた意味が消える）。
    // 検出できないことを警告なしに通さず、どの名前が解決しなかったかを付けて落とす。
    if (value === "") unknown.push(prop);
    out[prop] = h.foldOrigin(value);
  }
  if (unknown.length > 0) {
    throw new Error(
      `computed style did not resolve${pseudo ? ` for ${pseudo}` : ""}: ${unknown.join(", ")}`,
    );
  }
  return out;
}

// 描かれているかの判定は、ビューポートではなく**文書**の矩形に対して行う。ビューポートで測ると
// 折り返し下の要素（full_page 撮影では正当に撮影される）やスクロールで外へ出た要素まで落ちる。
// 文書座標へ直したうえで「文書の外側に丸ごと出ている」ものだけを失敗にする。
// 支援技術のためのコピーは y = -32000 のような座標に置かれるので、この判定で捕まる。
// 面積 0 の矩形（display: none 等）はこの判定から外す。描かれていないのは同じだが、
// 状態として正当に採る対象であり、コピーの合図ではない。
// 射程: この除外のぶん、width: 0; height: 0 で置かれたコピーは検出できない（捕まえるのは
// 文書の外へ動かしたコピーだけ）。限界は references/baseline.md に書いてある。
// なお内側にスクロール領域を持つ部品（横スクロールするデータグリッド等）では、正当な要素でも
// スクロール領域の外へ出た位置に矩形が出て文書の外と判定されうる。コピーとは原因が違うので、失敗メッセージには
// どちらの可能性も出す（採り直す前に対象をスクロール領域の中へスクロールさせる）。
/** @param {DOMRect} box */
function assertInsideDocument(box) {
  if (!(box.width > 0 && box.height > 0)) return;
  // 参照はすべて素のグローバル（scrollX / innerWidth / document）で書く。ブラウザでは window と
  // 同じものを指し、locator.evaluate へ文字列化して渡るこの関数を差し替え無しで単体検査できる。
  //
  // ビューポートに掛かっている要素は、文書座標を見るまでもなく描かれている。先に通すのは
  // RTL の横スクロール文書で `scrollX` が負になり、見えている矩形でも
  // `docX + width <= 0` が成り立ちうるため（例: rect.x=10 / width=50 / scrollX=-100）。
  const intersectsViewport =
    box.x < innerWidth && box.x + box.width > 0 && box.y < innerHeight && box.y + box.height > 0;
  const docX = box.x + scrollX;
  const docY = box.y + scrollY;
  const docWidth = Math.max(document.documentElement.scrollWidth, innerWidth);
  const docHeight = Math.max(document.documentElement.scrollHeight, innerHeight);
  const outsideDocument =
    docX + box.width <= 0 || docY + box.height <= 0 || docX >= docWidth || docY >= docHeight;
  if (!intersectsViewport && outsideDocument) {
    throw new Error(
      `element is outside the document: rect=(${box.x}, ${box.y}, ${box.width}, ${box.height}) ` +
        `scroll=(${scrollX}, ${scrollY}) document=(${docWidth}, ${docHeight}). ` +
        `the logical name likely resolves to an off-screen copy (accessibility mirror), not the drawn element; ` +
        `if the element instead sits in an inner scroll container, scroll it into view before capturing`,
    );
  }
}

// 1 段下の子の inline style だけを読む（孫は見ない・子の計算値も採らない）。
// 「子に inline style がある」ことが記録に残れば、名前を付けた要素の計算値が全一致のまま
// 画素だけ差が出たときに、装飾がどこに乗っているかを採取物から読める。
/** @param {Element} el */
function childInlineStyles(el) {
  const styles = [];
  for (let i = 0; i < el.children.length; i += 1) {
    const child = el.children[i];
    const inline = child.getAttribute("style");
    if (inline === null || inline.trim() === "") continue;
    styles.push({
      index: i,
      tag: child.tagName.toLowerCase(),
      style: inline.trim(),
    });
  }
  return styles;
}

// 畳む・端から外す空白は、CSS が畳む空白（スペース・タブ・改行・CR・FF）だけにする。
// JavaScript の \s と trim は NBSP や全角スペースも空白とみなすが、CSS はそれらを幅を持つ文字として描く。
// \s で扱うと、全角スペースで字下げした「\u3000設定」が「設定」と同じ文字列になり、字下げの幅まで差し引かれて、
// 字下げの無い文字と区別できなくなる。別の文字列として残せば寸法は比べないが、字下げは画素の比較に表れる。
/** @param {string} value */
function collapse(value) {
  return value.replace(/[ \t\n\r\f]+/g, " ").replace(/^ | $/g, "");
}

// 持ち主ごとの行の断片（縦の範囲）から行の数を出す。行の数は断片の数ではなく、行の帯の数で数える。
// テキストノードが分かれると同じ行に断片が 2 つ出る（実測: "3" と "件" の 2 ノードで断片 2、1 ノードで 1）。
// 帯の切れ目は「前の帯の上端から、その断片の高さの半分以上下がったか」で決める。断片の高さは行送りではなく
// 書体の高さなので、line-height を詰めると上下の行の断片が縦に重なり、重なりで数えると折り返しを 1 行と
// 数える（実測: 16px・3 行の折り返しが line-height: 1 / 0.8 で 1 行になった）。同じ行の断片は上端が揃う。
/** @param {LineBand[]} list */
function countLines(list) {
  let lines = 0;
  let rowTop = -Infinity;
  for (const f of [...list].sort((a, b) => a.top - b.top)) {
    if (f.top >= rowTop + (f.bottom - f.top) / 2) {
      lines += 1;
      rowTop = f.top;
    }
  }
  return lines;
}

// 持ち主ごとの文字の区切り（テキストノード 1 つ分）から、幅の合計 advance を出す。全区切りの幅から、持ち主の
// 先頭と末尾の空白の幅だけを差し引く。文字列は空白を畳んで trim して比べるので、端の空白の幅を
// 残すと、境目の空白がどちらの持ち主に付くかだけで幅が変わる（実測: <p>合計 <b>3件</b></p> と
// <p>合計<b> 3件</b></p> で p と b の幅が 4.45px ずつ入れ替わった）。中の空白は幅に数える
// （空白だけのノードも。数えないと "合計" " " "3" の 3 ノードが 1 ノードより 4.4px 狭くなった）。
/** @param {TextSegment[]} list */
function edgeTrimmedAdvance(list) {
  let total = list.reduce((sum, seg) => sum + seg.full, 0);
  /** @type {Array<[TextSegment[], "lead" | "trail"]>} */
  const ends = [
    [list, "lead"],
    [[...list].reverse(), "trail"],
  ];
  for (const [order, side] of ends) {
    for (const seg of order) {
      if (seg.blank) {
        total -= seg.full;
        continue;
      }
      total -= seg[side];
      break;
    }
  }
  return total;
}

/**
 * テキストノードの start から end までの文字の幅（行の断片の幅の合計）。
 * @param {Element} el
 * @param {Node} node
 * @param {{ start: number, end: number }} span
 */
function widthOf(el, node, { start, end }) {
  if (start >= end) return 0;
  const sub = (el.ownerDocument || document).createRange();
  sub.setStart(node, start);
  sub.setEnd(node, end);
  return Array.from(sub.getClientRects()).reduce((sum, f) => sum + f.width, 0);
}

/**
 * テキストノード 1 つを、平坦木の親（flatParent）の文字として足す。
 * @param {PageHelpers} h
 * @param {TextState} st
 * @param {{ node: Node, path: string, flatParent: Element }} at
 */
function collectText(h, st, { node, path, flatParent }) {
  const raw = node.nodeValue || "";
  if (h.collapse(raw) === "") {
    // 空白だけのノードは持ち主を新しく作らないが、既に文字を持つ持ち主の中の空白は文字列と幅に残す
    const known = st.owners.get(flatParent);
    if (known) {
      st.rawText.set(known, st.rawText.get(known) + raw);
      const full = h.widthOf(st.el, node, { start: 0, end: raw.length });
      h.present(st.segments.get(known)).push({ full, lead: full, trail: full, blank: true });
    }
    return;
  }
  // 持ち主は平坦木の親（visit が渡す）。文字の書体は平坦木で継承されるため、<slot> に割り当てられた
  // 文字は DOM の親（ホスト）ではなく slot から継承する（実測: シャドウ内の <button style="font-size:30px">
  // <slot> に割り当てた文字を parentElement で採るとホストの 16px が記録された）。シャドウルート直下の
  // 文字はホストが持ち主になる（ShadowRoot は要素ではなく計算値を持たない）。
  const range = (st.el.ownerDocument || document).createRange();
  range.selectNodeContents(node);
  const r = range.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return;
  // 比較に使う寸法は行の断片（getClientRects）から出す。外接矩形（`r`）は、折り返すと「1 行目の左端〜
  // 最終行の右端」まで広がり、同じ持ち主の文字どうしを合わせると間に挟まる子要素の領域まで覆うため、
  // 書体と無関係な寸法の差を出す（外接矩形は診断材料として rect に残すだけ）。
  const fragments = Array.from(range.getClientRects()).filter((f) => f.width > 0 && f.height > 0);
  const leadLength = h.present(/^[ \t\n\r\f]*/.exec(raw))[0].length;
  const trailLength = h.present(/[ \t\n\r\f]*$/.exec(raw))[0].length;
  const segment = {
    full: fragments.reduce((sum, f) => sum + f.width, 0),
    lead: h.widthOf(st.el, node, { start: 0, end: leadLength }),
    trail: h.widthOf(st.el, node, { start: raw.length - trailLength, end: raw.length }),
    blank: false,
  };
  h.record(h, st, { owner: flatParent, path, raw, r, fragments, segment });
}

/**
 * @param {ParentNode} parent
 * @returns {parent is ShadowRoot}
 */
function isShadowRoot(parent) {
  return "host" in parent;
}

// 文字の矩形が、el までの祖先の切り抜き（overflow が visible でない箱・clip: rect(0 0 0 0)）で
// 実質的に見えなくなっているか。視覚的に隠した文字は、矩形の面積も visibility も通常の文字と同じである
// （sr-only は 1px の箱に overflow: hidden で閉じ込め、text-indent: -9999px は箱の外へ逃がす）。そのため、
// 切り抜いた後の幅か高さが 2px 未満なら描かれていないとみなす（実測: sr-only の「閉じる」は
// 切り抜き後 1×1）。省略記号で切られた長い文字は大きく残るので数え続ける。
/**
 * @param {PageHelpers} h
 * @param {Element} el
 * @param {{ owner: Element, r: Rect }} text
 */
function clippedAway(h, el, { owner, r }) {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.width;
  let bottom = r.y + r.height;
  /** @type {Element | null} */
  let node = owner;
  while (node) {
    const style = getComputedStyle(node);
    if (style.getPropertyValue("clip") === "rect(0px, 0px, 0px, 0px)") return true;
    if (
      style.getPropertyValue("overflow-x") !== "visible" ||
      style.getPropertyValue("overflow-y") !== "visible"
    ) {
      const b = node.getBoundingClientRect();
      left = Math.max(left, b.x);
      top = Math.max(top, b.y);
      right = Math.min(right, b.x + b.width);
      bottom = Math.min(bottom, b.y + b.height);
    }
    if (node === el) break;
    node =
      node.parentElement ||
      (node.parentNode && h.isShadowRoot(node.parentNode) ? node.parentNode.host : undefined) ||
      null;
  }
  return right - left < 2 || bottom - top < 2;
}

/**
 * 持ち主へ 1 つ分の文字を足す。描かれていない文字（visibility が visible でない・祖先の切り抜きで実質見えない）は数えない。
 * @param {PageHelpers} h
 * @param {TextState} st
 * @param {TextPiece} piece
 */
function record(h, st, piece) {
  const { owner, r } = piece;
  const glyphHeight = piece.fragments.reduce((max, f) => Math.max(max, f.height), 0);
  const style = getComputedStyle(owner);
  if (style.getPropertyValue("visibility") !== "visible") return;
  if (h.clippedAway(h, st.el, { owner, r })) return;
  const known = st.owners.get(owner);
  if (known) {
    h.appendToOwner(h, st, { known, piece, glyphHeight });
    return;
  }
  h.addOwner(st, piece, { style, glyphHeight });
}

/**
 * 既にある持ち主の行へ、文字・区切り・行の断片を足し、外接矩形を広げる。
 * @param {PageHelpers} h
 * @param {TextState} st
 * @param {{ known: TextOwner, piece: TextPiece, glyphHeight: number }} merge
 */
function appendToOwner(h, st, { known, piece, glyphHeight }) {
  const { raw, r, fragments, segment } = piece;
  st.rawText.set(known, st.rawText.get(known) + raw);
  h.present(st.segments.get(known)).push(segment);
  known.glyph_height = Math.max(known.glyph_height, glyphHeight);
  for (const f of fragments)
    h.present(st.bands.get(known)).push({ top: f.y, bottom: f.y + f.height });
  const x2 = Math.max(known.rect.x + known.rect.width, r.x + r.width);
  const y2 = Math.max(known.rect.y + known.rect.height, r.y + r.height);
  known.rect.x = Math.min(known.rect.x, r.x);
  known.rect.y = Math.min(known.rect.y, r.y);
  known.rect.width = x2 - known.rect.x;
  known.rect.height = y2 - known.rect.y;
}

/**
 * 新しい持ち主の行を作り、TEXT_OWNER_PROPERTIES の計算値を採る。
 * @param {TextState} st
 * @param {TextPiece} piece
 * @param {{ style: CSSStyleDeclaration, glyphHeight: number }} drawn
 */
function addOwner(st, { owner, path, raw, r, fragments, segment }, { style, glyphHeight }) {
  /** @type {Record<string, string>} */
  const picked = {};
  const unknown = [];
  for (const prop of st.textOwnerProps) {
    const value = style.getPropertyValue(prop);
    if (value === "") unknown.push(prop);
    picked[prop] = value;
  }
  if (unknown.length > 0) {
    throw new Error(
      `computed style did not resolve for text owner "${path}": ${unknown.join(", ")}`,
    );
  }
  const entry = {
    path,
    tag: owner.tagName.toLowerCase(),
    text: "",
    style: picked,
    advance: 0,
    glyph_height: glyphHeight,
    lines: 0,
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
  };
  st.owners.set(owner, entry);
  st.rawText.set(entry, raw);
  st.segments.set(entry, [segment]);
  st.bands.set(
    entry,
    fragments.map((f) => ({ top: f.y, bottom: f.y + f.height })),
  );
  st.textOwners.push(entry);
}

/**
 * 平坦木の順にノードを辿り、文字を持ち主へ足す。
 * @param {PageHelpers} h
 * @param {TextState} st
 * @param {{ nodes: Iterable<Node, unknown, unknown>, path: string, flatParent: Element }} at
 */
function visit(h, st, { nodes, path, flatParent }) {
  let elementIndex = 0;
  for (const node of nodes) {
    if (node.nodeType === 3) {
      h.collectText(h, st, { node, path, flatParent });
      continue;
    }
    if (!h.isElementNode(node)) continue;
    const segment = `${node.tagName.toLowerCase()}[${elementIndex}]`;
    elementIndex += 1;
    const childPath = path === "" ? segment : `${path}>${segment}`;
    if (h.isButtonInput(h, node)) h.collectInputValue(h, st, { node, path: childPath });
    if (node.shadowRoot) {
      // シャドウツリーが描かれ、ライト DOM の子は <slot> 経由でその位置に描かれる
      const shadowNodes = Array.from(node.shadowRoot.childNodes);
      h.visit(h, st, { nodes: shadowNodes, path: `${childPath}>#shadow-root`, flatParent: node });
    } else if (h.isSlot(node) && node.assignedNodes().length > 0) {
      h.visit(h, st, { nodes: node.assignedNodes(), path: childPath, flatParent: node });
    } else {
      h.visit(h, st, { nodes: Array.from(node.childNodes), path: childPath, flatParent: node });
    }
  }
}

// ボタンとして描かれる <input>（submit / button / reset）は value の文字をテキストノードを持たずに描く。
// 数えないと <input type=submit value="検索"> を <button>検索</button> へ置き換えた組で、見た目が同じでも
// 件数の差（text[0] の absent / present）が出る。Range で測れないので、同じ書体を canvas の measureText に
// 当てて行の断片を 1 つ作る（実測: 同じ書体の <button> の Range と幅・高さが一致した）。
/**
 * @param {PageHelpers} h
 * @param {Node} node
 * @returns {node is HTMLInputElement & { readonly __isButtonInput: true }}
 */
function isButtonInput(h, node) {
  return (
    h.isElementNode(node) &&
    node.tagName === "INPUT" &&
    "type" in node &&
    ["submit", "button", "reset"].includes(String(node.type).toLowerCase())
  );
}

/**
 * @param {Element} node
 * @returns {node is HTMLSlotElement}
 */
function isSlot(node) {
  return "assignedNodes" in node && typeof node.assignedNodes === "function";
}

// text-transform の計算値を文字列に当てる（canvas は text-transform を当てないので、測る前に描く側と同じ形へ寄せる）
/**
 * @param {string} raw
 * @param {string} transform  - text-transform の計算値
 */
function transformText(raw, transform) {
  if (transform === "uppercase") return raw.toUpperCase();
  if (transform === "lowercase") return raw.toLowerCase();
  if (transform === "capitalize")
    return raw.replace(/(^|\s)(\S)/g, (_all, space, first) => space + first.toUpperCase());
  return raw;
}

// value 属性の無い submit / reset はブラウザが既定の文言（「送信」等）を描くが、その文言は DOM から
// 読めない。数えないと <button>送信</button> への置き換えで件数の差が出るので、文字列を空にした行として
// 数える（書体は照合し、文字列が合わないので寸法は照合されない）。
/**
 * @param {PageHelpers} h
 * @param {TextState} st
 * @param {{ node: HTMLInputElement, path: string }} input
 */
function collectInputValue(h, st, { node, path }) {
  const type = String(node.type).toLowerCase();
  const defaultLabel = type !== "button" && !node.hasAttribute("value");
  const raw = String(node.value || "");
  if (h.collapse(raw) === "" && !defaultLabel) return;
  const box = node.getBoundingClientRect();
  if (!(box.width > 0 && box.height > 0)) return;
  const style = getComputedStyle(node);
  st.canvas =
    st.canvas ||
    h.present((st.el.ownerDocument || document).createElement("canvas").getContext("2d"));
  const canvas = st.canvas;
  canvas.font = ["font-style", "font-weight", "font-size", "font-family"]
    .map((prop) => style.getPropertyValue(prop))
    .join(" ");
  // canvas は text-transform と letter-spacing を当てないので、描く側と同じ形へ寄せてから測る
  // （実測: uppercase・0.05em で input 48.0px、button 71.5px だった）
  const shown = h.transformText(raw, style.getPropertyValue("text-transform"));
  const spacing = style.getPropertyValue("letter-spacing");
  canvas.letterSpacing = spacing === "normal" ? "0px" : spacing;
  const m = canvas.measureText(shown);
  const height = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
  const fragment = { x: box.x, y: box.y, width: m.width, height };
  const segment = { full: m.width, lead: 0, trail: 0, blank: false };
  const rect = { x: box.x, y: box.y, width: box.width, height: box.height };
  h.record(h, st, { owner: node, path, raw, r: rect, fragments: [fragment], segment });
}

// 文字の持ち主を平坦木の順に拾う（冒頭の「文字の持ち主」を参照）。path は el からの道筋で、
// 照合には使わない診断材料（どの要素が文字を持っているかを採取物から読むため）。
// 持ち主ごとの生の文字列（rawText）の空白の畳み込みと trim は、全ノードを繋いだ後に 1 回だけ当てる。
// ノードごとに trim して " " で繋ぐと、フレームワークがテキストを分けたかどうかで文字列が変わる
// （React の <span>{count}件</span> は "3" と "件" の 2 ノードで "3 件"、1 ノードなら "3件"）。
// すると、見た目が同じ文字の寸法の照合が、trait-compare.mjs で警告なしに省かれる。
/**
 * @param {PageHelpers} h
 * @param {Element} el
 * @param {readonly string[]} textOwnerProps
 * @returns {TextOwner[]}
 */
function captureTextOwners(h, el, textOwnerProps) {
  /** @type {TextState} */
  const st = {
    el,
    textOwnerProps,
    owners: new Map(),
    textOwners: [],
    rawText: new Map(),
    bands: new Map(),
    segments: new Map(),
    canvas: null,
  };
  if (h.isButtonInput(h, el)) h.collectInputValue(h, st, { node: el, path: "" });
  h.visit(h, st, {
    nodes: el.shadowRoot ? Array.from(el.shadowRoot.childNodes) : Array.from(el.childNodes || []),
    path: el.shadowRoot ? "#shadow-root" : "",
    flatParent: el,
  });
  for (const entry of st.textOwners) {
    entry.text = h.collapse(h.present(st.rawText.get(entry)));
    entry.advance = h.edgeTrimmedAdvance(h.present(st.segments.get(entry)));
    entry.lines = h.countLines(h.present(st.bands.get(entry)));
  }
  return st.textOwners;
}

/** @param {string} value */
function clipsNothing(value) {
  return value === "visible" || value === "clip";
}

/**
 * @param {Element} element
 * @returns {element is HTMLElement}
 */
function hasOffsetBox(element) {
  return "offsetWidth" in element && typeof element.offsetWidth === "number";
}

// スクロールする領域の特性（冒頭の「スクロールする領域」を参照）。offsetWidth を持たない要素（SVG 等）は
// スクロール領域の寸法を読めないので null にする（スクロール領域かどうかの差は overflow-x / overflow-y の差として固定集合に出る）。
// display: inline の要素には overflow が機能せず、clientWidth / clientHeight が 0 になる。
// すると offsetWidth − clientWidth が文字の幅そのものになってしまう（実測: overflow: hidden の <a> で 122px / 17px）。
// そのため、スクロール領域として扱わない。
/**
 * @param {PageHelpers} h
 * @param {Element} el
 * @param {CaptureProps} props
 */
function captureScroll(h, el, props) {
  const elementStyle = getComputedStyle(el);
  const scrollArea =
    h.hasOffsetBox(el) &&
    elementStyle.getPropertyValue("display") !== "inline" &&
    !(
      h.clipsNothing(elementStyle.getPropertyValue("overflow-x")) &&
      h.clipsNothing(elementStyle.getPropertyValue("overflow-y"))
    );
  if (!scrollArea) return null;
  /** @param {string} side */
  const border = (side) => parseFloat(elementStyle.getPropertyValue(`border-${side}-width`)) || 0;
  return {
    overflowing_x: el.scrollWidth > el.clientWidth,
    overflowing_y: el.scrollHeight > el.clientHeight,
    // 縦のスクロールバー（とガター）が取った幅・横のスクロールバーが取った高さ。枠を差し引く
    // （実測: 枠 2px・overflow: auto のスクロール領域で offsetWidth 204 / clientWidth 185 → 15px）
    vertical_bar_px: Math.round(el.offsetWidth - el.clientWidth - border("left") - border("right")),
    horizontal_bar_px: Math.round(
      el.offsetHeight - el.clientHeight - border("top") - border("bottom"),
    ),
    ...h.scrollbarStyles(h, el, props),
  };
}

/**
 * スクロールバーの見た目の宣言と、::-webkit-scrollbar 系の計算値を採る。
 * @param {PageHelpers} h
 * @param {Element} el
 * @param {CaptureProps} props
 */
function scrollbarStyles(h, el, props) {
  // ::-webkit-scrollbar を持たないブラウザでは擬似要素の計算値が見た目を表さないので、読まずに印を残す
  const webkitSupported =
    typeof CSS !== "undefined" && CSS.supports("selector(::-webkit-scrollbar)");
  /** @type {Record<string, Record<string, string>>} */
  const webkitStyles = {};
  /** @type {Record<string, Record<string, string>> | "unsupported"} */
  const webkit = webkitSupported ? webkitStyles : "unsupported";
  if (webkitSupported) {
    for (const pseudo of props.scrollbarPseudos)
      webkitStyles[pseudo] = h.pick(h, el, { pseudo, names: props.scrollbarPseudoProps });
  }
  return { style: h.pick(h, el, { pseudo: null, names: props.scrollbar }), webkit };
}

/**
 * ブラウザ内で 1 要素分の特性を採る（locator.evaluate に渡す関数の本体）。
 * el と props を受け取り、computed / before / after / rect / child_inline_styles / text_owners / scroll を返す。
 * 擬似要素は content が "none"（＝生成コンテンツ無し）のとき null を返し、省略できるようにする。
 * 矩形が文書の外に丸ごと出ている要素（支援技術のためのコピー）はここで失敗させる。
 * @param {PageHelpers} h ページ側の関数の一覧（PAGE_HELPERS）。
 * @param {Element} el
 * @param {CaptureProps} props
 */
function captureElement(h, el, props) {
  const box = el.getBoundingClientRect();
  h.assertInsideDocument(box);
  const childStyles = h.childInlineStyles(el);
  const textOwners = h.captureTextOwners(h, el, props.textOwner);
  const scroll = h.captureScroll(h, el, props);
  return {
    computed: h.pick(h, el, { pseudo: null, names: props.fixed }),
    before: h.pick(h, el, { pseudo: "::before", names: props.fixed }),
    after: h.pick(h, el, { pseudo: "::after", names: props.fixed }),
    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
    child_inline_styles: childStyles,
    text_owners: textOwners,
    scroll,
  };
}

/**
 * ページ側の関数の一覧。ページ側の関数は、互いをこの一覧を通して呼ぶ。
 * ページへは pageFunctionBody がこの一覧を関数のソースのまま組み込んで渡す。
 */
const PAGE_HELPERS = {
  present,
  isElementNode,
  foldOrigin,
  pick,
  assertInsideDocument,
  childInlineStyles,
  collapse,
  countLines,
  edgeTrimmedAdvance,
  widthOf,
  collectText,
  isShadowRoot,
  clippedAway,
  record,
  appendToOwner,
  addOwner,
  visit,
  isButtonInput,
  isSlot,
  transformText,
  collectInputValue,
  captureTextOwners,
  clipsNothing,
  hasOffsetBox,
  captureScroll,
  scrollbarStyles,
};

/**
 * ページ側の関数の一覧の型。
 * @typedef {typeof PAGE_HELPERS} PageHelpers
 */

/**
 * 1 要素分の特性を採る（ブラウザ内で実行される処理を、Node から直接呼ぶための関数）。
 *
 * @param {Element} el 対象の要素。
 * @param {CaptureProps} props 採るプロパティの固定集合。
 * @returns {ElementTraits} 採取の結果。
 */
export function captureElementTraits(el, props) {
  return captureElement(PAGE_HELPERS, el, props);
}

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
 * ページへ渡す関数の本文のソース。captureElement とページ側の関数の一覧を、関数のソースのまま組み込む。
 * ページ側でグローバルを増やさず、evaluate を 1 回で済ませるために、1 つの式にまとめる。
 * @returns {string}
 */
function pageFunctionBody() {
  const helpers = Object.entries(PAGE_HELPERS)
    .map(([name, fn]) => `${name}: ${fn}`)
    .join(",\n");
  return `return (${captureElement})({\n${helpers}\n}, el, props);`;
}

/**
 * evaluate に渡せる関数か。new Function は Function 型を返すので、evaluate の引数の形の型に絞る。
 * @param {unknown} value
 * @returns {value is (el: Element, props: CaptureProps) => unknown}
 */
function isPageFunction(value) {
  return typeof value === "function";
}

/**
 * pageFunctionBody のソースから、ページへ渡す関数を作る。
 * @returns {(el: Element, props: CaptureProps) => unknown}
 */
function compilePageFunction() {
  const compiled = new Function("el", "props", pageFunctionBody());
  // new Function は常に関数を返すので、ここで投げることは起きない（型の絞り込みのため）。
  if (!isPageFunction(compiled)) throw new Error("trait capture: page function is not callable");
  return compiled;
}

/**
 * ページへ渡す関数。captureTraits の最初の呼び出しで作り、以後は同じ関数を使う。
 * @type {((el: Element, props: CaptureProps) => unknown) | undefined}
 */
let pageFunction;

/**
 * ページへ渡す関数を返す。locator.evaluate は関数を文字列にしてページへ渡すので、モジュールの関数を参照する
 * captureElement はそのままでは渡せない。そこで、ページ側の関数のソースを組み込んだ関数を作って渡す。
 * ソースは入力に依らないので 1 回だけ作る。モジュールを読み込むときには作らないので、定数だけを使う側は new Function を実行しない。
 * @returns {(el: Element, props: CaptureProps) => unknown}
 */
function getPageFunction() {
  pageFunction ??= compilePageFunction();
  return pageFunction;
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
  const results = [];
  const inPage = getPageFunction();
  for (const entry of entries) {
    let captured;
    try {
      captured = await entry.locator.evaluate(inPage, {
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
