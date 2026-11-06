// アイコンの SVG が、決めた範囲（許可した要素・属性・構文）に収まるかを確かめて読む部品。
// 範囲から外れたアイコンはエラーにし、図に埋め込まない（diagram-engine.mjs）。
// 収まったアイコンは、読んだ要素・属性・文字から書き出す（serializeIconBody）。埋め込みごとの id の書き換えも、
// 文字列の置換ではなく読んだ属性に当てるので、検査と書き換えで読み方がずれない。
//
// XML の仕様全体は読まない。受け付けるのは、先頭の XML 宣言・要素・属性・文字と、文字の中の定義済みの実体と数値の文字参照だけである。
// コメント・DOCTYPE・CDATA・処理命令と、XML 1.0 で使えない文字は、解釈せずにエラーにする。
// HTML に埋め込んだときに読み方が XML と変わる形（title と desc の中の要素）も受け付けない。
// 許可リストは、AWS 公式のアイコン（Architecture Icons）と同梱のアイコンが使う要素と属性に、
// グラデーションと線の図形を足したものである。script を実行させる要素・属性・URL（`javascript:`）は含めない。
// 確かめる処理は先頭から 1 回たどるだけなので、入力の長さに比例する時間で終わる。

const ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "use",
]);
// 中に文字を書いてよい要素。ほかの要素の中に書けるのは空白だけである。
const TEXT_ELEMENTS = new Set(["title", "desc"]);
const ATTRIBUTES = new Set([
  "id",
  "class",
  "version",
  "viewBox",
  "preserveAspectRatio",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "d",
  "points",
  "transform",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "clip-path",
  "clip-rule",
  "clipPathUnits",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "offset",
  "stop-color",
  "stop-opacity",
  "href",
  "xlink:href",
  "xmlns",
  "xmlns:xlink",
]);
// 名前空間の宣言は、SVG と XLink の名前空間だけを受け付ける。
const NAMESPACES = new Map([
  ["xmlns", "http://www.w3.org/2000/svg"],
  ["xmlns:xlink", "http://www.w3.org/1999/xlink"],
]);

// 空白は XML の空白（スペース・タブ・改行）だけを受け付ける。JavaScript の \s は NBSP なども含み、ブラウザの読み方とずれる。
const XML_DECL = /<\?xml[ \t\r\n][^<>?]*\?>/y;
const TEXT = /[^<]+/y;
const START = /<([A-Za-z][\w.:-]*)/y;
const ATTR = /[ \t\r\n]+([A-Za-z][\w.:-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)')/y;
const START_CLOSE = /[ \t\r\n]*(\/?)>/y;
const END = /<\/([A-Za-z][\w.:-]*)[ \t\r\n]*>/y;
const PREDEFINED = "amp|lt|gt|quot|apos";
// 属性の値で、定義済みの実体でない `&`。
const BAD_ENTITY_IN_VALUE = new RegExp(`&(?!(?:${PREDEFINED});)`);
// 文字で、定義済みの実体と数値の文字参照でない `&`。
const BAD_ENTITY_IN_TEXT = new RegExp(`&(?!(?:${PREDEFINED}|#\\d+|#x[\\dA-Fa-f]+);)`);
const CHAR_REF = /&#(?:(\d+)|x([\dA-Fa-f]+));/g;
// 同じ文書の中を指す url()。FUNCTION_CALL が名前 url を見つけた位置から当てる（y フラグ）。2 つ目の組が参照する id である。
// 名前の境界は FUNCTION_CALL だけが決める。url() を別の正規表現で探すと、`xurl(#a)` のように境界の読み方がずれる。
const LOCAL_URL_AT = /url\([ \t\r\n]*(["']?)#([^ \t\r\n"'()]+)\1[ \t\r\n]*\)/iy;
// 値に書ける CSS と変形の関数（名前は小文字で比べる）。url() は LOCAL_URL_AT の形だけを受け付けるので、ここには入れない。
// 外の資源を読む関数（url()・src()・image() など）を名前で挙げて拒むと、新しい関数が増えるたびに抜けるので、許可した名前だけを通す。
const FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "matrix",
  "translate",
  "scale",
  "rotate",
  "skewx",
  "skewy",
]);
// 関数の呼び出しの形。名前の途中から一致させないよう、名前の始まりだけで始める（入力の長さに比例する時間で終わる）。
// CSS の名前は ASCII 以外の文字も含むので、名前の文字と境界に ASCII 以外の文字も数える。
const FUNCTION_CALL =
  /(?<![\w-]|\P{ASCII})((?:[A-Za-z_-]|\P{ASCII})(?:[\w-]|\P{ASCII})*)[ \t\r\n]*\(/gu;
// 数字の列を 2 通りに割り振れる形（`\d+\.?\d*`）にすると、一致しない入力で 2 乗の時間になるので、小数点の後ろだけを省ける形にする。
const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
// 入れ子の上限。書き出しは再帰で行うので、深すぎる入れ子は呼び出しの深さの上限で止まる。AWS 公式のアイコンは数段である。
const MAX_DEPTH = 64;

/**
 * @typedef {{ type: "text", text: string }} TextNode
 * @typedef {{ type: "element", name: string, attributes: Map<string, string>, children: IconNode[] }} ElementNode
 * @typedef {TextNode | ElementNode} IconNode
 */

/**
 * @param {string} reason
 * @returns {never}
 */
function fail(reason) {
  throw new Error(reason);
}

/**
 * @param {RegExp} re 位置を固定した（y フラグの）正規表現
 * @param {string} s
 * @param {number} pos
 */
function matchAt(re, s, pos) {
  re.lastIndex = pos;
  return re.exec(s);
}

/**
 * XML 1.0 で使える文字か（タブ・改行・復帰と、制御文字・サロゲート・U+FFFE・U+FFFF を除く範囲）。
 * @param {number} cp
 */
function isXmlChar(cp) {
  return (
    cp === 0x9 ||
    cp === 0xa ||
    cp === 0xd ||
    (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) ||
    (cp >= 0x10000 && cp <= 0x10ffff)
  );
}

/**
 * XML 1.0 で使えない文字を含むか。対にならないサロゲートは、for...of がその 1 文字だけを返すので、使えない文字として数える。
 * @param {string} s
 */
function hasBadChar(s) {
  for (const ch of s) if (!isXmlChar(ch.codePointAt(0) ?? 0)) return true;
  return false;
}

/**
 * viewBox の値が、4 つの数値（区切りは空白か 1 つのカンマ）かを確かめる。
 * @param {string} value
 */
function isViewBox(value) {
  const trimmed = value.trim();
  if (/^,|,$|,[ \t\r\n]*,/.test(trimmed)) return false;
  const numbers = trimmed.split(/[ \t\r\n,]+/);
  return numbers.length === 4 && numbers.every((n) => NUMBER.test(n));
}

/**
 * 値の中の関数を先頭から読み、同じ文書の中を指す url() の範囲を返す。検査と書き出しの両方がこの結果を使う。
 * 許可していない関数・同じ文書の外を指す url()・関数の形でない括弧（`1url(` など）は、エラーにする。
 * @param {string} name
 * @param {string} value
 * @returns {{ start: number, end: number, id: string }[]}
 */
function readFunctions(name, value) {
  /** @type {{ start: number, end: number, id: string }[]} */
  const urls = [];
  let calls = 0;
  for (const call of value.matchAll(FUNCTION_CALL)) {
    calls++;
    // ASCII の英字だけを小文字にする。toLowerCase() は ASCII 以外の文字（ケルビン記号 U+212A など）も k などに変えるので、
    // 許可リストに無い名前が許可した名前として通る。
    const lower = call[1].replace(/[A-Z]/g, (c) => c.toLowerCase());
    if (lower === "url") {
      const local = matchAt(LOCAL_URL_AT, value, call.index);
      if (!local) fail(`属性 ${name} の url() が同じ文書の中（#...）を指していない`);
      urls.push({ start: call.index, end: LOCAL_URL_AT.lastIndex, id: local[2] });
    } else if (!FUNCTIONS.has(lower)) {
      fail(`属性 ${name} の値に、許可していない関数 ${call[1]}() がある`);
    }
  }
  // 関数の呼び出しの一致は、それぞれ別の ( で終わる。( の数が一致の数より多ければ、関数の形でない括弧がある。
  if (value.split("(").length - 1 !== calls) fail(`属性 ${name} の値に、関数の形でない括弧がある`);
  return urls;
}

/**
 * 属性の名前と値が、許可した範囲に収まるかを確かめる。
 * @param {string} name
 * @param {string} value
 */
function checkAttribute(name, value) {
  if (!ATTRIBUTES.has(name)) fail(`許可していない属性 ${name} がある`);
  if (hasBadChar(value)) fail(`属性 ${name} の値に、XML で使えない文字がある`);
  // 数値の文字参照（`&#117;`）は英字や括弧を作れるので、`url(`・`javascript:` を隠せる。属性の値では受け付けない。
  // 定義済みの実体（`&amp;` など。AWS のアイコンは id に使う）は英字も括弧も作らないので受け付ける。
  // `\` は CSS のエスケープになるので受け付けない。
  if (/[<\\]/.test(value) || BAD_ENTITY_IN_VALUE.test(value))
    fail(`属性 ${name} の値に <・\\・数値の文字参照・定義済みでない実体がある`);
  const ns = NAMESPACES.get(name);
  if (ns !== undefined && value !== ns) fail(`属性 ${name} の名前空間が ${ns} でない`);
  if (name === "viewBox" && !isViewBox(value)) fail(`属性 viewBox の値が 4 つの数値でない`);
  if ((name === "href" || name === "xlink:href") && !/^#[^ \t\r\n]+$/.test(value))
    fail(`属性 ${name} が同じ文書の中（#...）を指していない`);
  readFunctions(name, value);
}

/**
 * 文字参照が、XML 1.0 で使える文字を指すかを確かめる。
 * @param {string} text
 * @param {string} parent
 */
function checkCharRefs(text, parent) {
  for (const [, dec, hex] of text.matchAll(CHAR_REF)) {
    const cp = dec === undefined ? Number.parseInt(hex, 16) : Number(dec);
    const ok = isXmlChar(cp);
    if (!ok) fail(`<${parent}> の文字に、XML で使えない文字を指す文字参照がある`);
  }
}

/**
 * 文字が、置いた要素で許可した範囲に収まるかを確かめる。
 * @param {string} text
 * @param {string | undefined} parent 文字を置いた要素の名前（ルートの外なら undefined）
 * @returns {boolean} 文字を書き出すか（空白だけで、文字を置けない要素の中なら false）
 */
function checkText(text, parent) {
  if (parent === undefined || !TEXT_ELEMENTS.has(parent)) {
    if (/[^ \t\r\n]/.test(text)) fail(`<${parent ?? "svg"}> の${parent ? "中" : "外"}に文字がある`);
    return false;
  }
  if (hasBadChar(text)) fail(`<${parent}> の文字に、XML で使えない文字がある`);
  if (BAD_ENTITY_IN_TEXT.test(text))
    fail(`<${parent}> の文字に、定義済みでない実体か単独の & がある`);
  if (text.includes("]]>")) fail(`<${parent}> の文字に ]]> がある`);
  checkCharRefs(text, parent);
  return true;
}

/**
 * pos から始まる開始タグを読む。
 * @param {string} svg
 * @param {number} pos
 */
function readStartTag(svg, pos) {
  const start = matchAt(START, svg, pos);
  if (!start) fail(`読めない構文（コメント・DOCTYPE・CDATA・処理命令など）が ${pos} 文字目にある`);
  const name = start[1];
  if (!ELEMENTS.has(name)) fail(`許可していない要素 <${name}> がある`);
  /** @type {Map<string, string>} */
  const attributes = new Map();
  let at = START.lastIndex;
  for (let attr = matchAt(ATTR, svg, at); attr; attr = matchAt(ATTR, svg, at)) {
    const value = attr[2] ?? attr[3] ?? "";
    if (attributes.has(attr[1])) fail(`<${name}> に属性 ${attr[1]} が 2 つある`);
    checkAttribute(attr[1], value);
    attributes.set(attr[1], value);
    at = ATTR.lastIndex;
  }
  // 書き出すときは xlink:href を href にするので、両方があると同じ名前の属性が 2 つになる。
  if (attributes.has("href") && attributes.has("xlink:href"))
    fail(`<${name}> に href と xlink:href の両方がある`);
  const close = matchAt(START_CLOSE, svg, at);
  if (!close)
    fail(`<${name}> の開始タグを読めない（引用符の無い値・値の無い属性・閉じないタグなど）`);
  return { name, attributes, selfClosing: close[1] === "/", end: START_CLOSE.lastIndex };
}

/**
 * @typedef {{ stack: ElementNode[], root?: ElementNode }} WalkState
 */

/**
 * pos から始まる終了タグを読み、対になる開始タグを閉じる。終了タグでなければ -1 を返す。
 * @param {string} svg
 * @param {number} pos
 * @param {WalkState} state
 */
function closeElement(svg, pos, state) {
  const end = matchAt(END, svg, pos);
  if (!end) return -1;
  if (state.stack.pop()?.name !== end[1])
    fail(`終了タグ </${end[1]}> が開始タグと対になっていない`);
  return END.lastIndex;
}

/**
 * pos から始まる開始タグを読み、親の要素の子に加える。ルートの要素なら記録する。
 * @param {string} svg
 * @param {number} pos
 * @param {WalkState} state
 */
function openElement(svg, pos, state) {
  const tag = readStartTag(svg, pos);
  /** @type {ElementNode} */
  const node = { type: "element", name: tag.name, attributes: tag.attributes, children: [] };
  const parent = state.stack.at(-1);
  if (parent) {
    // HTML のパーサは、SVG の title と desc の中を HTML として読むので、要素を置くと木の形が XML と変わる。
    if (TEXT_ELEMENTS.has(parent.name)) fail(`<${parent.name}> の中に要素 <${tag.name}> がある`);
    if (state.stack.length >= MAX_DEPTH) fail(`要素の入れ子が ${MAX_DEPTH} 段を超える`);
    parent.children.push(node);
  } else {
    if (state.root) fail("ルートの要素が 2 つ以上ある");
    if (tag.name !== "svg") fail("<svg> がありません");
    state.root = node;
  }
  if (!tag.selfClosing) state.stack.push(node);
  return tag.end;
}

/**
 * アイコンの SVG が許可した範囲に収まるかを確かめて読み、ルートの <svg> の属性と子を返す。
 * 収まらなければ、理由を書いたエラーを投げる。
 * @param {string} svg
 * @returns {{ attributes: Map<string, string>, children: IconNode[] }}
 */
export function validateIconSvg(svg) {
  // 先頭の BOM と XML 宣言は読み飛ばす。XML 宣言は先頭にしか置けないので、ほかの位置にある処理命令の形（`<?`）はエラーになる。
  let pos = svg.startsWith("\uFEFF") ? 1 : 0;
  if (matchAt(XML_DECL, svg, pos)) pos = XML_DECL.lastIndex;
  /** @type {WalkState} */
  const state = { stack: [] };
  while (pos < svg.length) {
    const text = matchAt(TEXT, svg, pos);
    if (text) {
      const parent = state.stack.at(-1);
      if (checkText(text[0], parent?.name) && parent)
        parent.children.push({ type: "text", text: text[0] });
      pos = TEXT.lastIndex;
      continue;
    }
    const next = closeElement(svg, pos, state);
    pos = next >= 0 ? next : openElement(svg, pos, state);
  }
  const { root, stack } = state;
  if (!root) fail("<svg> がありません");
  if (stack.length) fail(`閉じていない要素 <${stack.at(-1)?.name}> がある`);
  return { attributes: root.attributes, children: root.children };
}

/**
 * 属性を書き出す。id と、id を指す参照（href・xlink:href・url(#...)）には接頭辞を付ける。
 * xlink:href は href にする。図の <svg> は xlink の名前空間を宣言しないので、接頭辞を残すと XML として読めない。
 * @param {string} name
 * @param {string} value 検査を通った値（`<`・`\`・定義済みでない実体を含まない）
 * @param {string} prefix
 */
function serializeAttribute(name, value, prefix) {
  let out = "";
  let last = 0;
  for (const url of readFunctions(name, value)) {
    out += `${value.slice(last, url.start)}url(#${prefix}${url.id})`;
    last = url.end;
  }
  out += value.slice(last);
  let outName = name;
  if (name === "id") out = prefix + out;
  if (name === "href" || name === "xlink:href") {
    outName = "href";
    out = `#${prefix}${value.slice(1)}`;
  }
  return ` ${outName}="${out.replaceAll('"', "&quot;")}"`;
}

/**
 * @param {IconNode} node
 * @param {string} prefix
 * @returns {string}
 */
function serializeNode(node, prefix) {
  if (node.type === "text") return node.text;
  const attrs = [...node.attributes].map(([n, v]) => serializeAttribute(n, v, prefix)).join("");
  if (!node.children.length) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${serializeIconBody(node.children, prefix)}</${node.name}>`;
}

/**
 * validateIconSvg が読んだルートの子を、SVG の文字列として書き出す。
 * 同じアイコンを図に何度も埋め込むので、id とその参照に埋め込みごとの接頭辞を付けて、埋め込みの間で id が重ならないようにする。
 * @param {IconNode[]} children
 * @param {string} prefix
 * @returns {string}
 */
export function serializeIconBody(children, prefix) {
  return children.map((node) => serializeNode(node, prefix)).join("");
}
