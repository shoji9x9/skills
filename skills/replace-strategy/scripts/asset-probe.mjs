// 移行元の静的資産の棚卸しプローブ（正本）。
// 使い方: 下の `assetProbe` の関数リテラルを chrome-devtools MCP の evaluate_script の
// function 引数にそのまま渡す（Node では実行しない。ブラウザの document を参照する）。
// 使い方の正本は references/static-assets.md。
//
// 測るもの: 現行画面が「実際に描いている」静的資産。img だけを見ると取りこぼすため、
// 同じ走査で疑似要素（::before / ::after）の content と書体、background-image 等の url()、
// document.fonts、@font-face の src、アイコンの link、読み込まれた資源を読む。
// 画面に出ていない img（display: none 等）は rendered: false として残す——
// 「出ていないから描かない」と決める前に、同じ場所を疑似要素が描いていないかを突き合わせるため。
// 決定論的: 乱数・時刻に依存せず、document 順に走査する（resources だけは読み込み順）。

export const assetProbe = () => {
  // url() を取りうるプロパティ。allowlist なので、走査した一覧を urlPropsScanned で返して
  // 「載っていないプロパティは見ていない」を台帳側で扱えるようにする（黙って落とさない）。
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

  const cssPath = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement && parts.length < 5) {
      const parent = cur.parentElement;
      const idx = parent ? Array.from(parent.children).indexOf(cur) + 1 : 1;
      parts.unshift(cur.tagName.toLowerCase() + ":nth-child(" + idx + ")");
      cur = parent;
    }
    return parts.join(" > ");
  };

  const isRendered = (el) => {
    if (!el.isConnected) return false;
    for (let cur = el; cur; cur = cur.parentElement) {
      const style = getComputedStyle(cur);
      if (style.display === "none") return false;
    }
    const style = getComputedStyle(el);
    if (style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // 計算後スタイルの url() は解決済みの絶対 URL で返るが、CSSOM の規則（@font-face の src 等）は書かれたままの相対 URL を返す。
  // 相対 URL の基準はそのスタイルシートの URL なので、規則から読むときは base にシートの href を渡す。
  // 同一文書内の断片参照（fill: url(#grad) 等）は外部資産ではない。base で解決すると文書自身の URL になり、
  // 台帳に「現在の HTML を写すか」という行が生まれるので、外部参照と分けて返す。
  const urlsIn = (value, base = document.baseURI) => {
    const out = [];
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
    let m;
    while ((m = re.exec(value || ""))) {
      if (!m[2]) continue;
      if (m[2].startsWith("#")) out.push({ url: m[2], localFragment: true });
      else out.push({ url: new URL(m[2], base).href, localFragment: false });
    }
    return out;
  };

  // content の文字列リテラルを取り出し、コードポイントに直す（"\f00d" のような私用領域のグリフを識別するため）。
  const contentText = (value) => {
    if (!value || value === "none" || value === "normal") return "";
    const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
    let text = "";
    let m;
    while ((m = re.exec(value))) text += m[1] !== undefined ? m[1] : m[2];
    return text;
  };
  const codepoints = (text) =>
    Array.from(text).map(
      (ch) => "U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0"),
    );
  const isPrivateUse = (text) =>
    Array.from(text).some((ch) => {
      const cp = ch.codePointAt(0);
      return (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000;
    });

  const bump = (map, key, init, el, rendered) => {
    let entry = map.get(key);
    if (!entry) {
      entry = Object.assign({ count: 0, rendered: 0, samples: [] }, init);
      map.set(key, entry);
    }
    entry.count += 1;
    if (rendered) entry.rendered += 1;
    if (entry.samples.length < MAX_SAMPLES) entry.samples.push({ path: cssPath(el), rendered });
    return entry;
  };

  const images = new Map();
  const urlRefs = new Map();
  // 同一文書内の断片参照（外部資産ではないが、SVG 定義の所在として棚卸しの手がかりになる）。
  const localFragmentRefs = new Map();
  const glyphs = new Map();

  // open な shadow root の内側も走査する（querySelectorAll は shadow 境界を越えないため、
  // Web Components が描く資産を黙って取りこぼす）。closed な shadow root は読めないので件数に出ない。
  const roots = [document];
  const allElements = [];
  for (let i = 0; i < roots.length; i += 1) {
    for (const el of Array.from(roots[i].querySelectorAll("*"))) {
      allElements.push(el);
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
  }

  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    const rendered = isRendered(el);

    if (tag === "img" || (tag === "input" && el.type === "image")) {
      const src = el.currentSrc || el.src || el.getAttribute("src") || "";
      if (src) bump(images, src, { src, kind: tag }, el, rendered);
    } else if (tag === "image" || tag === "use") {
      const href = el.getAttribute("href") || el.getAttribute("xlink:href") || "";
      if (href && !href.startsWith("#")) {
        const abs = new URL(href, document.baseURI).href;
        bump(images, abs, { src: abs, kind: "svg-" + tag }, el, rendered);
      }
    }

    for (const pseudo of [null, "::before", "::after"]) {
      const style = getComputedStyle(el, pseudo);
      if (pseudo) {
        const content = style.getPropertyValue("content");
        if (!content || content === "none" || content === "normal") continue;
        // 疑似要素は宿主が描かれていれば描かれる（display: none の疑似要素は除く）。
        const pseudoRendered = rendered && style.display !== "none";
        const text = contentText(content);
        if (text.trim()) {
          const family = style.getPropertyValue("font-family");
          bump(
            glyphs,
            JSON.stringify([family, text]),
            {
              pseudo,
              fontFamily: family,
              text,
              codepoints: codepoints(text),
              privateUse: isPrivateUse(text),
            },
            el,
            pseudoRendered,
          );
        }
        for (const prop of URL_PROPS) {
          for (const ref of urlsIn(style.getPropertyValue(prop))) {
            const target = ref.localFragment ? localFragmentRefs : urlRefs;
            bump(
              target,
              JSON.stringify([prop, pseudo, ref.url]),
              { url: ref.url, property: prop, pseudo },
              el,
              pseudoRendered,
            );
          }
        }
      } else {
        for (const prop of URL_PROPS) {
          if (prop === "content") continue;
          for (const ref of urlsIn(style.getPropertyValue(prop))) {
            const target = ref.localFragment ? localFragmentRefs : urlRefs;
            bump(
              target,
              JSON.stringify([prop, null, ref.url]),
              { url: ref.url, property: prop, pseudo: null },
              el,
              rendered,
            );
          }
        }
      }
    }
  }

  // @font-face の src。クロスオリジンのスタイルシートは cssRules の参照で SecurityError を投げるため、
  // 読めなかったシートは件数とともに残す（「無い」と「読めない」を区別する）。
  const fontFaces = [];
  const unreadableSheets = [];
  const walk = (rules, sheetHref, base) => {
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        fontFaces.push({
          family: rule.style.getPropertyValue("font-family").trim(),
          weight: rule.style.getPropertyValue("font-weight").trim() || null,
          style: rule.style.getPropertyValue("font-style").trim() || null,
          src: urlsIn(rule.style.getPropertyValue("src"), base)
            .filter((ref) => !ref.localFragment)
            .map((ref) => ref.url),
          sheet: sheetHref,
        });
      } else if (rule.type === CSSRule.IMPORT_RULE && rule.styleSheet) {
        visit(rule.styleSheet);
      } else if (rule.cssRules) {
        walk(rule.cssRules, sheetHref, base);
      }
    }
  };
  // adoptedStyleSheets は document と複数の shadow root で共有されうるため、同じシートを二重に数えない。
  const visitedSheets = new Set();
  const visit = (sheet) => {
    if (visitedSheets.has(sheet)) return;
    visitedSheets.add(sheet);
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      unreadableSheets.push(sheet.href || "(inline)");
      return;
    }
    // インライン・構築済みのシートは href を持たず、相対 URL は文書の URL を基準に解決される。
    walk(rules, sheet.href || "(inline)", sheet.href || document.baseURI);
  };
  for (const root of roots) {
    for (const sheet of Array.from(root.styleSheets || [])) visit(sheet);
    for (const sheet of Array.from(root.adoptedStyleSheets || [])) visit(sheet);
  }

  const loadedFonts = Array.from(document.fonts || [])
    .filter((face) => face.status === "loaded")
    .map((face) => ({ family: face.family, weight: face.weight, style: face.style }));

  const icons = Array.from(document.querySelectorAll("link[rel]"))
    .filter((link) => /(^|\s)(icon|apple-touch-icon|mask-icon)(\s|$)/i.test(link.rel))
    .map((link) => ({ rel: link.rel, href: link.href, sizes: link.getAttribute("sizes") || null }));
  // manifest の icons はページの描画では取得されず resources にも出ないことがある。プローブは manifest を開かないので、
  // 参照だけを返す（中身の icons は読んでいない。manifest の URL をアイコンとして数えない）。
  const manifests = Array.from(document.querySelectorAll("link[rel]"))
    .filter((link) => /(^|\s)manifest(\s|$)/i.test(link.rel))
    .map((link) => ({ href: link.href, iconsInspected: false }));

  // 拡張子は資産の十分条件でしかない（/assets/content?id=123 のような拡張子なしの配信がある）。
  // 拡張子にも initiatorType にも当たらない取得は捨てず unclassified として残す。
  const ASSET_EXT = /\.(woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico|bmp|cur)(\?|#|$)/i;
  const ASSET_INITIATORS = new Set([
    "img",
    "image",
    "css",
    "link",
    "font",
    "input",
    "video",
    "track",
  ]);
  const resourceEntries = performance.getEntriesByType
    ? performance.getEntriesByType("resource")
    : [];
  const resources = [];
  const unclassifiedResources = [];
  for (const entry of resourceEntries) {
    const row = { url: entry.name, initiatorType: entry.initiatorType };
    if (ASSET_EXT.test(entry.name)) resources.push({ ...row, matchedBy: "extension" });
    else if (ASSET_INITIATORS.has(entry.initiatorType))
      resources.push({ ...row, matchedBy: "initiator" });
    else unclassifiedResources.push(row);
  }
  // Resource Timing のバッファ容量は API から読めず（既定 250 件だが setResourceTimingBufferSize で変わる）、
  // 取得後に溢れの有無を証明する手段が無い。件数だけを返し、網羅性は unknown として扱わせる。
  const resourcesCompleteness = "unknown";

  return {
    url: location.pathname,
    images: Array.from(images.values()),
    urlRefs: Array.from(urlRefs.values()),
    localFragmentRefs: Array.from(localFragmentRefs.values()),
    glyphs: Array.from(glyphs.values()),
    fontFaces,
    loadedFonts,
    icons,
    manifests,
    urlPropsScanned: URL_PROPS,
    resources,
    unclassifiedResources,
    resourceEntryCount: resourceEntries.length,
    resourcesCompleteness,
    shadowRoots: roots.length - 1,
    unreadableSheets,
  };
};
