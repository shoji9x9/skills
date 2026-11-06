// aws-architecture-diagram のアイコンの SVG が、許可した要素・属性・構文に収まるかを確かめる部品のテスト（Issue #923）。
//
// 確かめる状態は次のとおりである。
//   - 受け付ける形: XML 宣言の有無 / 先頭の BOM / 自己終端のルート / 引用符（" と '） / = の前後と属性の間の空白・改行
//   - 受け付ける値: 属性の値の定義済みの実体 / <title> の文字の実体・文字参照・> / 同じ文書の中を指す url() と href
//   - 書き換えずに返す形: 文字と属性の値に現れる on...= と http-equiv
//   - 要素: script を実行させる要素・許可していない要素・大文字・名前空間の接頭辞
//   - 属性: on*・style・許可していない属性 / 外を指す href・xlink:href・url() / 名前空間の値 /
//     値の中の数値の文字参照・定義済みでない実体・\・< / 引用符の無い値・値の無い属性・重複・XML の空白でない区切り
//   - 構文: コメント・DOCTYPE・CDATA・処理命令・先頭でない XML 宣言 / 対にならない終了タグ・閉じない要素・2 つのルート /
//     ルートでない <svg>・空の入力 / ルートの外と <title> 以外の中の文字 / <title> の中の定義済みでない実体・単独の &・]]>
//   - 時間: PR #922 で 2 乗の時間になった形と、許可した範囲に収まる 1 MB の入力
// 期待値は、部品の冒頭のコメントに書いた受け付ける範囲（許可リストと構文）から決める。

import { expect, test } from "vitest";
import { validateIconSvg } from "../../../skills/aws-architecture-diagram/scripts/lib/validate-icon-svg.mjs";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (body: string, attrs = "") => `<svg ${NS}${attrs}>${body}</svg>`;

test.each([
  ["XML 宣言", `<?xml version="1.0" encoding="UTF-8"?>${svg("<rect/>")}`, "<rect/>"],
  ["先頭の BOM", `﻿<?xml version="1.0"?>${svg("<rect/>")}`, "<rect/>"],
  ["XML 宣言の無い BOM", `﻿${svg("<rect/>")}`, "<rect/>"],
  ["自己終端のルート", `<svg ${NS} viewBox="0 0 1 1"/>`, ""],
  ["一重引用符", svg("<rect fill='red'/>"), "<rect fill='red'/>"],
  [
    "= の前後と属性の間の空白と改行",
    svg('<rect\n\tx = "1"\r\n y="2" />'),
    '<rect\n\tx = "1"\r\n y="2" />',
  ],
  ["属性の値の定義済みの実体", svg('<g id="A-&amp;-B"/>'), '<g id="A-&amp;-B"/>'],
  [
    "title の文字の実体と文字参照と >",
    svg("<title>a &amp; b &lt; c &#38; &#x26; d > e</title>"),
    "<title>a &amp; b &lt; c &#38; &#x26; d > e</title>",
  ],
  [
    "同じ文書の中を指す url() と href",
    svg(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
        '<rect fill="url(#g)" clip-path="url(\'#c\')"/><use href="#g"/><use xlink:href=\'#c\'/>',
      ' xmlns:xlink="http://www.w3.org/1999/xlink"',
    ),
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
      '<rect fill="url(#g)" clip-path="url(\'#c\')"/><use href="#g"/><use xlink:href=\'#c\'/>',
  ],
  // 文脈を見ずに取り除く作り（strip-active-content.mjs）が書き換えていた形も、書き換えずに返す。
  [
    "文字と属性の値に現れる on...= と http-equiv",
    svg('<title>on=demand http-equiv</title><g class="a onclick=b http-equiv"/>'),
    '<title>on=demand http-equiv</title><g class="a onclick=b http-equiv"/>',
  ],
])("%s", (_label, input, body) => {
  expect(validateIconSvg(input).body).toBe(body);
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
    /属性 viewBox の値が数値と区切りでない/,
  ],
  ["英字を含む viewBox", `<svg ${NS} viewBox="0 0 a 1"/>`, /属性 viewBox の値が数値と区切りでない/],
  ["属性の値の数値の文字参照", svg('<rect fill="&#117;rl(x)"/>'), /属性 fill の値に/],
  ["属性の値の定義済みでない実体", svg('<rect id="a&nbsp;b"/>'), /属性 id の値に/],
  ["属性の値の単独の &", svg('<rect id="a & b"/>'), /属性 id の値に/],
  ["属性の値の \\", svg('<rect fill="u\\72l(x)"/>'), /属性 fill の値に/],
  ["属性の値の <", svg('<rect id="a<b"/>'), /属性 id の値に/],
  ["引用符の無い値", svg("<rect x=1/>"), /<rect> の開始タグを読めない/],
  ["値の無い属性", svg("<rect hidden/>"), /<rect> の開始タグを読めない/],
  ["閉じない開始タグ", `<svg ${NS}><rect x="1"`, /<rect> の開始タグを読めない/],
  ["XML の空白でない属性の区切り", svg('<rect x="1"/>'), /<rect> の開始タグを読めない/],
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
  expect(validateIconSvg(input).body.length).toBeGreaterThan(MB - 100);
  expect(performance.now() - started).toBeLessThan(1000);
});
