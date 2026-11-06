// SVG から <script> 要素と on* のイベントハンドラの属性を取り除く部品。
// 図に埋め込むアイコン（diagram-engine.mjs）と、Chrome で開くプレビュー（preview-diagram.mjs）で使う。
// 自前で生成した SVG には、どちらも含まれないので何も変えない。

// script の要素名。名前空間の接頭辞（`<a:script>`・`<é:script>`）を付けた形も、XML として開くと script として実行される。
// 名前は空白・`/`・`>` で終わる所までなので、`<script-x>` のような別の要素には当てない。
const SCRIPT_NAME = String.raw`(?:[^\s<>/:="']+:)?script(?=[\s/>])`;
// 終了タグは、ブラウザと同じく空白の後の属性の形（`</script foo>`）も終了タグとして扱う。
const SCRIPT_ELEMENT = new RegExp(
  String.raw`<${SCRIPT_NAME}[^>]*>[\s\S]*?<\/${SCRIPT_NAME}[^>]*>`,
  "gi",
);
// 対になる終了タグが無い開始タグと、開始タグの無い終了タグ（残すと HTML の中で後ろが script として読まれる）。
const SCRIPT_TAG = new RegExp(String.raw`<\/?${SCRIPT_NAME}[^>]*>`, "gi");

/** @param {string | undefined} c */
const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

/**
 * k から、pred を満たす文字が続く間だけ進めた位置。
 * @param {string} s
 * @param {number} k
 * @param {(c: string) => boolean} pred
 */
function skipWhile(s, k, pred) {
  let t = k;
  while (t < s.length && pred(s[t] ?? "")) t++;
  return t;
}

/**
 * 属性の値の終わりの位置。引用符で囲んだ値は対の引用符まで、囲まない値は空白か `>` の前までである（HTML の読み方と同じ）。
 * 対の引用符が無ければ、ブラウザと同じく文字列の終わりまでを値として読む。
 * @param {string} s
 * @param {number} k 値の最初の文字の位置
 */
function valueEnd(s, k) {
  const quote = s[k];
  if (quote === '"' || quote === "'") {
    const close = s.indexOf(quote, k + 1);
    return close < 0 ? s.length : close + 1;
  }
  let t = k;
  while (t < s.length && !isSpace(s[t]) && s[t] !== ">") t++;
  return t;
}

/**
 * 属性 1 つの終わりの位置。名前の後に `=` があれば値まで含める。
 * @param {string} s
 * @param {number} start 属性の名前の最初の文字の位置
 * @returns {{ name: string, end: number }}
 */
function readAttribute(s, start) {
  let k = start + 1;
  while (k < s.length && !isSpace(s[k]) && s[k] !== "/" && s[k] !== ">" && s[k] !== "=") k++;
  const name = s.slice(start, k);
  let t = k;
  while (isSpace(s[t])) t++;
  if (s[t] !== "=") return { name, end: k };
  t++;
  while (isSpace(s[t])) t++;
  return { name, end: valueEnd(s, t) };
}

/**
 * 取り除いた属性の代わりに置く文字列。前が空白だけで、後ろにも区切りがあれば、前の空白も除く（空文字）。
 * そうでなければ空白を 1 つ置く。前の `/` が `/>`（自己終端）になることと、前後の属性の名前がつながることを防ぐ。
 * @param {string} separator 取り除いた属性の前の区切り
 * @param {string | undefined} next 取り除いた属性の直後の文字
 */
function replacementFor(separator, next) {
  const spaceOnly = /^\s+$/.test(separator);
  const separated = next === undefined || /[\s/>]/.test(next);
  return spaceOnly && separated ? "" : `${separator.trimEnd()} `;
}

/**
 * `<` の位置から始まる開始タグを読み、名前が on で始まる属性を除いた形にする。
 * 属性の区切りは、空白と `/` と、引用符で閉じた値の直後である（HTML は空白が無くても次の属性を読み始める）。
 * @param {string} s
 * @param {number} j
 * @returns {{ text: string, end: number }}
 */
function rewriteStartTag(s, j) {
  let k = skipWhile(s, j + 1, (c) => !isSpace(c) && c !== "/" && c !== ">");
  let text = s.slice(j, k);
  for (;;) {
    const sepStart = k;
    k = skipWhile(s, k, (c) => isSpace(c) || c === "/");
    const separator = s.slice(sepStart, k);
    if (k >= s.length) return { text: text + separator, end: s.length };
    if (s[k] === ">") return { text: `${text + separator}>`, end: k + 1 };
    const { name, end } = readAttribute(s, k);
    if (!/^on/i.test(name)) text += separator + s.slice(k, end);
    else text += replacementFor(separator, s[end]);
    k = end;
  }
}

/**
 * 開始タグの属性のうち、名前が on で始まるものを取り除く。属性の値と要素の中の文字は変えない。
 * 文字列を前から 1 回たどるので、処理時間は入力の長さに比例する。
 * @param {string} s
 */
function dropHandlers(s) {
  let out = "";
  let i = 0;
  for (;;) {
    const j = s.indexOf("<", i);
    if (j < 0) return out + s.slice(i);
    out += s.slice(i, j);
    if (!/[A-Za-z]/.test(s[j + 1] ?? "")) {
      out += "<";
      i = j + 1;
      continue;
    }
    const { text, end } = rewriteStartTag(s, j);
    out += text;
    i = end;
  }
}

/**
 * 1 回の置換では、入れ子（`<scr<script>x</script>ipt>`）のように、取り除いた後に新しく現れる形を取りこぼす。
 * そのため、結果が変わらなくなるまで繰り返す。
 * @param {string} svg
 * @returns {string}
 */
export function stripActiveContent(svg) {
  let current = svg;
  let previous;
  do {
    previous = current;
    current = dropHandlers(current.replace(SCRIPT_ELEMENT, "").replace(SCRIPT_TAG, ""));
  } while (current !== previous);
  return current;
}
