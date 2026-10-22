// 移行元の静的資産の棚卸しのプローブ。
// 使い方: `node <このファイル>` を実行し、stdout に出る関数式のソースを chrome-devtools MCP の evaluate_script の
// function 引数にそのまま渡す。Node はソースを組み立てて出すだけで、測定はしない（測るのはブラウザの document）。
// 使い方の原本は references/static-assets.md である。
//
// 測るもの: 現行画面が「実際に描いている」静的資産。img だけを見ると取りこぼすため、
// 同じ走査で疑似要素（::before / ::after）の content と書体、background-image 等の url()、
// document.fonts、@font-face の src、アイコンの link、読み込まれた資源を読む。
// 画面に出ていない img（display: none 等）は rendered: false として残す。
// 「出ていないから描かない」と決める前に、同じ場所を疑似要素が描いていないかを突き合わせるため。
// 決定論的: 乱数・時刻に依存せず、document 順に走査する（resources だけは読み込み順）。
//
// ページで実行する処理は、本体の assetProbeInPage と、ASSET_PROBE_PAGE に並べたヘルパーに分けて書く。
// ページへはソースだけが渡るので、ヘルパーはモジュールの名前を参照せず、互いを引数の一覧（`h`）を通して呼ぶ。
// 1 つの関数式へのまとめ方は lib/page-function.mjs にある。

import { isCliEntry } from "./lib/cli.mjs";
import { pageFunctionSource } from "./lib/page-function.mjs";

/**
 * 走査する要素。type・currentSrc・src は、それを持つ要素（img・input など）でだけ値がある。
 * @typedef {Element & { type?: unknown, currentSrc?: unknown, src?: unknown }} ProbedElement
 * @typedef {{ count: number, rendered: number, samples: { path: string, rendered: boolean }[] }} ProbeCounts
 * @typedef {{ url: string, property: string, pseudo: string | null }} UrlRefInit
 * @typedef {{ url: string, localFragment: boolean }} ResolvedRef
 * @typedef {ArrayLike<CSSRule & { style?: CSSStyleDeclaration, styleSheet?: CSSStyleSheet | null, cssRules?: CSSRuleList }>} WalkedRules
 * @typedef {{ family: string, weight: string | null, style: string | null, src: string[], sheet: string }} FontFaceRow
 */

/**
 * 1 回の走査の状態。本体が作り、ヘルパーへ引数で渡す。
 * @typedef {{
 *   h: AssetProbeHelpers,
 *   docWithoutHash: string,
 *   images: Map<string, { src: string, kind: string } & ProbeCounts>,
 *   urlRefs: Map<string, UrlRefInit & ProbeCounts>,
 *   localFragmentRefs: Map<string, UrlRefInit & ProbeCounts>,
 *   glyphs: Map<string, { pseudo: string, fontFamily: string, text: string, codepoints: string[], privateUse: boolean } & ProbeCounts>,
 *   fontFaces: FontFaceRow[],
 *   unreadableSheets: string[],
 *   visitedSheets: Set<CSSStyleSheet>,
 * }} ProbeRun
 */

// url() を取りうるプロパティ。allowlist なので、走査した一覧を urlPropsScanned で返して
// 「載っていないプロパティは見ていない」を台帳側で扱えるようにする（警告なしに外さない）。
const URL_PROPS = [
  "background-image",
  "list-style-image",
  "border-image-source",
  "mask-image",
  "-webkit-mask-image",
  "mask-border-source",
  "-webkit-mask-box-image-source",
  "shape-outside",
  "offset-path",
  "clip-path",
  "filter",
  "backdrop-filter",
  "fill",
  "stroke",
  "marker-start",
  "marker-mid",
  "marker-end",
  "cursor",
  "content",
];
const MAX_SAMPLES = 3;

/** @param {Element} el */
function cssPath(el) {
  const parts = [];
  /** @type {Element | null} */
  let cur = el;
  while (cur && cur !== document.body && cur !== document.documentElement && parts.length < 5) {
    /** @type {HTMLElement | null} */
    const parent = cur.parentElement;
    const idx = parent ? Array.from(parent.children).indexOf(cur) + 1 : 1;
    parts.unshift(cur.tagName.toLowerCase() + ":nth-child(" + idx + ")");
    cur = parent;
  }
  return parts.join(" > ");
}

/** @param {Element} el */
function isRendered(el) {
  if (!el.isConnected) return false;
  /** @type {Element | null} */
  let cur = el;
  for (; cur; cur = cur.parentElement) {
    const style = getComputedStyle(cur);
    if (style.display === "none") return false;
  }
  const style = getComputedStyle(el);
  if (style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// 計算後スタイルの url() は解決済みの絶対 URL で返るが、CSSOM の規則（@font-face の src 等）は書かれたままの相対 URL を返す。
// 相対 URL の基準はそのスタイルシートの URL なので、規則から読むときは base にシートの href を渡す。
// 同一文書内の断片参照（fill: url(#grad) 等）は外部資産ではない。base で解決すると文書自身の URL になり、
// 台帳に「現在の HTML をコピーするか」という行が生まれるので、外部参照と分けて返す。
// 判定は生の文字列の先頭 "#" ではなく解決後の URL で行う（./page.html#grad や絶対 URL でも同じ参照になる）。
function documentWithoutHash() {
  const u = new URL(document.baseURI);
  u.hash = "";
  return u.href;
}

/**
 * @param {ProbeRun} run
 * @param {string} raw
 * @param {string} base
 * @returns {ResolvedRef}
 */
function resolveRef(run, raw, base) {
  const u = new URL(raw, base);
  const hash = u.hash;
  u.hash = "";
  // 断片を持ち、断片以外が現在の文書と同じなら同じ文書の中の参照である（文書の URL は資産ではないので外す）。
  if (hash && u.href === run.docWithoutHash) return { url: hash, localFragment: true };
  return { url: new URL(raw, base).href, localFragment: false };
}

/**
 * @param {ProbeRun} run
 * @param {string} value
 * @param {string} [base]
 */
function urlsIn(run, value, base = document.baseURI) {
  const out = [];
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
  let m;
  while ((m = re.exec(value || ""))) {
    if (!m[2]) continue;
    out.push(run.h.resolveRef(run, m[2], base));
  }
  return out;
}

// content の文字列リテラルを取り出し、コードポイントに直す（"\f00d" のような私用領域のグリフを識別するため）。
/** @param {string} value */
function contentText(value) {
  if (!value || value === "none" || value === "normal") return "";
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
  let text = "";
  let m;
  while ((m = re.exec(value))) text += m[1] !== undefined ? m[1] : m[2];
  return text;
}

// Array.from(text) の要素は 1 文字以上なので、codePointAt(0) は常に数を返す（`?? 0` は型のためだけにある）。
/** @param {string} text */
function codepoints(text) {
  return Array.from(text).map(
    (ch) => "U+" + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0"),
  );
}

/** @param {string} text */
function isPrivateUse(text) {
  return Array.from(text).some((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000;
  });
}

/**
 * 表の key の行を数える。行が無ければ init から作る。
 * @template {Record<string, unknown>} T
 * @param {ProbeRun} run
 * @param {Map<string, T & ProbeCounts>} map
 * @param {{ key: string, init: T, el: Element, rendered: boolean }} hit
 */
function bump(run, map, { key, init, el, rendered }) {
  let entry = map.get(key);
  if (!entry) {
    entry = Object.assign({ count: 0, rendered: 0, samples: [] }, init);
    map.set(key, entry);
  }
  entry.count += 1;
  if (rendered) entry.rendered += 1;
  if (entry.samples.length < run.h.MAX_SAMPLES) {
    entry.samples.push({ path: run.h.cssPath(el), rendered });
  }
  return entry;
}

/**
 * url() の参照を数える。同じ文書の中の断片参照は localFragmentRefs に、それ以外は urlRefs に入れる。
 * @param {ProbeRun} run
 * @param {ResolvedRef} ref
 * @param {{ property: string, pseudo: string | null, el: Element, rendered: boolean }} at
 */
function bumpUrlRef(run, ref, { property, pseudo, el, rendered }) {
  run.h.bump(run, ref.localFragment ? run.localFragmentRefs : run.urlRefs, {
    key: JSON.stringify([property, pseudo, ref.url]),
    init: { url: ref.url, property, pseudo },
    el,
    rendered,
  });
}

/**
 * img・input[type=image] の src と、SVG の image・use の href を数える。
 * @param {ProbeRun} run
 * @param {ProbedElement} el
 * @param {boolean} rendered
 */
function scanImageElement(run, el, rendered) {
  const tag = el.tagName.toLowerCase();
  if (tag === "img" || (tag === "input" && el.type === "image")) {
    const src =
      (typeof el.currentSrc === "string" && el.currentSrc) ||
      (typeof el.src === "string" && el.src) ||
      el.getAttribute("src") ||
      "";
    if (src) run.h.bump(run, run.images, { key: src, init: { src, kind: tag }, el, rendered });
  } else if (tag === "image" || tag === "use") {
    const href = el.getAttribute("href") || el.getAttribute("xlink:href") || "";
    if (!href) return;
    const ref = run.h.resolveRef(run, href, document.baseURI);
    if (ref.localFragment) {
      run.h.bumpUrlRef(run, ref, { property: tag, pseudo: null, el, rendered });
    } else {
      const init = { src: ref.url, kind: "svg-" + tag };
      run.h.bump(run, run.images, { key: ref.url, init, el, rendered });
    }
  }
}

/**
 * 要素自身の計算後スタイルから url() を数える（content は疑似要素だけで読む）。
 * @param {ProbeRun} run
 * @param {Element} el
 * @param {boolean} rendered
 */
function scanOwnStyle(run, el, rendered) {
  const style = getComputedStyle(el, null);
  for (const property of run.h.URL_PROPS) {
    if (property === "content") continue;
    for (const ref of run.h.urlsIn(run, style.getPropertyValue(property))) {
      run.h.bumpUrlRef(run, ref, { property, pseudo: null, el, rendered });
    }
  }
}

/**
 * 疑似要素の content の文字（グリフ）と url() を数える。
 * @param {ProbeRun} run
 * @param {Element} el
 * @param {{ pseudo: string, rendered: boolean }} at
 */
function scanPseudo(run, el, { pseudo, rendered }) {
  const style = getComputedStyle(el, pseudo);
  const content = style.getPropertyValue("content");
  if (!content || content === "none" || content === "normal") return;
  // 疑似要素は宿主が描かれていれば描かれる（display: none の疑似要素は除く）。
  const pseudoRendered = rendered && style.display !== "none";
  const text = run.h.contentText(content);
  if (text.trim()) {
    const family = style.getPropertyValue("font-family");
    const init = {
      pseudo,
      fontFamily: family,
      text,
      codepoints: run.h.codepoints(text),
      privateUse: run.h.isPrivateUse(text),
    };
    const key = JSON.stringify([family, text]);
    run.h.bump(run, run.glyphs, { key, init, el, rendered: pseudoRendered });
  }
  for (const property of run.h.URL_PROPS) {
    for (const ref of run.h.urlsIn(run, style.getPropertyValue(property))) {
      run.h.bumpUrlRef(run, ref, { property, pseudo, el, rendered: pseudoRendered });
    }
  }
}

/**
 * 1 つの要素を走査する。要素の資産、要素自身のスタイル、::before、::after の順に読む。
 * @param {ProbeRun} run
 * @param {ProbedElement} el
 */
function scanElement(run, el) {
  const rendered = run.h.isRendered(el);
  run.h.scanImageElement(run, el, rendered);
  run.h.scanOwnStyle(run, el, rendered);
  for (const pseudo of ["::before", "::after"]) run.h.scanPseudo(run, el, { pseudo, rendered });
}

// open な shadow root の内側も走査する（querySelectorAll は shadow 境界を越えないため、
// Web Components が描く資産を警告なしに取りこぼす）。closed な shadow root は読めないので件数に出ない。
function collectElements() {
  /** @type {(Document | ShadowRoot)[]} */
  const roots = [document];
  /** @type {ProbedElement[]} */
  const elements = [];
  for (let i = 0; i < roots.length; i += 1) {
    for (const el of Array.from(roots[i].querySelectorAll("*"))) {
      elements.push(el);
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
  }
  return { roots, elements };
}

/**
 * @font-face の規則を 1 行にする。
 * @param {ProbeRun} run
 * @param {CSSStyleDeclaration} ruleStyle
 * @param {{ sheetHref: string, base: string }} sheet
 * @returns {FontFaceRow}
 */
function fontFaceRow(run, ruleStyle, { sheetHref, base }) {
  return {
    family: ruleStyle.getPropertyValue("font-family").trim(),
    weight: ruleStyle.getPropertyValue("font-weight").trim() || null,
    style: ruleStyle.getPropertyValue("font-style").trim() || null,
    src: run.h
      .urlsIn(run, ruleStyle.getPropertyValue("src"), base)
      .filter((ref) => !ref.localFragment)
      .map((ref) => ref.url),
    sheet: sheetHref,
  };
}

/**
 * 規則の一覧を走査し、@font-face を集める。@import の先と、入れ子の規則（@media など）の中も読む。
 * @param {ProbeRun} run
 * @param {WalkedRules} rules
 * @param {{ sheetHref: string, base: string }} sheet
 */
function walkRules(run, rules, sheet) {
  for (const rule of Array.from(rules)) {
    if (rule.type === CSSRule.FONT_FACE_RULE) {
      // @font-face の規則（CSSFontFaceRule）は必ず style を持つ。無ければ TypeError を投げて止める。
      const ruleStyle = rule.style;
      if (!ruleStyle) throw new TypeError("@font-face の規則に style がありません");
      run.fontFaces.push(run.h.fontFaceRow(run, ruleStyle, sheet));
    } else if (rule.type === CSSRule.IMPORT_RULE && rule.styleSheet) {
      run.h.visitSheet(run, rule.styleSheet);
    } else if (rule.cssRules) {
      run.h.walkRules(run, rule.cssRules, sheet);
    }
  }
}

// @font-face の src。クロスオリジンのスタイルシートは cssRules の参照で SecurityError を投げるため、
// 読めなかったシートは件数とともに残す（「無い」と「読めない」を区別する）。
// adoptedStyleSheets は document と複数の shadow root で共有されうるため、同じシートを二重に数えない。
/**
 * @param {ProbeRun} run
 * @param {CSSStyleSheet} sheet
 */
function visitSheet(run, sheet) {
  if (run.visitedSheets.has(sheet)) return;
  run.visitedSheets.add(sheet);
  /** @type {CSSRuleList} */
  let rules;
  try {
    rules = sheet.cssRules;
  } catch {
    run.unreadableSheets.push(sheet.href || "(inline)");
    return;
  }
  // インライン・構築済みのシートは href を持たず、相対 URL は文書の URL を基準に解決される。
  run.h.walkRules(run, rules, {
    sheetHref: sheet.href || "(inline)",
    base: sheet.href || document.baseURI,
  });
}

/**
 * rel が pattern に当たる link 要素。
 * @param {RegExp} pattern
 */
function linksWithRel(pattern) {
  return (
    Array.from(document.querySelectorAll("link[rel]"))
      // `link[rel]` に当たる要素で rel を持つのは HTMLLinkElement だけなので、instanceof で絞っても結果は変わらない。
      .filter((link) => link instanceof HTMLLinkElement)
      .filter((link) => pattern.test(link.rel))
  );
}

/**
 * 読み込まれた資源を、資産として裏が取れたもの（resources）と、取れないもの（unclassifiedResources）に分ける。
 * @param {Set<string>} corroborated DOM・@font-face・計算後スタイル・アイコンで参照を確かめた URL
 */
function classifyResources(corroborated) {
  // 拡張子は資産の十分条件でしかない（`/assets/content?id=123` のような、拡張子の無い配信がある）。
  // 拡張子にも initiatorType にも当たらない取得は捨てず unclassified として残す。
  const ASSET_EXT = /\.(woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico|bmp|cur)(\?|#|$)/i;
  // initiatorType が資産だと言い切れるものだけを昇格させる。link / css はスタイルシート・スクリプトの
  // preload にも付くため、DOM・@font-face・計算後スタイル・アイコンのいずれかで裏が取れた URL だけ資産とみなす。
  const ASSET_INITIATORS = new Set(["img", "image", "font", "input", "video", "track"]);
  const entries = performance.getEntriesByType ? performance.getEntriesByType("resource") : [];
  /** @type {{ url: string, initiatorType: string | undefined, matchedBy: string }[]} */
  const resources = [];
  /** @type {{ url: string, initiatorType: string | undefined }[]} */
  const unclassified = [];
  for (const entry of entries) {
    // resource の項目（PerformanceResourceTiming）は initiatorType を文字列で持つ。
    const initiatorType =
      "initiatorType" in entry && typeof entry.initiatorType === "string"
        ? entry.initiatorType
        : undefined;
    const row = { url: entry.name, initiatorType };
    if (ASSET_EXT.test(entry.name)) resources.push({ ...row, matchedBy: "extension" });
    else if (initiatorType !== undefined && ASSET_INITIATORS.has(initiatorType))
      resources.push({ ...row, matchedBy: "initiator" });
    else if (corroborated.has(entry.name)) resources.push({ ...row, matchedBy: "corroborated" });
    else unclassified.push(row);
  }
  return { entryCount: entries.length, resources, unclassified };
}

/**
 * 1 回の走査の状態を作る。
 * @param {AssetProbeHelpers} h
 * @returns {ProbeRun}
 */
function newRun(h) {
  return {
    h,
    docWithoutHash: h.documentWithoutHash(),
    images: new Map(),
    urlRefs: new Map(),
    // 同一文書内の断片参照（外部資産ではないが、SVG 定義の所在として棚卸しの手がかりになる）。
    localFragmentRefs: new Map(),
    glyphs: new Map(),
    fontFaces: [],
    unreadableSheets: [],
    visitedSheets: new Set(),
  };
}

/**
 * ページで実行する本体。ヘルパーの一覧を引数で受け取る。
 * @param {AssetProbeHelpers} h
 */
function assetProbeInPage(h) {
  const run = h.newRun(h);
  const { roots, elements } = h.collectElements();
  for (const el of elements) h.scanElement(run, el);
  for (const root of roots) {
    for (const sheet of Array.from(root.styleSheets || [])) h.visitSheet(run, sheet);
    for (const sheet of Array.from(root.adoptedStyleSheets || [])) h.visitSheet(run, sheet);
  }
  const loadedFonts = Array.from(document.fonts || [])
    .filter((face) => face.status === "loaded")
    .map((face) => ({ family: face.family, weight: face.weight, style: face.style }));
  const icons = h
    .linksWithRel(/(^|\s)(icon|apple-touch-icon|mask-icon)(\s|$)/i)
    .map((link) => ({ rel: link.rel, href: link.href, sizes: link.getAttribute("sizes") || null }));
  // manifest の icons はページの描画では取得されず resources にも出ないことがある。プローブは manifest を開かないので、
  // 参照だけを返す（中身の icons は読んでいない。manifest の URL をアイコンとして数えない）。
  const manifests = h
    .linksWithRel(/(^|\s)manifest(\s|$)/i)
    .map((link) => ({ href: link.href, iconsInspected: false }));
  const classified = h.classifyResources(
    new Set([
      ...Array.from(run.images.values()).map((row) => row.src),
      ...Array.from(run.urlRefs.values()).map((row) => row.url),
      ...run.fontFaces.flatMap((face) => face.src),
      ...icons.map((icon) => icon.href),
    ]),
  );
  return {
    url: location.pathname,
    images: Array.from(run.images.values()),
    urlRefs: Array.from(run.urlRefs.values()),
    localFragmentRefs: Array.from(run.localFragmentRefs.values()),
    glyphs: Array.from(run.glyphs.values()),
    fontFaces: run.fontFaces,
    loadedFonts,
    icons,
    manifests,
    urlPropsScanned: h.URL_PROPS,
    resources: classified.resources,
    unclassifiedResources: classified.unclassified,
    resourceEntryCount: classified.entryCount,
    // Resource Timing のバッファ容量は API から読めず（既定 250 件だが setResourceTimingBufferSize で変わる）、
    // 取得後に溢れの有無を証明する手段が無い。件数だけを返し、網羅性は unknown として扱わせる。
    resourcesCompleteness: "unknown",
    shadowRoots: roots.length - 1,
    unreadableSheets: run.unreadableSheets,
  };
}

/** ページ側のヘルパーと定数。ページへは pageFunctionSource がソースのまま組み込んで渡す。 */
const ASSET_PROBE_PAGE = {
  URL_PROPS,
  MAX_SAMPLES,
  cssPath,
  isRendered,
  documentWithoutHash,
  resolveRef,
  urlsIn,
  contentText,
  codepoints,
  isPrivateUse,
  bump,
  bumpUrlRef,
  scanImageElement,
  scanOwnStyle,
  scanPseudo,
  scanElement,
  collectElements,
  fontFaceRow,
  walkRules,
  visitSheet,
  linksWithRel,
  classifyResources,
  newRun,
};

/**
 * ページ側のヘルパーの一覧の型。
 * @typedef {typeof ASSET_PROBE_PAGE} AssetProbeHelpers
 */

/**
 * evaluate_script の function 引数に渡す関数式のソースを返す。
 * @returns {string}
 */
export function assetProbeSource() {
  return pageFunctionSource(assetProbeInPage, ASSET_PROBE_PAGE);
}

if (isCliEntry(import.meta.url)) {
  process.stdout.write(assetProbeSource() + "\n");
}
