// 論理名付き要素の特性採取のうち、ページで実行するコード。trait-capture.mjs が captureElement を import し、
// locator.evaluate へそのまま渡す。
// locator.evaluate は関数のソースだけをページへ送るので、captureElement は本体の外の名前を参照しない。
// 本体が呼ぶ関数はすべて本体の中に入れ子で書き、読むのは引数と素のグローバル（getComputedStyle・location・document など）だけにする。
// このファイルは import を持たない。trait-capture.mjs と一緒に、その隣の page/ へコピーして使う。
// 何を採るかと、採る理由は trait-capture.mjs の冒頭にある。

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

/**
 * ブラウザ内で 1 要素分の特性を採る（locator.evaluate に渡す関数の本体）。
 * el と props を受け取り、computed / before / after / rect / child_inline_styles / text_owners / scroll を返す。
 * 擬似要素は content が "none"（＝生成コンテンツ無し）のとき null を返し、省略できるようにする。
 * 矩形が文書の外に丸ごと出ている要素（支援技術のためのコピー）はここで失敗させる。
 * @param {Element} el
 * @param {CaptureProps} props
 */
export function captureElement(el, props) {
  // foldOrigin が使う自分のオリジン。要素ごとに 1 回だけ求める。
  const origin = location.origin;
  const foldable = /^https?:\/\//.test(origin);

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
  // origin と foldable は値ごとに求め直さず、本体の先頭で要素ごとに 1 回だけ求める。
  /** @param {string} value */
  function foldOrigin(value) {
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
   * @param {Element} el
   * @param {{ pseudo: "::before" | "::after", names: readonly string[] }} request
   * @returns {Record<string, string> | null}
   */
  /**
   * @overload
   * @param {Element} el
   * @param {{ pseudo: string | null, names: readonly string[] }} request
   * @returns {Record<string, string>}
   */
  /**
   * 要素（pseudo を渡せばその擬似要素）の計算値のうち、names の値を採る。
   * @param {Element} el
   * @param {{ pseudo: string | null, names: readonly string[] }} request
   * @returns {Record<string, string> | null}
   */
  function pick(el, { pseudo, names }) {
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
      out[prop] = foldOrigin(value);
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
   * @param {TextState} st
   * @param {{ node: Node, path: string, flatParent: Element }} at
   */
  function collectText(st, { node, path, flatParent }) {
    const raw = node.nodeValue || "";
    if (collapse(raw) === "") {
      // 空白だけのノードは持ち主を新しく作らないが、既に文字を持つ持ち主の中の空白は文字列と幅に残す
      const known = st.owners.get(flatParent);
      if (known) {
        st.rawText.set(known, st.rawText.get(known) + raw);
        const full = widthOf(st.el, node, { start: 0, end: raw.length });
        present(st.segments.get(known)).push({ full, lead: full, trail: full, blank: true });
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
    const leadLength = present(/^[ \t\n\r\f]*/.exec(raw))[0].length;
    const trailLength = present(/[ \t\n\r\f]*$/.exec(raw))[0].length;
    const segment = {
      full: fragments.reduce((sum, f) => sum + f.width, 0),
      lead: widthOf(st.el, node, { start: 0, end: leadLength }),
      trail: widthOf(st.el, node, { start: raw.length - trailLength, end: raw.length }),
      blank: false,
    };
    record(st, { owner: flatParent, path, raw, r, fragments, segment });
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
   * @param {Element} el
   * @param {{ owner: Element, r: Rect }} text
   */
  function clippedAway(el, { owner, r }) {
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
        (node.parentNode && isShadowRoot(node.parentNode) ? node.parentNode.host : undefined) ||
        null;
    }
    return right - left < 2 || bottom - top < 2;
  }

  /**
   * 持ち主へ 1 つ分の文字を足す。描かれていない文字（visibility が visible でない・祖先の切り抜きで実質見えない）は数えない。
   * @param {TextState} st
   * @param {TextPiece} piece
   */
  function record(st, piece) {
    const { owner, r } = piece;
    const glyphHeight = piece.fragments.reduce((max, f) => Math.max(max, f.height), 0);
    const style = getComputedStyle(owner);
    if (style.getPropertyValue("visibility") !== "visible") return;
    if (clippedAway(st.el, { owner, r })) return;
    const known = st.owners.get(owner);
    if (known) {
      appendToOwner(st, { known, piece, glyphHeight });
      return;
    }
    addOwner(st, piece, { style, glyphHeight });
  }

  /**
   * 既にある持ち主の行へ、文字・区切り・行の断片を足し、外接矩形を広げる。
   * @param {TextState} st
   * @param {{ known: TextOwner, piece: TextPiece, glyphHeight: number }} merge
   */
  function appendToOwner(st, { known, piece, glyphHeight }) {
    const { raw, r, fragments, segment } = piece;
    st.rawText.set(known, st.rawText.get(known) + raw);
    present(st.segments.get(known)).push(segment);
    known.glyph_height = Math.max(known.glyph_height, glyphHeight);
    for (const f of fragments)
      present(st.bands.get(known)).push({ top: f.y, bottom: f.y + f.height });
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
   * @param {TextState} st
   * @param {{ nodes: Iterable<Node, unknown, unknown>, path: string, flatParent: Element }} at
   */
  function visit(st, { nodes, path, flatParent }) {
    let elementIndex = 0;
    for (const node of nodes) {
      if (node.nodeType === 3) {
        collectText(st, { node, path, flatParent });
        continue;
      }
      if (!isElementNode(node)) continue;
      const segment = `${node.tagName.toLowerCase()}[${elementIndex}]`;
      elementIndex += 1;
      const childPath = path === "" ? segment : `${path}>${segment}`;
      if (isButtonInput(node)) collectInputValue(st, { node, path: childPath });
      if (node.shadowRoot) {
        // シャドウツリーが描かれ、ライト DOM の子は <slot> 経由でその位置に描かれる
        const shadowNodes = Array.from(node.shadowRoot.childNodes);
        visit(st, { nodes: shadowNodes, path: `${childPath}>#shadow-root`, flatParent: node });
      } else if (isSlot(node) && node.assignedNodes().length > 0) {
        visit(st, { nodes: node.assignedNodes(), path: childPath, flatParent: node });
      } else {
        visit(st, { nodes: Array.from(node.childNodes), path: childPath, flatParent: node });
      }
    }
  }

  // ボタンとして描かれる <input>（submit / button / reset）は value の文字をテキストノードを持たずに描く。
  // 数えないと <input type=submit value="検索"> を <button>検索</button> へ置き換えた組で、見た目が同じでも
  // 件数の差（text[0] の absent / present）が出る。Range で測れないので、同じ書体を canvas の measureText に
  // 当てて行の断片を 1 つ作る（実測: 同じ書体の <button> の Range と幅・高さが一致した）。
  /**
   * @param {Node} node
   * @returns {node is HTMLInputElement & { readonly __isButtonInput: true }}
   */
  function isButtonInput(node) {
    return (
      isElementNode(node) &&
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
   * @param {TextState} st
   * @param {{ node: HTMLInputElement, path: string }} input
   */
  function collectInputValue(st, { node, path }) {
    const type = String(node.type).toLowerCase();
    const defaultLabel = type !== "button" && !node.hasAttribute("value");
    const raw = String(node.value || "");
    if (collapse(raw) === "" && !defaultLabel) return;
    const box = node.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return;
    const style = getComputedStyle(node);
    st.canvas =
      st.canvas ||
      present((st.el.ownerDocument || document).createElement("canvas").getContext("2d"));
    const canvas = st.canvas;
    canvas.font = ["font-style", "font-weight", "font-size", "font-family"]
      .map((prop) => style.getPropertyValue(prop))
      .join(" ");
    // canvas は text-transform と letter-spacing を当てないので、描く側と同じ形へ寄せてから測る
    // （実測: uppercase・0.05em で input 48.0px、button 71.5px だった）
    const shown = transformText(raw, style.getPropertyValue("text-transform"));
    const spacing = style.getPropertyValue("letter-spacing");
    canvas.letterSpacing = spacing === "normal" ? "0px" : spacing;
    const m = canvas.measureText(shown);
    const height = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
    const fragment = { x: box.x, y: box.y, width: m.width, height };
    const segment = { full: m.width, lead: 0, trail: 0, blank: false };
    const rect = { x: box.x, y: box.y, width: box.width, height: box.height };
    record(st, { owner: node, path, raw, r: rect, fragments: [fragment], segment });
  }

  // 文字の持ち主を平坦木の順に拾う（冒頭の「文字の持ち主」を参照）。path は el からの道筋で、
  // 照合には使わない診断材料（どの要素が文字を持っているかを採取物から読むため）。
  // 持ち主ごとの生の文字列（rawText）の空白の畳み込みと trim は、全ノードを繋いだ後に 1 回だけ当てる。
  // ノードごとに trim して " " で繋ぐと、フレームワークがテキストを分けたかどうかで文字列が変わる
  // （React の <span>{count}件</span> は "3" と "件" の 2 ノードで "3 件"、1 ノードなら "3件"）。
  // すると、見た目が同じ文字の寸法の照合が、trait-compare.mjs で警告なしに省かれる。
  /**
   * @param {Element} el
   * @param {readonly string[]} textOwnerProps
   * @returns {TextOwner[]}
   */
  function captureTextOwners(el, textOwnerProps) {
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
    if (isButtonInput(el)) collectInputValue(st, { node: el, path: "" });
    visit(st, {
      nodes: el.shadowRoot ? Array.from(el.shadowRoot.childNodes) : Array.from(el.childNodes || []),
      path: el.shadowRoot ? "#shadow-root" : "",
      flatParent: el,
    });
    for (const entry of st.textOwners) {
      entry.text = collapse(present(st.rawText.get(entry)));
      entry.advance = edgeTrimmedAdvance(present(st.segments.get(entry)));
      entry.lines = countLines(present(st.bands.get(entry)));
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
   * @param {Element} el
   * @param {CaptureProps} props
   */
  function captureScroll(el, props) {
    const elementStyle = getComputedStyle(el);
    const scrollArea =
      hasOffsetBox(el) &&
      elementStyle.getPropertyValue("display") !== "inline" &&
      !(
        clipsNothing(elementStyle.getPropertyValue("overflow-x")) &&
        clipsNothing(elementStyle.getPropertyValue("overflow-y"))
      );
    if (!scrollArea) return null;
    /** @param {string} side */
    const border = (side) => parseFloat(elementStyle.getPropertyValue(`border-${side}-width`)) || 0;
    return {
      overflowing_x: el.scrollWidth > el.clientWidth,
      overflowing_y: el.scrollHeight > el.clientHeight,
      // 縦のスクロールバー（とガター）が取った幅・横のスクロールバーが取った高さ。枠を差し引く
      // （実測: 枠 2px・overflow: auto のスクロール領域で offsetWidth 204 / clientWidth 185 → 15px）
      vertical_bar_px: Math.round(
        el.offsetWidth - el.clientWidth - border("left") - border("right"),
      ),
      horizontal_bar_px: Math.round(
        el.offsetHeight - el.clientHeight - border("top") - border("bottom"),
      ),
      ...scrollbarStyles(el, props),
    };
  }

  /**
   * スクロールバーの見た目の宣言と、::-webkit-scrollbar 系の計算値を採る。
   * @param {Element} el
   * @param {CaptureProps} props
   */
  function scrollbarStyles(el, props) {
    // ::-webkit-scrollbar を持たないブラウザでは擬似要素の計算値が見た目を表さないので、読まずに印を残す
    const webkitSupported =
      typeof CSS !== "undefined" && CSS.supports("selector(::-webkit-scrollbar)");
    /** @type {Record<string, Record<string, string>>} */
    const webkitStyles = {};
    /** @type {Record<string, Record<string, string>> | "unsupported"} */
    const webkit = webkitSupported ? webkitStyles : "unsupported";
    if (webkitSupported) {
      for (const pseudo of props.scrollbarPseudos)
        webkitStyles[pseudo] = pick(el, { pseudo, names: props.scrollbarPseudoProps });
    }
    return { style: pick(el, { pseudo: null, names: props.scrollbar }), webkit };
  }

  const box = el.getBoundingClientRect();
  assertInsideDocument(box);
  const childStyles = childInlineStyles(el);
  const textOwners = captureTextOwners(el, props.textOwner);
  const scroll = captureScroll(el, props);
  return {
    computed: pick(el, { pseudo: null, names: props.fixed }),
    before: pick(el, { pseudo: "::before", names: props.fixed }),
    after: pick(el, { pseudo: "::after", names: props.fixed }),
    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
    child_inline_styles: childStyles,
    text_owners: textOwners,
    scroll,
  };
}
