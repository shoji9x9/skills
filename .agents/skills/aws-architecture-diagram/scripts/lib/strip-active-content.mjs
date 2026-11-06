// SVG から <script> 要素と on* のイベントハンドラの属性を取り除く部品。
// 図に埋め込むアイコン（diagram-engine.mjs）と、Chrome で開くプレビュー（preview-diagram.mjs）で使う。
// 自前で生成した SVG には、どちらも含まれないので何も変えない。

// 終了タグは、ブラウザと同じく空白の後の属性の形（`</script foo>`）も終了タグとして扱う。
// 対になる終了タグが無い開始タグと、開始タグの無い終了タグも取り除く（残すと HTML の中で後ろが script として読まれる）。
// 名前空間の接頭辞を付けた `<a:script>` も、XML として開くと script として実行されるので取り除く。
// 属性の区切りには、空白に加えて `/` も使える（`<svg/onload=...>`）。
// HTML は、引用符で囲んだ値の直後に空白を置かずに続く属性（`width="1"onclick=...`）も属性として読む。
// そのため、引用符の直後の on* も取り除く。引用符は前の属性の値の終わりなので、消さずに残す。
const PATTERNS = [
  /<(?:[\w.-]+:)?script\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?script\b[^>]*>/gi,
  /<\/?(?:[\w.-]+:)?script\b[^>]*>/gi,
  /(?:[\s/]|(?<=["']))on[a-z]+\s*=\s*"[^"]*"/gi,
  /(?:[\s/]|(?<=["']))on[a-z]+\s*=\s*'[^']*'/gi,
  // クォート無しの on* も除去（値内の `/` は許すが、自己終端 `/>` の `/` は食わない）。
  /(?:[\s/]|(?<=["']))on[a-z]+\s*=\s*(?:[^\s"'>/]|\/(?!>))*/gi,
];

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
    for (const pattern of PATTERNS) current = current.replace(pattern, "");
  } while (current !== previous);
  return current;
}
