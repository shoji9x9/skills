// アイコンの SVG が、決めた範囲（許可した要素・属性・構文）に収まるかを確かめる部品。
// 範囲から外れたアイコンは書き換えずにエラーにし、図に埋め込まない（diagram-engine.mjs）。
//
// XML の仕様全体は読まない。受け付けるのは、先頭の XML 宣言・要素・属性・文字と、文字の中の定義済みの実体と数値の文字参照だけである。
// コメント・DOCTYPE・CDATA・処理命令は解釈せずにエラーにする。迷う入力をすべてエラーにするので、ブラウザと読み方がずれる入力は残らない。
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
// 定義済みの実体と数値の文字参照でない `&`。
const BAD_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+);)/;
// 同じ文書の中を指す url()。これを除いた後に `url(` が残れば、外を指す URL である。
const LOCAL_URL = /url\([ \t\r\n]*(["']?)#[^ \t\r\n"'()]+\1[ \t\r\n]*\)/gi;

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
 * 属性の名前と値が、許可した範囲に収まるかを確かめる。
 * @param {string} name
 * @param {string} value
 */
function checkAttribute(name, value) {
  if (!ATTRIBUTES.has(name)) fail(`許可していない属性 ${name} がある`);
  // 数値の文字参照（`&#117;`）は英字や括弧を作れるので、`url(`・`javascript:` を隠せる。属性の値では受け付けない。
  // 定義済みの実体（`&amp;` など。AWS のアイコンは id に使う）は英字も括弧も作らないので受け付ける。
  // `\` は CSS のエスケープになるので受け付けない。
  if (/[<\\]|&(?!(?:amp|lt|gt|quot|apos);)/.test(value))
    fail(`属性 ${name} の値に <・\\・数値の文字参照・定義済みでない実体がある`);
  const ns = NAMESPACES.get(name);
  if (ns !== undefined && value !== ns) fail(`属性 ${name} の名前空間が ${ns} でない`);
  // ルートの viewBox は、描画エンジンが二重引用符で囲んで出力する。一重引用符の値の `"` で属性を足せないように、数値と区切りだけを受け付ける。
  if (name === "viewBox" && !/^[-+.\deE \t\r\n,]+$/.test(value))
    fail(`属性 viewBox の値が数値と区切りでない`);
  if ((name === "href" || name === "xlink:href") && !/^#[^ \t\r\n]+$/.test(value))
    fail(`属性 ${name} が同じ文書の中（#...）を指していない`);
  if (/url\(/i.test(value.replace(LOCAL_URL, "")))
    fail(`属性 ${name} の url() が同じ文書の中（#...）を指していない`);
}

/**
 * 文字が、置いた要素で許可した範囲に収まるかを確かめる。
 * @param {string} text
 * @param {string | undefined} parent 文字を置いた要素の名前（ルートの外なら undefined）
 */
function checkText(text, parent) {
  if (parent === undefined || !TEXT_ELEMENTS.has(parent)) {
    if (/[^ \t\r\n]/.test(text)) fail(`<${parent ?? "svg"}> の${parent ? "中" : "外"}に文字がある`);
    return;
  }
  if (BAD_ENTITY.test(text)) fail(`<${parent}> の文字に、定義済みでない実体か単独の & がある`);
  if (text.includes("]]>")) fail(`<${parent}> の文字に ]]> がある`);
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
  const close = matchAt(START_CLOSE, svg, at);
  if (!close)
    fail(`<${name}> の開始タグを読めない（引用符の無い値・値の無い属性・閉じないタグなど）`);
  return { name, attributes, selfClosing: close[1] === "/", end: START_CLOSE.lastIndex };
}

/**
 * @typedef {{ attributes: Map<string, string>, bodyStart: number, bodyEnd: number }} RootElement
 * @typedef {{ stack: string[], root?: RootElement }} WalkState
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
  if (state.stack.pop() !== end[1]) fail(`終了タグ </${end[1]}> が開始タグと対になっていない`);
  if (!state.stack.length && state.root) state.root.bodyEnd = end.index;
  return END.lastIndex;
}

/**
 * pos から始まる開始タグを読み、ルートの要素なら記録する。
 * @param {string} svg
 * @param {number} pos
 * @param {WalkState} state
 */
function openElement(svg, pos, state) {
  const tag = readStartTag(svg, pos);
  if (!state.stack.length) {
    if (state.root) fail("ルートの要素が 2 つ以上ある");
    if (tag.name !== "svg") fail("<svg> がありません");
    state.root = { attributes: tag.attributes, bodyStart: tag.end, bodyEnd: tag.end };
  }
  if (!tag.selfClosing) state.stack.push(tag.name);
  return tag.end;
}

/**
 * アイコンの SVG が許可した範囲に収まるかを確かめ、ルートの <svg> の属性と中身を返す。
 * 収まらなければ、理由を書いたエラーを投げる。
 * @param {string} svg
 * @returns {{ attributes: Map<string, string>, body: string }}
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
      checkText(text[0], state.stack.at(-1));
      pos = TEXT.lastIndex;
      continue;
    }
    const next = closeElement(svg, pos, state);
    pos = next >= 0 ? next : openElement(svg, pos, state);
  }
  const { root, stack } = state;
  if (!root) fail("<svg> がありません");
  if (stack.length) fail(`閉じていない要素 <${stack.at(-1)}> がある`);
  return { attributes: root.attributes, body: svg.slice(root.bodyStart, root.bodyEnd) };
}
