// 論理名付き要素の特性採取（正本）。
// 正本はこのスキル側にあり、実行時はプロジェクトの
// `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使う（配布スキルの成果物同梱規約）。
// コピー先はコピー専用のサブディレクトリで、プロジェクト自作ツールと同居させない（修正しない規約のため）。
// このファイルのスキーマ（FIXED_PROPERTIES・採取形状）を変えたら、成果物の
// `metadata.json` の `traits.property_set` も必ず更新する（parity-diff は property_set を正とする）。
//
// 何を採るか: 論理名（ロケータマッピングの契約名）を付けた要素について、
// 固定プロパティ集合の computed style ＋ 擬似要素（::before / ::after）の computed style ＋
// getBoundingClientRect() ＋ 1 段下の子の inline style（child_inline_styles）＋
// 文字の持ち主（text_owners。部分木の中で文字を描いている要素ごとの書体・大きさ・文字の寸法）を採る。
// 相対幾何（要素対の関係）は絶対座標ではなくこの rect から trait-compare.mjs 側で導出する。
//
// 採った対象が「画面に描かれているもの」かを、採取の中で 1 度だけ確かめる。特性照合は
// 「論理名を付けた要素そのもの」の固定プロパティ集合しか見ないため、名前が描かれていない要素へ
// 解決していると、全プロパティ一致のまま緑になり画素だけが差を出す（差が出ない形なので、
// 緑を根拠に先へ進める）。2 つの形を塞ぐ:
//   - 支援技術のための写し: 市販部品は aria のための木を別に作り、getByRole が返す要素が
//     画面の外（y = -32000 等）に置かれていることがある。矩形が文書の外なら採取を失敗させる
//     （下記 captureElement。getBoundingClientRect() は相対幾何のために既に読んでいる）
//   - 装飾が子ノードに乗っている: 名前を付けた要素の計算値は一致するのに、子の inline style が
//     見た目を変えている。子の計算値は採らず、inline style の在否と値だけを記録して、
//     画素の差をフォントの版・ヒンティングの切り分けへ持っていかずに済むようにする
//     （照合には使わない診断材料。正本の説明は references/baseline.md）
//
// 文字の持ち主（text_owners）: 固定集合の font 系は「名前を付けた要素そのもの」の値でしかない。
// 文字を持つのが子孫の要素だと（<button><div><span>設定</span></div></button>）、実際に文字を
// 描いている書体・大きさ・行の高さはどこにも採られず、新側が要素自身に文字を置く実装だと
// 要素の計算値が一致したまま特性照合が緑になる（Issue #459。文字の幅が 26px と 30.4px で違っていた）。
// そこで部分木のテキストノードを平坦木の順（開いたシャドウルートの中と、<slot> に割り当てられた
// ノードを描かれる位置で辿る）に拾い、平坦木の親要素（文字の持ち主。slot に割り当てられた文字は slot）ごとに 1 行、TEXT_OWNER_PROPERTIES の
// 計算値と、その要素が直接持つ文字の寸法（行の断片の幅の合計 advance・最大の高さ glyph_height・行の数 lines）を記録する。行は文字が現れる順に並び、入れ子の深さに
// 依らないので、DOM の形が違う現・新でも「i 番目の文字の持ち主」どうしを trait-compare.mjs が突き合わせられる。
// 描かれていない文字（空白だけ・矩形の面積 0・visibility が visible でない・祖先の切り抜きで実質見えない〈sr-only 等〉）は
// 数えない。ボタンとして描く <input>（submit / button / reset）の value は文字として数える。
// 射程: 閉じたシャドウルートの中は辿れない。描画に使われた書体の実体（フォールバックの解決先）は
// 計算値に出ないので採らない——採取環境と利用者環境の乖離として references/baseline.md の手順で確かめる。
//
// 何を採らないか: letter-spacing・text-transform・background-image 等、要素の矩形の内側に
// そのまま写る項目はこの集合に含めない（名前無し要素の見た目差と同様、画素経路＝要素
// スクリーンショット側に委ねる）。プロパティを足すときは、決定論的に採れ（乱数・時刻・
// アニメーションに依存せず）、両実装で意味が保たれる項目に限る。
//
// 画素経路へ委ねられるのは「要素の矩形を撮った静止画に写る」プロパティだけ。写らないものを
// 外すと、特性照合でも画素比較でも差が出ない＝どちらの経路にも現れない見た目になる
// （cursor の写し忘れが 12 状態 × 2 ロケールの照合と画素比較を全部緑で通り抜け、利用者が
// 触って気づいた実例がある）。委ねる先が無いので、次の 4 族はこの集合に入れる:
//
//   - 操作したときの手応えを決めるが静止画には出ない: cursor / user-select / pointer-events
//   - 要素が**どこに置かれるか**を決めるが、切り出しが要素についてくるため矩形の中には出ない:
//     position / top / right / bottom / left（絶対座標そのものは rect が持つが、rect の差は
//     「ずれた」としか言わない。どの宣言がずらしているかは top / left の計算値でしか分からない）
//   - 要素の**矩形の外側**に描かれる、または下地に依存して弁別できない: box-shadow（外側の影は
//     要素の矩形の外なので要素スクショに写らない）/ opacity（下地が違えば同じ値でも別の色になり、
//     逆に下地が同じでも半透明と不透明の差が画素差として現れないことがある）
//   - 折り返し・省略を決めるが、採取時の文字列が短ければ静止画には差として出ない:
//     white-space / overflow-x / overflow-y / text-overflow / word-break
//     （実データが長くなった利用側で初めて崩れる。部品カタログの見本では再現しない）
//
// 足す候補を検討するときは「決定論的か」「両実装で意味が保たれるか」に加えて「外したとき
// **要素の矩形を撮った**画素経路が拾えるか」を必ず問う。ページ全体のスクショなら写るものでも、
// 要素の矩形で切ると写らない（Issue #434）。
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
 * ツールのバージョン（正本）。採取スキーマ（FIXED_PROPERTIES・採取形状）を変えたら上げる。
 * metadata.json の traits.tool / differ に記録する「バージョン」はこの値を使う（手入力にしない）。
 * @type {string}
 */
export const VERSION = "5";

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
  // 以下は「要素の矩形を撮った静止画」に写らないため画素経路へ委ねられない
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
 * 文字の持ち主（text_owners）について採る computed style の固定集合（正本）。
 * 文字の見た目のうち、描いている要素の計算値でしか決まらない書体・大きさ・行の高さに絞る
 * （色や装飾は要素の矩形の内側に写るので画素経路が拾う）。変えたら VERSION を上げる。
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
 * ブラウザ内で 1 要素分の特性を採る純関数（locator.evaluate に渡す）。
 * el と props を受け取り、computed / before / after / rect / child_inline_styles / text_owners を返す。
 * 擬似要素は content が "none"（＝生成コンテンツ無し）のとき null を返し、省略できるようにする。
 * 矩形が文書の外に丸ごと出ている要素（支援技術のための写し）はここで失敗させる。
 * この関数は文字列化して evaluate に渡るため、外部スコープを参照しない（props で受け取る）。
 * @param {Element} el
 * @param {{ fixed: readonly string[], textOwner: readonly string[] }} props
 */
function captureElement(el, { fixed: props, textOwner: textOwnerProps }) {
  // 同一オリジンの url() をオリジン非依存の印へ畳む。cursor: url(cur.png) のような相対 URL の
  // 計算値は自分のオリジンで絶対化されるため（実測: 同じ CSS が :8811 と :8822 で別文字列になる）、
  // 現・新がホストもポートも違う前提のパリティ比較では、同じ指定が偽の property 差分になる。
  // 畳むのは自分のオリジンで始まる URL だけ。data: と他オリジンの URL は両側で同じ文字列に
  // なるので触らない（畳むと別ホストの資産どうしが同一視され、本物の差分を消す）。
  // 正規化できないとき（file:// 等で origin が "null"）は元の値のまま残す——偽の差分として
  // 目に見える側へ倒し、黙って一致させない。
  //
  // 置換は url() トークンの中身を取り出し、その URL 自体が自オリジンで始まるときだけ行う。
  // 値全体への単純置換にすると、他オリジン URL のパス・クエリにたまたま自オリジンが現れた値
  // （url("https://cdn.example/redirect/http://legacy.example:8811/x") 等）まで畳んで、
  // 現・新で別物を指している外部参照を同値化し、本物の差分を消す。
  //
  // 射程: 畳むのは URL 文字列までで、参照先の資産の中身は照合しない。現新が同じパスで
  // 別バイトの資産を配信していると、その見た目差はこの経路にも画素にも現れない。
  // 対象要素がある機能は gaps.md へ「採取値の射程外」として残す（確認済みにしない）。
  const origin = location.origin;
  const foldable = /^https?:\/\//.test(origin);
  const foldOrigin = (value) => {
    if (!foldable || !value.includes("url(")) return value;
    return value.replace(/url\(\s*("[^"]*"|'[^']*'|[^)]*)\s*\)/g, (whole, raw) => {
      const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : "";
      const url = quote ? raw.slice(1, -1) : raw.trim();
      if (url !== origin && !url.startsWith(origin + "/")) return whole;
      return `url(${quote}<same-origin>${url.slice(origin.length)}${quote})`;
    });
  };

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
      out[prop] = foldOrigin(value);
    }
    if (unknown.length > 0) {
      throw new Error(
        `computed style did not resolve${pseudo ? ` for ${pseudo}` : ""}: ${unknown.join(", ")}`,
      );
    }
    return out;
  };
  const box = el.getBoundingClientRect();

  // 描かれているかの判定は、ビューポートではなく**文書**の矩形に対して行う。ビューポートで測ると
  // 折り返し下の要素（full_page 撮影では正当に写る）やスクロールで外へ出た要素まで落ちる。
  // 文書座標へ直したうえで「文書の外側に丸ごと出ている」ものだけを失敗にする——
  // 支援技術のための写しは y = -32000 のような座標に置かれるので、この判定で捕まる。
  // 面積 0 の矩形（display: none 等）はこの判定から外す。描かれていないのは同じだが、
  // 状態として正当に採る対象であり、写しの合図ではない。
  // 射程: この除外のぶん、width: 0; height: 0 で置かれた写しは素通りする（捕まえるのは
  // 文書の外へ動かした写しだけ）。限界は references/baseline.md に書いてある。
  // なお内側にスクロール領域を持つ部品（横スクロールするデータグリッド等）では、正当な要素でも
  // 器の外へ出た位置に矩形が出て文書の外と判定されうる。写しとは原因が違うので、失敗メッセージには
  // どちらの可能性も出す（採り直す前に対象を器の中へスクロールさせる）。
  if (box.width > 0 && box.height > 0) {
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
  const childInlineStyles = [];
  for (let i = 0; i < el.children.length; i += 1) {
    const child = el.children[i];
    const inline = child.getAttribute("style");
    if (inline === null || inline.trim() === "") continue;
    childInlineStyles.push({
      index: i,
      tag: child.tagName.toLowerCase(),
      style: inline.trim(),
    });
  }

  // 文字の持ち主を平坦木の順に拾う（冒頭の「文字の持ち主」を参照）。path は el からの道筋で、
  // 照合には使わない診断材料（どの要素が文字を持っているかを採取物から読むため）。
  const owners = new Map();
  const textOwners = [];
  // 持ち主ごとの生の文字列。空白の畳み込みと trim は全ノードを繋いだ後に 1 回だけ当てる——
  // ノードごとに trim して " " で繋ぐと、フレームワークがテキストを分けたかどうかで文字列が変わり
  // （React の <span>{count}件</span> は "3" と "件" の 2 ノードで "3 件"、1 ノードなら "3件"）、
  // 見た目が同じ文字の寸法の照合が trait-compare.mjs で黙って省かれる。
  const rawText = new Map();
  // 持ち主ごとの行の断片（縦の範囲）。行の数は断片の数ではなく、行の帯の数で数える——
  // テキストノードが分かれると同じ行に断片が 2 つ出る（実測: "3" と "件" の 2 ノードで断片 2、1 ノードで 1）。
  // 帯の切れ目は「前の帯の上端から、その断片の高さの半分以上下がったか」で決める。断片の高さは行送りではなく
  // 書体の高さなので、line-height を詰めると上下の行の断片が縦に重なり、重なりで数えると折り返しを 1 行と
  // 数える（実測: 16px・3 行の折り返しが line-height: 1 / 0.8 で 1 行になった）。同じ行の断片は上端が揃う。
  const bands = new Map();
  const countLines = (list) => {
    let lines = 0;
    let rowTop = -Infinity;
    for (const f of [...list].sort((a, b) => a.top - b.top)) {
      if (f.top >= rowTop + (f.bottom - f.top) / 2) {
        lines += 1;
        rowTop = f.top;
      }
    }
    return lines;
  };
  const collapse = (value) => value.replace(/\s+/g, " ").trim();
  const collectText = (node, path, flatParent) => {
    const raw = node.nodeValue || "";
    if (collapse(raw) === "") {
      // 空白だけのノードは持ち主を新しく作らないが、既に文字を持つ持ち主の中の空白は文字列に残す
      const known = owners.get(flatParent);
      if (known) rawText.set(known, rawText.get(known) + raw);
      return;
    }
    // 持ち主は平坦木の親（visit が渡す）。文字の書体は平坦木で継承されるため、<slot> に割り当てられた
    // 文字は DOM の親（ホスト）ではなく slot から継承する（実測: シャドウ内の <button style="font-size:30px">
    // <slot> に割り当てた文字を parentElement で採るとホストの 16px が記録された）。シャドウルート直下の
    // 文字はホストが持ち主になる（ShadowRoot は要素ではなく計算値を持たない）。
    const range = (el.ownerDocument || document).createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    // 比較に使う寸法は行の断片（getClientRects）から出す。外接矩形（r）は折り返すと「1 行目の左端〜
    // 最終行の右端」まで広がり、同じ持ち主の文字どうしを合わせると間に挟まる子要素の領域まで覆うため、
    // 書体と無関係な寸法の差を出す（外接矩形は診断材料として rect に残すだけ）。
    const fragments = Array.from(range.getClientRects()).filter((f) => f.width > 0 && f.height > 0);
    record(flatParent, path, raw, r, fragments);
  };
  // 文字の矩形が、el までの祖先の切り抜き（overflow が visible でない箱・clip: rect(0 0 0 0)）で
  // 実質的に見えなくなっているか。視覚的に隠した文字（sr-only: 1px の箱に overflow: hidden で閉じ込める、
  // text-indent: -9999px で箱の外へ逃がす）は矩形の面積も visibility も通常の文字と同じなので、
  // 切り抜いた後の幅か高さが 2px 未満なら描かれていないとみなす（実測: sr-only の「閉じる」は
  // 切り抜き後 1×1）。省略記号で切られた長い文字は大きく残るので数え続ける。
  const clippedAway = (owner, r) => {
    let left = r.x;
    let top = r.y;
    let right = r.x + r.width;
    let bottom = r.y + r.height;
    for (let node = owner; node;) {
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
      node = node.parentElement || (node.parentNode && node.parentNode.host) || null;
    }
    return right - left < 2 || bottom - top < 2;
  };
  // 持ち主へ 1 つ分の文字を足す。r は外接矩形（診断材料）、fragments は行の断片（寸法の照合に使う）。
  const record = (owner, path, raw, r, fragments) => {
    const advance = fragments.reduce((sum, f) => sum + f.width, 0);
    const glyphHeight = fragments.reduce((max, f) => Math.max(max, f.height), 0);
    const style = getComputedStyle(owner);
    if (style.getPropertyValue("visibility") !== "visible") return;
    if (clippedAway(owner, r)) return;
    const known = owners.get(owner);
    if (known) {
      rawText.set(known, rawText.get(known) + raw);
      known.advance += advance;
      known.glyph_height = Math.max(known.glyph_height, glyphHeight);
      for (const f of fragments) bands.get(known).push({ top: f.y, bottom: f.y + f.height });
      const x2 = Math.max(known.rect.x + known.rect.width, r.x + r.width);
      const y2 = Math.max(known.rect.y + known.rect.height, r.y + r.height);
      known.rect.x = Math.min(known.rect.x, r.x);
      known.rect.y = Math.min(known.rect.y, r.y);
      known.rect.width = x2 - known.rect.x;
      known.rect.height = y2 - known.rect.y;
      return;
    }
    const picked = {};
    const unknown = [];
    for (const prop of textOwnerProps) {
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
      advance,
      glyph_height: glyphHeight,
      lines: 0,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    };
    owners.set(owner, entry);
    rawText.set(entry, raw);
    bands.set(
      entry,
      fragments.map((f) => ({ top: f.y, bottom: f.y + f.height })),
    );
    textOwners.push(entry);
  };
  const visit = (nodes, path, flatParent) => {
    let elementIndex = 0;
    for (const node of nodes) {
      if (node.nodeType === 3) {
        collectText(node, path, flatParent);
        continue;
      }
      if (node.nodeType !== 1) continue;
      const segment = `${node.tagName.toLowerCase()}[${elementIndex}]`;
      elementIndex += 1;
      const childPath = path === "" ? segment : `${path}>${segment}`;
      if (isButtonInput(node)) collectInputValue(node, childPath);
      if (node.shadowRoot) {
        // シャドウツリーが描かれ、ライト DOM の子は <slot> 経由でその位置に描かれる
        visit(Array.from(node.shadowRoot.childNodes), `${childPath}>#shadow-root`, node);
      } else if (typeof node.assignedNodes === "function" && node.assignedNodes().length > 0) {
        visit(node.assignedNodes(), childPath, node);
      } else {
        visit(Array.from(node.childNodes), childPath, node);
      }
    }
  };
  // ボタンとして描かれる <input>（submit / button / reset）は value の文字をテキストノードを持たずに描く。
  // 数えないと <input type=submit value="検索"> を <button>検索</button> へ置き換えた組で、見た目が同じでも
  // 件数の差（text[0] の absent / present）が出る。Range で測れないので、同じ書体を canvas の measureText に
  // 当てて行の断片を 1 つ作る（実測: 同じ書体の <button> の Range と幅・高さが一致した）。
  const isButtonInput = (node) =>
    node.nodeType === 1 &&
    node.tagName === "INPUT" &&
    ["submit", "button", "reset"].includes(String(node.type).toLowerCase());
  let canvas = null;
  const collectInputValue = (node, path) => {
    const raw = String(node.value || "");
    if (collapse(raw) === "") return;
    const box = node.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return;
    const style = getComputedStyle(node);
    canvas = canvas || (el.ownerDocument || document).createElement("canvas").getContext("2d");
    canvas.font = ["font-style", "font-weight", "font-size", "font-family"]
      .map((prop) => style.getPropertyValue(prop))
      .join(" ");
    const m = canvas.measureText(raw);
    const height = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
    const fragment = { x: box.x, y: box.y, width: m.width, height };
    record(node, path, raw, { x: box.x, y: box.y, width: box.width, height: box.height }, [
      fragment,
    ]);
  };
  if (isButtonInput(el)) collectInputValue(el, "");
  visit(
    el.shadowRoot ? Array.from(el.shadowRoot.childNodes) : Array.from(el.childNodes || []),
    el.shadowRoot ? "#shadow-root" : "",
    el,
  );
  for (const entry of textOwners) {
    entry.text = collapse(rawText.get(entry));
    entry.lines = countLines(bands.get(entry));
  }

  return {
    computed: pick(null),
    before: pick("::before"),
    after: pick("::after"),
    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
    child_inline_styles: childInlineStyles,
    text_owners: textOwners,
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
 *     }[]
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
 * `element is outside the document` も同じ扱いで、**論理名が描かれていない要素（支援技術のための写し）へ
 * 解決している**というマッピング側の欠陥である。欠落に変換すると、注入と無関係に赤が出るうえ、
 * 写しから採り続ける状態が残る。この失敗も捕捉せず停止し、ロケータマッピングを直してから採り直す。
 *
 * @param {{ name: string, locator: import('playwright').Locator }[]} entries
 * @returns {Promise<Array<{ name: string, computed: Record<string,string>, before: (Record<string,string>|null), after: (Record<string,string>|null), rect: { x:number, y:number, width:number, height:number }, child_inline_styles: { index:number, tag:string, style:string }[], text_owners: { path:string, tag:string, text:string, style: Record<string,string>, advance:number, glyph_height:number, lines:number, rect: { x:number, y:number, width:number, height:number } }[] }>>}
 */
export async function captureTraits(entries) {
  const results = [];
  for (const entry of entries) {
    let captured;
    try {
      captured = await entry.locator.evaluate(captureElement, {
        fixed: FIXED_PROPERTIES,
        textOwner: TEXT_OWNER_PROPERTIES,
      });
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
