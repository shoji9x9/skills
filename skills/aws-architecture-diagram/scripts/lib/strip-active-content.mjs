// SVG から <script> 要素と on* のイベントハンドラの属性を取り除く部品。
// 図に埋め込むアイコン（diagram-engine.mjs）と、Chrome で開くプレビュー（preview-diagram.mjs）で使う。
// 自前で生成した SVG には、どちらも含まれないので何も変えない。
//
// タグや属性を構文として読まず、文脈を見ずに文字列全体から取り除く。
// SVG は HTML としても XML としても読まれ、XML にはコメント・CDATA・処理命令・実体の宣言がある。
// 構文として読む処理は、読めなかった文脈にあるハンドラを残してしまう。
// そのため、要素の中の文字や属性の値に `on...=` の形が現れると、そこも取り除く（安全側に扱う）。

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
// on* の属性。前は空白か `/`（`<svg/onload=...>`）か、引用符で閉じた値の直後（`width="1"onclick=...`）である。
// 引用符は前の属性の値の終わりなので、消さずに残す。
// 値は、二重引用符・一重引用符・引用符なしの順に試す。引用符なしを先に試すと、` onclick=` だけを消して `"..."` を残す。
// 引用符なしの値の中の `/` は許すが、自己終端 `/>` の `/` は消さない。
const HANDLER = /(?:[\s/]|(?<=["']))on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|(?:[^\s"'>/]|\/(?!>))*)/gi;

/**
 * 1 回の置換では、入れ子（`<scr<script>x</script>ipt>`・`o onclick="x"nclick=...`）のように、
 * 取り除いた後に新しく現れる形を取りこぼす。そのため、結果が変わらなくなるまで繰り返す。
 * @param {string} svg
 * @returns {string}
 */
export function stripActiveContent(svg) {
  let current = svg;
  let previous;
  do {
    previous = current;
    current = current.replace(SCRIPT_ELEMENT, "").replace(SCRIPT_TAG, "").replace(HANDLER, "");
  } while (current !== previous);
  return current;
}
