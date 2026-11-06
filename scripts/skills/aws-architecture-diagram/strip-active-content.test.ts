// aws-architecture-diagram の SVG から <script> 要素と on* の属性を取り除く部品のテスト（Issue #921）。
//
// 確かめる状態は次のとおりである。
//   - <script> の形: 対の開始と終了 / 自己終端 / 終了タグの空白の後の属性 / 入れ子 / 対の無い開始タグと終了タグ / 大文字 /
//     名前空間の接頭辞（ASCII と ASCII 以外）
//   - <meta> の http-equiv: 大文字 / 閉じないタグ / 取り除いた後に現れる形 / 変えないもの（<meta> の要素・<metadata>）
//   - on* の属性: 引用符（" と ' と無し） / 区切りが空白か `/` か引用符の直後 / 入れ子 / 値の中の `>` と引用符 /
//     XML にだけある文脈（ASCII 以外で始まるタグ名・コメント・実体の宣言）
//   - 取り除かないもの: スクリプトでない要素と属性（`<scripted>`・`<script-x>`・`data-on`・`d` の値）
//   - 安全側に取り除くもの: 要素の中の文字と属性の値に現れる `on...=`
// 期待値は、HTML と XML がその出力を読んだときに script・ハンドラ・http-equiv が残らないことと、部品のコメントに書いた取り除き方
// （on* を取り除いた所に空白を 1 つ置く）から決める。

import { expect, test } from "vitest";
import { stripActiveContent } from "../../../skills/aws-architecture-diagram/scripts/lib/strip-active-content.mjs";

test.each([
  ["対の開始と終了", "<g><script>alert(1)</script></g>", "<g></g>"],
  ["自己終端", '<g><script src="x.js"/></g>', "<g></g>"],
  ["終了タグの空白の後の属性", "<g><script>a</script\tfoo></g>", "<g></g>"],
  // 内側の対を取り除いた後に現れる外側の開始タグと終了タグも、繰り返しで取り除く。中身は文字として残る。
  ["入れ子", "<g><scr<script>x</script>ipt>alert(1)</script></g>", "<g>alert(1)</g>"],
  // 対の無い終了タグを取り除いて初めて対が現れる形は、2 回目の置換で取り除く。
  ["取り除いた後に現れる対", "<g><scr</script>ipt>a</scr</script>ipt></g>", "<g></g>"],
  ["対の無い開始タグ", "<g><script>alert(1)</g>", "<g>alert(1)</g>"],
  ["対の無い終了タグ", "<g>a</script ></g>", "<g>a</g>"],
  ["大文字", "<g><SCRIPT>a</SCRIPT></g>", "<g></g>"],
  ["on* の二重引用符", '<rect onclick="a()" width="1"/>', '<rect  width="1"/>'],
  ["on* の一重引用符", "<rect onload='b()' width=\"2\"/>", '<rect  width="2"/>'],
  ["on* の引用符無し", '<rect onmouseover=c() width="3"/>', '<rect  width="3"/>'],
  ["on* の区切りが /", "<svg/onload=alert(1)>", "<svg >"],
  // HTML は、引用符の直後に空白なしで続く on* も属性として読む。引用符は前の値の終わりなので残す。
  ["引用符の直後の on*", '<rect width="1"onclick="a()"/>', '<rect width="1" />'],
  // 取り除いた所に空白を置くので、次の属性の名前がタグ名とつながらない。
  ["on* の直後に続く属性", '<rect onclick="x"width="1"/>', '<rect width="1"/>'],
  ["一重引用符の直後の on*", "<rect width='1'onload=b()>", "<rect width='1' >"],
  ["引用符で囲んだ値の中の >", '<rect title="a>b" onclick="x"/>', '<rect title="a>b" />'],
  ["引用符で囲まない値の中の引用符", "<svg x=b'c onload=alert(1)>", "<svg x=b'c >"],
  ["名前空間の接頭辞", '<g><a:script xmlns:a="x">alert(1)</a:script></g>', "<g></g>"],
  ["ASCII 以外の名前空間の接頭辞", '<g><é:script xmlns:é="x">alert(1)</é:script></g>', "<g></g>"],
  // 取り除いた所に空白を置くので、前後の文字がつながって新しい on* にならない。
  ["on* の入れ子", '<rect o onclick="x"nclick="y" width="4"/>', '<rect o nclick="y" width="4"/>'],
  // 構文として読まないので、ASCII 以外で始まるタグ名・コメントの中の閉じない引用符・実体の宣言の中でも取り除く。
  [
    "ASCII 以外で始まるタグ名の on*",
    '<é:rect xmlns:é="x" onclick="alert(1)"/>',
    '<é:rect xmlns:é="x" />',
  ],
  [
    "コメントの中の閉じない引用符の後の on*",
    '<!-- <a title=" --><rect onclick="alert(1)"/>',
    '<!-- <a title=" --><rect />',
  ],
  [
    "実体の宣言の中の on*",
    `<!DOCTYPE svg [<!ENTITY e "&#60;rect onclick='alert(1)'/>">]><svg>&e;</svg>`,
    '<!DOCTYPE svg [<!ENTITY e "&#60;rect />">]><svg>&e;</svg>',
  ],
  [
    "名前が script で始まる別の要素",
    "<g><script-x>keep</script-x></g>",
    "<g><script-x>keep</script-x></g>",
  ],
  // 文脈を見ないので、要素の中の文字や属性の値に現れる `on...=` も取り除く（安全側に扱う）。
  ["要素の中の文字", '<text>see "online=1" here</text>', '<text>see " " here</text>'],
  ["属性の値の中の on...=", '<a href="/api/onload=1"/>', '<a href="/api "/>'],
  // 値は `<` をまたがないので、要素の中の文字の `on...=` が後ろの終了タグや要素を消さない。
  ["要素の中の文字の後の要素", "<text>a onx=b</text><rect/>", "<text>a </text><rect/>"],
  [
    "閉じない引用符の後の要素",
    '<text>a onx="</text><rect width="1"/>',
    '<text>a "</text><rect width="1"/>',
  ],
  // <meta http-equiv="refresh"> は、HTML に埋め込むとページを移動させる。移動に要る属性名を無効な名前にする。
  [
    "meta の http-equiv",
    '<g><meta http-equiv="refresh" content="0;url=x"/></g>',
    '<g><meta data-x-equiv="refresh" content="0;url=x"/></g>',
  ],
  ["http-equiv の大文字", '<META HTTP-EQUIV="refresh">', '<META data-x-equiv="refresh">'],
  // タグの形を読まないので、閉じないタグでも置き換える。
  [
    "閉じない meta",
    '<meta http-equiv="refresh" content="0;url=x"',
    '<meta data-x-equiv="refresh" content="0;url=x"',
  ],
  [
    "取り除いた後に現れる http-equiv",
    '<meta htt<script>x</script>p-equiv="refresh">',
    '<meta data-x-equiv="refresh">',
  ],
  // <meta> の要素そのものと、名前が meta で始まる別の要素は変えない。
  [
    "meta の要素と metadata",
    '<metadata><meta name="a"></meta></metadata>',
    '<metadata><meta name="a"></meta></metadata>',
  ],
  [
    "スクリプトでない要素と属性",
    '<scripted data-on="1" d="M0 0"/>',
    '<scripted data-on="1" d="M0 0"/>',
  ],
])("%s", (_label, input, expected) => {
  expect(stripActiveContent(input)).toBe(expected);
});
