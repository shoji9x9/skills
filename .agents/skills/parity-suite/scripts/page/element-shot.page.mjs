// 要素スクリーンショットの撮影のうち、ページで実行するコード。element-shot.mjs が measureInPage を import し、
// locator.evaluate へそのまま渡す。
// locator.evaluate は関数のソースだけをページへ送るので、measureInPage は本体の外の名前を参照しない。
// 本体が呼ぶ関数はすべて本体の中に入れ子で書き、読むのは引数と素のグローバル（Math・parseFloat など）だけにする。
// このファイルは import を持たない。element-shot.mjs と一緒に、その隣の page/ へコピーして使う。
// フレームを遡る理由と、直せない形を失敗させる理由は element-shot.mjs の冒頭にある。
// 出力の形（採る値・キー・正規化）を変えたら、element-shot.mjs の VERSION を上げる。利用者のコピーは VERSION で版を突き合わせる。

/**
 * フレームを遡る途中の状態。x / y はここまでに足した座標、frames は内側から外側への各段の矩形と見える範囲。
 * @typedef {{
 *   view: Window,
 *   x: number,
 *   y: number,
 *   frames: { rect: { x:number, y:number, width:number, height:number }, viewport: { width:number, height:number } }[],
 *   frameError: string | null,
 *   liveAnimations: number | null,
 * }} FrameWalk
 */

/**
 * ブラウザ内で矩形とビューポートを読む（ページへ渡す関数の本体）。
 *
 * iframe の中なら、フレームを 1 段ずつ遡って最上位のビューポート座標（`page_rect`）へ直す。
 * 各段のオフセットは「フレーム要素の矩形 + 枠線 + padding」で、フレームの中身はそこから始まる。
 * 各段で要素がそのフレームの見える範囲に収まっているかを Node 側で判定できるよう、
 * 段ごとの矩形と見える範囲を `frames` に並べる（内側から外側へ。最上位は含めない）。
 * @param {Element} el
 */
export function measureInPage(el) {
  /**
   * ビューが最上位か。親を読めない（クロスオリジン）ときは最上位でないとみなす。
   * @param {Window} view
   * @returns {boolean}
   */
  function isTopView(view) {
    try {
      return view === view.top;
    } catch {
      return false;
    }
  }

  /**
   * ビューを置いているフレーム要素。読めない（クロスオリジンで例外になる）なら null。
   * @param {Window} view
   * @returns {Element | null}
   */
  function frameElementOf(view) {
    try {
      return view.frameElement;
    } catch {
      return null;
    }
  }

  /**
   * 文書（またはシャドウルート）の中の生きているアニメーションを数える。開いたシャドウルートは再帰で辿る。
   *
   * `animations: "disabled"` は**撮影の中で**有限のものを完了まで早送りし、無限のものを初期状態へ戻してから撮り、
   * 撮り終えたら元の時刻へ復帰させる。そのため撮影の前後で測った矩形が同じでも、PNG は別の幾何で撮られている
   * （一時停止した無限アニメーションが典型）。撮る前に件数を見て、生きているなら clip を信用しない。
   * 数える範囲は要素の部分木ではなく、要素が居る文書と、iframe を遡った先の各文書の全体。
   * 要素を動かすのは部分木だけではない。祖先の移動・変形、フレーム要素、前に並ぶ兄弟の幅の変化も
   * レイアウトを通じて要素を動かす。これらも撮影の中で早送り／初期化され、撮り終えると戻るので、
   * 前後の矩形が一致したまま PNG だけ別の位置で切られる。どのノードが要素を動かしうるかを列挙する代わりに文書ごと数える。
   * `document.getAnimations()` はシャドウツリーの中を含まない（実測）ので、開いたシャドウルートを再帰で辿る
   * （閉じたシャドウルートは読めない）。
   * @param {Document | ShadowRoot} root
   * @returns {number}
   */
  function countTree(root) {
    let n = root
      .getAnimations()
      .filter((a) => a.playState !== "finished" && a.playState !== "idle").length;
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) n += countTree(host.shadowRoot);
    }
    return n;
  }

  /**
   * 要素が居る文書の生きているアニメーションの数。getAnimations を持たない環境では数えられないので null（判定しない）。
   * @param {Element} el
   * @returns {number | null}
   */
  function countOwnAnimations(el) {
    try {
      return countTree(el.ownerDocument);
    } catch {
      return null;
    }
  }

  /**
   * 親文書のアニメーションを足す（フレーム要素・その祖先・兄弟がフレームごと要素を動かしうる）。数えられなければ null。
   * @param {number | null} count - ここまでに数えた件数（null は数えられなかった）
   * @param {Window} parent
   * @returns {number | null}
   */
  function addParentAnimations(count, parent) {
    if (count === null) return null;
    try {
      return count + countTree(parent.document);
    } catch {
      return null;
    }
  }

  /**
   * @param {ParentNode} parent
   * @returns {parent is ShadowRoot}
   */
  function isShadowRoot(parent) {
    return "host" in parent;
  }

  /**
   * @param {Element} element
   * @returns {element is HTMLElement}
   */
  function isOffsetBox(element) {
    return "offsetWidth" in element;
  }

  /**
   * @param {Window} w
   * @returns {w is Window & { DOMMatrixReadOnly: typeof DOMMatrixReadOnly }}
   */
  function hasMatrix(w) {
    return "DOMMatrixReadOnly" in w && typeof w.DOMMatrixReadOnly === "function";
  }

  /**
   * 計算後スタイルの変形が平行移動だけか。
   * `transform` の計算値は行列（translate / rotate / scale の個別プロパティは含まない）なので、個別プロパティも見る。
   * @param {CSSStyleDeclaration} cs
   * @param {Window} parent - 計算後スタイルを読んだ文書のビュー（DOMMatrixReadOnly を使う）
   * @returns {boolean}
   */
  function isTranslationOnly(cs, parent) {
    // 個別プロパティは「何も変えない値」を none ではなくその値で返す（実測: `rotate: 0deg` → "0deg"、
    // `scale: 1 1` → "1"）。transition の初期値・リセットで普通に書かれるので、角度 0 の rotate と
    // 全成分 1 の scale は通す。読めない値（NaN）は恒等とみなさず拒否する。
    /** @param {string} v */
    const tokens = (v) => v.trim().split(/\s+/);
    const rotateIsIdentity =
      !cs.rotate || cs.rotate === "none" || parseFloat(tokens(cs.rotate).pop() ?? "") === 0;
    const scaleIsIdentity =
      !cs.scale || cs.scale === "none" || tokens(cs.scale).every((t) => parseFloat(t) === 1);
    if (!rotateIsIdentity || !scaleIsIdentity) {
      return false;
    }
    if (cs.transform && cs.transform !== "none") {
      if (!hasMatrix(parent)) throw new TypeError("parent.DOMMatrixReadOnly is not a constructor");
      const m = new parent.DOMMatrixReadOnly(cs.transform);
      const linear = [m.m11, m.m12, m.m13, m.m14, m.m21, m.m22, m.m23, m.m24];
      const rest = [m.m31, m.m32, m.m33, m.m34, m.m44];
      if (linear.join() !== "1,0,0,0,0,1,0,0" || rest.join() !== "0,0,1,0,1") {
        return false;
      }
    }
    return true;
  }

  /**
   * フレーム要素か親文書内の祖先に、平行移動以外の変形があるか。
   * 寸法だけでは外形を保つ変形（rotate(180deg) / scaleX(-1) 等）を見逃す。外接矩形の寸法が変わらないのに
   * 中身の座標は反転している。そこで計算後スタイルを読んで判定する。
   * @param {Element} frameEl
   * @param {Window} parent - フレーム要素が居る文書のビュー
   * @returns {boolean}
   */
  function hasNonTranslationAncestor(frameEl, parent) {
    /** @type {Element | null} */
    let node = frameEl;
    while (node && node.nodeType === 1) {
      if (!isTranslationOnly(parent.getComputedStyle(node), parent)) return true;
      // シャドウツリーの中なら、ホストへ抜けて祖先を辿り続ける。
      /** @type {Element | null} */
      const shadowHost =
        node.parentNode && isShadowRoot(node.parentNode) ? node.parentNode.host : null;
      node = node.parentElement || shadowHost || null;
    }
    return false;
  }

  /**
   * フレームが変形されていて、オフセットの足し算では最上位の座標が決まらないか。
   * @param {Element} frameEl
   * @param {{ frameBox: DOMRect, parent: Window }} where - フレーム要素の矩形（変形後）と、フレーム要素が居る文書のビュー
   * @returns {boolean}
   */
  function isTransformedFrame(frameEl, { frameBox, parent }) {
    // transform で拡縮されたフレームは、矩形（変形後）とレイアウト寸法（変形前）が食い違う。
    // 中身の座標も同じ倍率で縮むので、足し算では最上位の座標が決まらない。
    // offsetWidth / offsetHeight は整数へ丸められるので（枠線・padding が小数なら矩形と 1px 未満ずれる。
    // 実測: 610.5px のフレームで offsetWidth=611）、1px 以上の食い違いだけを変形とみなす。
    // それより小さい倍率ずれは、フレーム全体でも位置の誤差が 1px 未満で、clip の丸めと同じ桁に収まる。
    // offsetWidth を持たないフレーム要素は、寸法の差を測れない（NaN の比較は偽になる）ので、ここでは変形とみなさない。
    if (
      isOffsetBox(frameEl) &&
      (Math.abs(frameBox.width - frameEl.offsetWidth) >= 1 ||
        Math.abs(frameBox.height - frameEl.offsetHeight) >= 1)
    ) {
      return true;
    }
    return hasNonTranslationAncestor(frameEl, parent);
  }

  /**
   * フレームを 1 段外へ出る。オフセットを足せないなら frameError を書き、view を変えずに false を返す。
   * @param {FrameWalk} walk
   * @param {DOMRect} box - 要素の矩形（そのフレームの座標）
   * @returns {boolean} 1 段外へ出られたか
   */
  function stepOutOfFrame(walk, box) {
    const view = walk.view;
    const frameEl = frameElementOf(view);
    if (!frameEl) {
      walk.frameError = "unreadable";
      return false;
    }
    // 見える範囲はスクロールバーを除いた寸法（scrollingElement は quirks なら body、標準なら html）。
    const doc = view.document;
    const scroller = doc.scrollingElement || doc.documentElement;
    walk.frames.push({
      rect: { x: walk.x, y: walk.y, width: box.width, height: box.height },
      viewport: { width: scroller.clientWidth, height: scroller.clientHeight },
    });
    const parent = view.parent;
    const frameBox = frameEl.getBoundingClientRect();
    if (isTransformedFrame(frameEl, { frameBox, parent })) {
      walk.frameError = "transformed";
      return false;
    }
    walk.liveAnimations = addParentAnimations(walk.liveAnimations, parent);
    const style = parent.getComputedStyle(frameEl);
    // 枠線は clientLeft / clientTop ではなく計算後スタイルから読む。clientLeft は整数へ丸められるが、
    // 枠線はデバイスピクセルへスナップされて小数になる（実測: deviceScaleFactor 1.5 で 1px の枠線は
    // borderLeftWidth=0.666667px・clientLeft=1）。丸めた値を足すと最上位の座標が 1/3px ずれ、clip の丸めが 1px 反転しうる。
    walk.x += frameBox.x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    walk.y += frameBox.y + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    walk.view = parent;
    return true;
  }

  const box = el.getBoundingClientRect();
  const liveAnimations = countOwnAnimations(el);
  const ownerView = el.ownerDocument.defaultView;
  // 閲覧文脈を持たない文書。戻り値の viewport を読めないので、読む前に止める。
  if (ownerView === null) throw new TypeError("element clip: the element's document has no window");
  /** @type {FrameWalk} */
  const walk = {
    view: ownerView,
    x: box.x,
    y: box.y,
    frames: [],
    frameError: null,
    liveAnimations,
  };
  // 抜ける条件を戻り値にも持たせる。frameError の代入だけで抜けると、代入が欠けたときにループが終わらない。
  while (!isTopView(walk.view)) {
    if (!stepOutOfFrame(walk, box)) break;
  }
  return {
    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
    page_rect: { x: walk.x, y: walk.y, width: box.width, height: box.height },
    viewport: { width: walk.view.innerWidth, height: walk.view.innerHeight },
    frames: walk.frames,
    frame_error: walk.frameError,
    live_animations: walk.liveAnimations,
  };
}
