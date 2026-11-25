// 2 回撮りで揺れた領域から要素を探す処理のうち、ページで実行するコード。noise-masks.mjs が locateRegionsInPage を import し、
// page.evaluate へそのまま渡す。
// page.evaluate は関数のソースだけをページへ送るので、locateRegionsInPage は本体の外の名前を参照しない。
// 本体が呼ぶ関数はすべて本体の中に入れ子で書き、読むのは引数と素のグローバル（document・window・CSS など）だけにする。
// このファイルは import を持たない。noise-masks.mjs と一緒に、その隣の page/ へコピーして使う。
// 要素の選び方・セレクタの作り方・出力の形を変えたら、noise-masks.mjs の VERSION とこのファイルの PAGE_VERSION を同じ値に上げる。

/** このファイルのバージョン。noise-masks.mjs の VERSION と同じ値にする。 */
export const PAGE_VERSION = "1";

/**
 * 矩形（CSS px）。
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

/**
 * 領域 1 つについて、ページで探した結果。要素を特定できたら選んだ要素を、できなければ理由だけを持つ。
 * basis は選んだ要素の種類で、`clipping-ancestor`（切り取る祖先）か `covering`（領域を覆う要素）。
 * @typedef {{ region: Rect, selector: string, basis: "clipping-ancestor" | "covering", element_rect: Rect }} FoundRegion
 * @typedef {{ region: Rect, reason: string }} UnlocatedRegion
 * @typedef {FoundRegion | UnlocatedRegion} LocatedRegion
 */

/**
 * 領域ごとに、マスクの候補になる要素を探す（ページへ渡す関数の本体）。
 * page.evaluate は関数のソースだけをページへ送るので、本体の外の名前を参照しない。
 * 領域の座標は撮った画像の座標（CSS px）で、全画面の撮影では文書の原点から、ビューポートの撮影ではビューポートの原点から数える。
 * @param {{ regions: Rect[], fullPage: boolean }} input
 * @returns {LocatedRegion[]}
 */
export function locateRegionsInPage({ regions, fullPage }) {
  /** 領域の縁を外側へ丸めたぶんの許容差（CSS px）。 */
  const TOLERANCE = 1;
  const root = document.documentElement;
  const isDocumentBox = (/** @type {Element} */ el) =>
    el === root || el === document.body || el === document.scrollingElement;

  /**
   * 要素の矩形を、撮った画像の座標にする。
   * @param {Element} el
   */
  const imageRect = (el) => {
    const r = el.getBoundingClientRect();
    return fullPage
      ? { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height }
      : { x: r.x, y: r.y, width: r.width, height: r.height };
  };

  /**
   * 要素の矩形が領域を丸ごと覆うか。
   * @param {{ x: number, y: number, width: number, height: number }} outer
   * @param {{ x: number, y: number, width: number, height: number }} inner
   */
  const covers = (outer, inner) =>
    outer.x <= inner.x + TOLERANCE &&
    outer.y <= inner.y + TOLERANCE &&
    outer.x + outer.width >= inner.x + inner.width - TOLERANCE &&
    outer.y + outer.height >= inner.y + inner.height - TOLERANCE;

  /**
   * セレクタが、その要素だけを指すか。
   * @param {string} selector
   * @param {Element} el
   */
  const pointsOnlyTo = (selector, el) => {
    try {
      const found = document.querySelectorAll(selector);
      return found.length === 1 && found[0] === el;
    } catch {
      return false;
    }
  };

  /**
   * 要素が親の中で同じ名前の兄弟の何番目か（1 から数える）。
   * @param {Element} el
   */
  const typeIndex = (el) => {
    let index = 1;
    for (
      let sibling = el.previousElementSibling;
      sibling !== null;
      sibling = sibling.previousElementSibling
    ) {
      if (sibling.localName === el.localName) index += 1;
    }
    return index;
  };

  /**
   * id かテスト用の属性で、要素だけを指すセレクタ。どちらも 1 つに決まらなければ null。
   * @param {Element} el
   * @returns {string | null}
   */
  const selectorByName = (el) => {
    const candidates = el.id ? [`#${CSS.escape(el.id)}`] : [];
    for (const attribute of ["data-testid", "data-test", "data-qa"]) {
      const value = el.getAttribute(attribute);
      if (value !== null) candidates.push(`${el.localName}[${attribute}="${CSS.escape(value)}"]`);
    }
    return candidates.find((selector) => pointsOnlyTo(selector, el)) ?? null;
  };

  /**
   * 親からの位置で、要素を指すセレクタ。1 つに決まる id を持つ祖先があれば、そこから始める。
   * @param {Element} el
   * @returns {string}
   */
  const selectorByPath = (el) => {
    /** @type {string[]} */
    const parts = [`${el.localName}:nth-of-type(${typeIndex(el)})`];
    for (let current = el.parentElement; current !== null; current = current.parentElement) {
      if (current === root) return [root.localName, ...parts].join(" > ");
      const byId = current.id ? `#${CSS.escape(current.id)}` : null;
      if (byId !== null && pointsOnlyTo(byId, current)) return [byId, ...parts].join(" > ");
      parts.unshift(`${current.localName}:nth-of-type(${typeIndex(current)})`);
    }
    return parts.join(" > ");
  };

  /**
   * 要素を 1 つだけ指すセレクタを作る。id、テスト用の属性、親からの位置の順に試し、1 つに決まらなければ null。
   * @param {Element} el
   * @returns {string | null}
   */
  const selectorOf = (el) => {
    const byName = selectorByName(el);
    if (byName !== null) return byName;
    const byPath = selectorByPath(el);
    return pointsOnlyTo(byPath, el) ? byPath : null;
  };

  /**
   * 要素とその祖先のうち、overflow で切り取り、領域を覆う、いちばん近いもの。無ければ null。
   * @param {Element} el
   * @param {{ x: number, y: number, width: number, height: number }} region
   */
  const clippingAncestor = (el, region) => {
    /** @type {Element | null} */
    let current = el;
    for (; current !== null && !isDocumentBox(current); current = current.parentElement) {
      const style = getComputedStyle(current);
      const clips = style.overflowX !== "visible" || style.overflowY !== "visible";
      if (clips && covers(imageRect(current), region)) return current;
    }
    return null;
  };

  const startX = window.scrollX;
  const startY = window.scrollY;
  try {
    return regions.map((region) => {
      const centerX = region.x + region.width / 2;
      const centerY = region.y + region.height / 2;
      if (fullPage) {
        // 中心がビューポートに入るまでスクロールする（elementsFromPoint はビューポートの座標で探す）。
        // ページが scroll-behavior: smooth を指定していても、スクロールし終えた位置で探すように instant で動かす
        window.scrollTo({
          left: Math.max(0, centerX - window.innerWidth / 2),
          top: Math.max(0, centerY - window.innerHeight / 2),
          behavior: "instant",
        });
      }
      const clientX = fullPage ? centerX - window.scrollX : centerX;
      const clientY = fullPage ? centerY - window.scrollY : centerY;
      const stack = document.elementsFromPoint(clientX, clientY);
      const covering =
        stack.find((el) => !isDocumentBox(el) && covers(imageRect(el), region)) ?? null;
      if (covering === null) {
        return { region, reason: "no element other than html / body covers the region" };
      }
      const clipping = clippingAncestor(covering, region);
      const chosen = clipping ?? covering;
      const selector = selectorOf(chosen);
      if (selector === null) {
        return { region, reason: "no CSS selector points only to the covering element" };
      }
      /** @type {"clipping-ancestor" | "covering"} */
      const basis = clipping !== null ? "clipping-ancestor" : "covering";
      return { region, selector, basis, element_rect: imageRect(chosen) };
    });
  } finally {
    if (fullPage) window.scrollTo({ left: startX, top: startY, behavior: "instant" });
  }
}
