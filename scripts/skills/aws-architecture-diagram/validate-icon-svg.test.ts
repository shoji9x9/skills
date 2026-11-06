// aws-architecture-diagram のアイコンの SVG が、許可した要素・属性・構文に収まるかを確かめて読み、書き出す部品のテスト（Issue #923）。
//
// 確かめる状態は次のとおりである。
//   - 受け付ける形: XML 宣言の有無 / 先頭の BOM / 自己終端のルート / 引用符（" と '） / = の前後と属性の間の空白・改行
//   - 受け付ける値: 属性の値の定義済みの実体 / <title> の文字の実体・文字参照・> / 同じ文書の中を指す url() と href /
//     許可した関数（rgb()・translate() など） / viewBox の区切り（空白・カンマ）
//   - 書き出し: 二重引用符にそろえる / 値の中の " / 文字と属性の値に現れる on...= と http-equiv（変えない） /
//     id と参照の接頭辞（' を含む id、値の中の id=、大文字の URL(） / xlink:href を href にする
//   - 要素: script を実行させる要素・許可していない要素・大文字・名前空間の接頭辞 / title の中の要素 / 入れ子の深さ
//   - 属性の名前と参照: on*・style・許可していない属性 / 外を指す href・xlink:href・url() / href と xlink:href の両方
//   - 属性の値: 許可していない関数（src() など） / 名前空間の値 / 4 つの数値でない viewBox /
//     値の中の数値の文字参照・定義済みでない実体・\・<・XML で使えない文字
//   - 開始タグ: 引用符の無い値・値の無い属性・重複・XML の空白でない区切り
//   - 構文: コメント・DOCTYPE・CDATA・処理命令・先頭でない XML 宣言 / 対にならない終了タグ・閉じない要素・2 つのルート /
//     ルートでない <svg>・空の入力 / ルートの外と <title> 以外の中の文字 /
//     <title> の中の定義済みでない実体・単独の &・]]>・XML で使えない文字と文字参照
//   - 時間: PR #922 で 2 乗の時間になった形と、許可した範囲に収まる 1 MB の入力 / 一致しない長い数を含む viewBox
//   - 入れ子の境界: ルートを含めて 64 段は受け付け、65 段はエラーにする
// 期待値は、部品の冒頭のコメントに書いた受け付ける範囲（許可リストと構文）と書き出し方から決める。

import { expect, test } from "vitest";
import {
  serializeIconBody,
  validateIconSvg,
} from "../../../skills/aws-architecture-diagram/scripts/lib/validate-icon-svg.mjs";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (body: string, attrs = "") => `<svg ${NS}${attrs}>${body}</svg>`;
const XLINK = ' xmlns:xlink="http://www.w3.org/1999/xlink"';
const body = (input: string, prefix = "") =>
  serializeIconBody(validateIconSvg(input).children, prefix);

test.each([
  ["XML 宣言", `<?xml version="1.0" encoding="UTF-8"?>${svg("<rect/>")}`, "<rect/>"],
  ["先頭の BOM", `\uFEFF<?xml version="1.0"?>${svg("<rect/>")}`, "<rect/>"],
  ["XML 宣言の無い BOM", `\uFEFF${svg("<rect/>")}`, "<rect/>"],
  ["自己終端のルート", `<svg ${NS} viewBox="0 0 1 1"/>`, ""],
  ["一重引用符", svg("<rect fill='red'/>"), '<rect fill="red"/>'],
  ['一重引用符の値の中の "', svg("<g class='a\"b'/>"), '<g class="a&quot;b"/>'],
  ["= の前後と属性の間の空白と改行", svg('<rect\n\tx = "1"\r\n y="2" />'), '<rect x="1" y="2"/>'],
  ["要素の間の空白", svg("\n  <g>\n    <rect/>\n  </g>\n"), "<g><rect/></g>"],
  ["属性の値の定義済みの実体", svg('<g id="A-&amp;-B"/>'), '<g id="A-&amp;-B"/>'],
  [
    "title の文字の実体と文字参照と >",
    svg("<title>a &amp; b &lt; c &#38; &#x26; &#x1F600; d > e</title>"),
    "<title>a &amp; b &lt; c &#38; &#x26; &#x1F600; d > e</title>",
  ],
  [
    "許可した関数",
    svg('<rect fill="rgb(0, 0, 0)" transform="translate(1 2) rotate(45) skewX(3)"/>'),
    '<rect fill="rgb(0, 0, 0)" transform="translate(1 2) rotate(45) skewX(3)"/>',
  ],
  // 文脈を見ずに取り除く作り（strip-active-content.mjs）が書き換えていた形も、書き換えずに返す。
  [
    "文字と属性の値に現れる on...= と http-equiv",
    svg('<title>on=demand http-equiv</title><g class="a onclick=b http-equiv"/>'),
    '<title>on=demand http-equiv</title><g class="a onclick=b http-equiv"/>',
  ],
])("%s", (_label, input, expected) => {
  expect(body(input)).toBe(expected);
});

test.each([
  ["空白の区切り", "0 0 32 16"],
  ["カンマの区切り", "0,0,32,16"],
  ["カンマと空白の区切り", " -1.5, 0 ,3e1\t16 "],
])("viewBox の%sを受け付ける", (_label, viewBox) => {
  expect(validateIconSvg(`<svg ${NS} viewBox="${viewBox}"/>`).attributes.get("viewBox")).toBe(
    viewBox,
  );
});

test("id とその参照に接頭辞を付け、xlink:href は href にする", () => {
  const input = svg(
    '<defs><linearGradient id="g"/><clipPath id=\'c\'/><g id="a\'b"/></defs>' +
      '<rect fill="url(#g)" clip-path="url(\'#c\')" stroke="URL( #g )"/>' +
      "<use href=\"#a'b\"/><use xlink:href='#c'/>" +
      '<g class="a id=" fill="b"/>',
    XLINK,
  );
  expect(body(input, "p-")).toBe(
    '<defs><linearGradient id="p-g"/><clipPath id="p-c"/><g id="p-a\'b"/></defs>' +
      '<rect fill="url(#p-g)" clip-path="url(#p-c)" stroke="url(#p-g)"/>' +
      '<use href="#p-a\'b"/><use href="#p-c"/>' +
      // 値の中の `id=` は属性の名前ではないので、書き換えない。
      '<g class="a id=" fill="b"/>',
  );
});

test("ルートの <svg> の属性を返す", () => {
  const { attributes } = validateIconSvg(`<svg ${NS} viewBox='0 0 32 16' width="32"><rect/></svg>`);
  expect(attributes.get("viewBox")).toBe("0 0 32 16");
  expect(attributes.get("width")).toBe("32");
});

test.each([
  ["script の要素", svg("<script>alert(1)</script>"), /許可していない要素 <script>/],
  [
    "foreignObject の要素",
    svg("<foreignObject><div/></foreignObject>"),
    /許可していない要素 <foreignObject>/,
  ],
  ["iframe の要素", svg('<iframe src="x"/>'), /許可していない要素 <iframe>/],
  ["object の要素", svg('<object data="x"/>'), /許可していない要素 <object>/],
  ["meta の要素", svg('<meta http-equiv="refresh"/>'), /許可していない要素 <meta>/],
  ["a の要素", svg('<a href="#x"><rect/></a>'), /許可していない要素 <a>/],
  ["大文字の要素名", svg("<RECT/>"), /許可していない要素 <RECT>/],
  ["名前空間の接頭辞の付いた要素名", svg("<svg:rect/>"), /許可していない要素 <svg:rect>/],
  ["ルートが svg でない", "<html>not an svg</html>", /許可していない要素 <html>/],
  ["許可した要素のルートが svg でない", "<g><rect/></g>", /<svg> がありません/],
  ["on* の属性", svg('<rect onclick="a()"/>'), /許可していない属性 onclick/],
  ["ルートの on* の属性", `<svg ${NS} onload="a()"/>`, /許可していない属性 onload/],
  ["style の属性", svg('<rect style="fill:red"/>'), /許可していない属性 style/],
  ["xml:space の属性", svg('<g xml:space="preserve"/>'), /許可していない属性 xml:space/],
  ["javascript: の href", svg('<use href="javascript:alert(1)"/>'), /属性 href が同じ文書の中/],
  [
    "外を指す xlink:href",
    svg('<use xlink:href="https://e.example/a.svg#x"/>'),
    /属性 xlink:href が同じ文書の中/,
  ],
  ["空の href", svg('<use href=""/>'), /属性 href が同じ文書の中/],
  [
    "外を指す url()",
    svg('<rect fill="url(https://e.example/x)"/>'),
    /属性 fill の url\(\) が同じ文書の中/,
  ],
  ["大文字の URL()", svg('<rect fill="URL(x)"/>'), /属性 fill の url\(\) が同じ文書の中/],
  [
    "同じ文書の中の url() の後の外を指す url()",
    svg('<rect fill="url(#a) url(x)"/>'),
    /属性 fill の url\(\)/,
  ],
  ["SVG でない名前空間", `<svg xmlns="http://www.w3.org/1999/xhtml"/>`, /属性 xmlns の名前空間/],
  [
    "XLink でない名前空間",
    `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xhtml"/>`,
    /属性 xmlns:xlink の名前空間/,
  ],
  [
    "引用符を含む viewBox",
    `<svg ${NS} viewBox='0 0 1 1" onload="a()'/>`,
    /属性 viewBox の値が 4 つの数値でない/,
  ],
  ["英字を含む viewBox", `<svg ${NS} viewBox="0 0 a 1"/>`, /属性 viewBox の値が 4 つの数値でない/],
  ["カンマだけの viewBox", `<svg ${NS} viewBox=","/>`, /属性 viewBox の値が 4 つの数値でない/],
  ["3 つの数値の viewBox", `<svg ${NS} viewBox="0 0 1"/>`, /属性 viewBox の値が 4 つの数値でない/],
  [
    "2 つ続くカンマの viewBox",
    `<svg ${NS} viewBox="0,,0,1,1"/>`,
    /属性 viewBox の値が 4 つの数値でない/,
  ],
  ["符号だけの viewBox", `<svg ${NS} viewBox="- 0 1 1"/>`, /属性 viewBox の値が 4 つの数値でない/],
  [
    "src() の関数",
    svg("<rect fill=\"src('https://e.example/x')\"/>"),
    /許可していない関数 src\(\)/,
  ],
  ["image() の関数", svg('<rect fill="image(x)"/>'), /許可していない関数 image\(\)/],
  [
    "href と xlink:href の両方",
    svg('<use href="#a" xlink:href="#b"/>', XLINK),
    /href と xlink:href の両方/,
  ],
  ["属性の値の制御文字", svg('<g id="a\u0001"/>'), /属性 id の値に、XML で使えない文字/],
  [
    "属性の値の対にならないサロゲート",
    svg('<g id="a\uD800"/>'),
    /属性 id の値に、XML で使えない文字/,
  ],
  ["title の中の制御文字", svg("<title>a\u0001b</title>"), /<title> の文字に、XML で使えない文字/],
  ["title の中の &#0;", svg("<title>&#0;</title>"), /XML で使えない文字を指す文字参照/],
  [
    "title の中のサロゲートの文字参照",
    svg("<title>&#xD800;</title>"),
    /XML で使えない文字を指す文字参照/,
  ],
  [
    "title の中の範囲外の文字参照",
    svg("<title>&#x110000;</title>"),
    /XML で使えない文字を指す文字参照/,
  ],
  [
    "title の中の要素",
    svg("<title><title>x</title><rect/></title>"),
    /<title> の中に要素 <title> がある/,
  ],
  ["desc の中の要素", svg("<desc><g/></desc>"), /<desc> の中に要素 <g> がある/],
  ["深すぎる入れ子", svg("<g>".repeat(64) + "</g>".repeat(64)), /要素の入れ子が 64 段を超える/],
  ["属性の値の数値の文字参照", svg('<rect id="&#97;"/>'), /属性 id の値に/],
  // 数値の文字参照で url( を作ると、関数の判定は url( を見つけないので、値の判定だけが止める。
  [
    "属性の値の数値の文字参照で作った url(",
    svg('<rect fill="&#117;&#114;&#108;(x)"/>'),
    /属性 fill の値に <・/,
  ],
  ["名前が url で終わる関数", svg('<rect fill="xurl(#a)"/>'), /許可していない関数 xurl\(\)/],
  [
    "名前が url で終わる別の関数",
    svg('<rect clip-path="srcurl(#b)"/>'),
    /許可していない関数 srcurl\(\)/,
  ],
  ["ASCII 以外の文字で始まる関数", svg('<rect fill="éurl(#a)"/>'), /許可していない関数 éurl\(\)/],
  ["名前の前に数字がある url(", svg('<rect fill="1url(#a)"/>'), /関数の形でない括弧/],
  ["関数の形でない括弧", svg('<rect fill="(x)"/>'), /関数の形でない括弧/],
  ["属性の値の定義済みでない実体", svg('<rect id="a&nbsp;b"/>'), /属性 id の値に/],
  ["属性の値の単独の &", svg('<rect id="a & b"/>'), /属性 id の値に/],
  ["属性の値の \\", svg('<rect fill="u\\72l(x)"/>'), /属性 fill の値に <・/],
  ["属性の値の <", svg('<rect id="a<b"/>'), /属性 id の値に/],
  ["引用符の無い値", svg("<rect x=1/>"), /<rect> の開始タグを読めない/],
  ["値の無い属性", svg("<rect hidden/>"), /<rect> の開始タグを読めない/],
  ["閉じない開始タグ", `<svg ${NS}><rect x="1"`, /<rect> の開始タグを読めない/],
  ["XML の空白でない属性の区切り", svg('<rect\u00a0x="1"/>'), /<rect> の開始タグを読めない/],
  ["重複した属性", svg('<rect x="1" x="2"/>'), /<rect> に属性 x が 2 つある/],
  ["コメント", svg("<!-- c --><rect/>"), /読めない構文/],
  ["DOCTYPE", `<!DOCTYPE svg [<!ENTITY e "x">]>${svg("<rect/>")}`, /読めない構文/],
  ["CDATA", svg("<title><![CDATA[x]]></title>"), /読めない構文/],
  ["処理命令", svg('<?xml-stylesheet href="x.css"?><rect/>'), /読めない構文/],
  ["先頭でない XML 宣言", ` <?xml version="1.0"?>${svg("<rect/>")}`, /読めない構文/],
  ["対にならない終了タグ", svg("<g></rect>"), /終了タグ <\/rect> が開始タグと対になっていない/],
  ["開始タグの無い終了タグ", `${svg("")}</g>`, /終了タグ <\/g> が開始タグと対になっていない/],
  ["閉じない要素", `<svg ${NS}><g>`, /閉じていない要素 <g>/],
  ["2 つのルート", `${svg("")}${svg("")}`, /ルートの要素が 2 つ以上ある/],
  ["空の入力", "", /<svg> がありません/],
  ["空白だけの入力", " \n", /<svg> がありません/],
  ["ルートの外の文字", `x${svg("")}`, /<svg> の外に文字がある/],
  ["ルートの後の文字", `${svg("")}x`, /<svg> の外に文字がある/],
  ["title 以外の中の文字", svg("<g>x</g>"), /<g> の中に文字がある/],
  [
    "title の中の定義済みでない実体",
    svg("<title>&nbsp;</title>"),
    /<title> の文字に、定義済みでない実体/,
  ],
  ["title の中の単独の &", svg("<title>a & b</title>"), /<title> の文字に、定義済みでない実体/],
  ["title の中の ]]>", svg("<title>a ]]> b</title>"), /<title> の文字に \]\]> がある/],
])("%s はエラーにする", (_label, input, reason) => {
  expect(() => validateIconSvg(input)).toThrow(reason);
});

const MB = 1024 * 1024;
const fill = (unit: string, prefix = "", suffix = "") =>
  prefix + unit.repeat(Math.floor((MB - prefix.length - suffix.length) / unit.length)) + suffix;

// PR #922 で、文字列の形で取り除く作りの処理時間が入力の長さの 2 乗で増えた形（入れ子・`>` の無い `<script` の並び・
// 閉じない `<script>` の並び）と、許可した範囲に収まる大きな入力を、1 MB で確かめる。
test.each([
  ["<script の入れ子", fill("<scr", `<svg ${NS}>`, "<script>x</script>" + "ipt>".repeat(1000))],
  ["> の無い <script の並び", fill("<script ", `<svg ${NS}>`)],
  ["閉じない <script> の並び", fill("<script>", `<svg ${NS}>`)],
  ["閉じない引用符", fill("a", `<svg ${NS}><rect id="`)],
])("1 MB の %s は 1 秒以内にエラーにする", (_label, input) => {
  const started = performance.now();
  expect(() => validateIconSvg(input)).toThrow();
  expect(performance.now() - started).toBeLessThan(1000);
});

test("許可した範囲に収まる 1 MB の入力は 1 秒以内に受け付ける", () => {
  const input = fill('<rect x="1" y="2"/>', `<svg ${NS}>`, "</svg>");
  const started = performance.now();
  expect(body(input).length).toBeGreaterThan(MB - 100);
  expect(performance.now() - started).toBeLessThan(1000);
});

test("ルートの <svg> を含めて 64 段の入れ子は受け付ける", () => {
  expect(body(svg("<g>".repeat(63) + "</g>".repeat(63)))).toBe(
    "<g>".repeat(63).replace(/<g>$/, "<g/>") + "</g>".repeat(62),
  );
});

test("一致しない長い数を含む viewBox は 1 秒以内にエラーにする", () => {
  const started = performance.now();
  expect(() => validateIconSvg(`<svg ${NS} viewBox="0 0 1 ${"1".repeat(50_000)}x"/>`)).toThrow(
    /属性 viewBox の値が 4 つの数値でない/,
  );
  expect(performance.now() - started).toBeLessThan(1000);
});
