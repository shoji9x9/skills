// aws-architecture-diagram の SVG から <script> 要素と on* の属性を取り除く部品のテスト（Issue #921）。
//
// 確かめる状態は次のとおりである。
//   - <script> の形: 対の開始と終了 / 自己終端 / 終了タグの空白の後の属性 / 入れ子 / 対の無い開始タグと終了タグ / 大文字 / 名前空間の接頭辞
//   - on* の属性: 引用符（" と ' と無し） / 区切りが空白か `/` か引用符の直後 / 入れ子
//   - 取り除かないもの: スクリプトでない要素と属性（`<scripted>`・`data-on`・`d` の値）

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
  ["on* の二重引用符", '<rect onclick="a()" width="1"/>', '<rect width="1"/>'],
  ["on* の一重引用符", "<rect onload='b()' width=\"2\"/>", '<rect width="2"/>'],
  ["on* の引用符無し", '<rect onmouseover=c() width="3"/>', '<rect width="3"/>'],
  ["on* の区切りが /", "<svg/onload=alert(1)>", "<svg>"],
  // HTML は、引用符の直後に空白なしで続く on* も属性として読む。引用符は前の値の終わりなので残す。
  ["引用符の直後の on*", '<rect width="1"onclick="a()"/>', '<rect width="1"/>'],
  ["一重引用符の直後の on*", "<rect width='1'onload=b()>", "<rect width='1'>"],
  ["名前空間の接頭辞", '<g><a:script xmlns:a="x">alert(1)</a:script></g>', "<g></g>"],
  // 内側を取り除いた後に現れる ` onclick=` も取り除く。残る `"y"` は属性として読まれない。
  ["on* の入れ子", '<rect o onclick="x"nclick="y" width="4"/>', '<rect"y" width="4"/>'],
  [
    "スクリプトでない要素と属性",
    '<scripted data-on="1" d="M0 0"/>',
    '<scripted data-on="1" d="M0 0"/>',
  ],
])("%s", (_label, input, expected) => {
  expect(stripActiveContent(input)).toBe(expected);
});
