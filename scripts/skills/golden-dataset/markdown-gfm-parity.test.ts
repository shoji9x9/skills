// golden-dataset の predicate-coverage-check が、GFM の描画（micromark の HTML）と同じ表と見出しを読むことを確かめる（Issue #926）。
//
// 入力の一覧と描画から表を取り出す処理は、scripts/lib/testing/gfm-table-cases.ts にある（replace-strategy と同じ入力）。
// 両辺とも、表示される文字列の空白を畳んだ値（全角空白も畳む）をそのまま比べる。
// predicate-coverage-check の正規化（normalizeCell など）を描画の側に当てない。当てると、正規化が文字を落としたときの差も両辺から消え、検出できない。
// 読んだ側は描画し直さない。
// 各表の見出しは、描画で表より前にある最後の h1〜h6 と比べる。

import { expect, test } from "vitest";
import { parseTables } from "../../../skills/golden-dataset/scripts/predicate-coverage-check.mjs";
import {
  FILTERED_TAG_NAMES,
  GFM_TABLE_CASES,
  SEPARATING_TAG_NAMES,
  TABLE_PART_TAG_NAMES,
  TABLE,
  renderedHeadings,
  renderedTables,
} from "../../lib/testing/gfm-table-cases.ts";
import { lines } from "../../lib/testing/text-lines.ts";

/** 描画した表を、見出しとセルの行にする。 */
function rendered(text: string) {
  const headings = renderedHeadings(text);
  return renderedTables(text).map((rows, i) => ({ heading: headings[i] ?? "", rows }));
}

/** predicate-coverage-check が読んだ表を、描画と同じ形（列名の数にそろえた行）にする。 */
function parsed(text: string) {
  return parseTables(text).map((table) => {
    const width = table.headers.length;
    const padRow = (row: string[]) => Array.from({ length: width }, (_, i) => row[i] ?? "");
    return { heading: table.heading, rows: [padRow(table.headers), ...table.rows.map(padRow)] };
  });
}

/** 見出しと、セルの値の読み方の入力（表の範囲の読み方の入力は GFM_TABLE_CASES）。 */
const VALUE_CASES: [string, string][] = [
  ["ATX の見出しの閉じる `#`", lines("## 対象テーブル ##", "", ...TABLE)],
  ["Setext の見出し", lines("対象テーブル", "---", "", ...TABLE)],
  ["見出しの中のコード", lines("## `orders` の表", "", ...TABLE)],
  ["見出しの中のエスケープ", lines("## order\\_items の表", "", ...TABLE)],
  ["HTML コメントの中の見出し", lines("## 本文", "", "<!--", "## 例", "-->", "", ...TABLE)],
  ["フェンスの中の見出し", lines("## 本文", "", "```md", "## 例", "```", "", ...TABLE)],
  ["4 文字字下げした `#`", lines("## 本文", "", "    ## 例", "", ...TABLE)],
  ["引用の中の見出し", lines("## 本文", "", "> ## 引用", "", ...TABLE)],
  ["見出しの無い表", lines(...TABLE)],
  ["見出しを挟む 2 つの表", lines("## A", "", ...TABLE, "", "## B", "", ...TABLE)],
  ["セルの中の `\\_`", lines(...TABLE, "| order\\_items | owner\\_id |")],
  ["セルの中の `\\*` と `\\-`", lines(...TABLE, "| \\*orders\\* | \\- |")],
  ["セルの中の文字参照", lines(...TABLE, "| a &amp; b | &#45; |")],
  ["セルの中のコードスパンの `\\_`", lines(...TABLE, "| `order\\_items` | x |")],
  ["セルの中の `<br>`", lines(...TABLE, "| a<br>b | c<br/>d<BR />e |")],
  ["セルの中の属性付きの `<br>`", lines(...TABLE, '| x<br class="c">y | z |')],
  ["セルの中のコードスパンの `*`", lines(...TABLE, "| `count(*)` | \\*x |")],
  ["セルの中の、属性値に `>` を含む `<br>`", lines(...TABLE, '| a<br title="x>y">b | c |')],
  ["セルの中の `<p>`・`<div>`・`</br>`", lines(...TABLE, "| a<p>b | c<div>d</div>e | f</br>g |")],
  ["セルの中の語を分けないタグ", lines(...TABLE, "| 分岐<span>網羅</span> | a<b>c</b> |")],
  ["見出しの中の語を分けないタグ", lines("## 述語ごとの<span>分岐網羅</span>", "", ...TABLE)],
  ["セルの中のコメントと処理命令", lines(...TABLE, "| e<!-- c -->f | x<?php y ?>z |")],
  [
    "セルの中の、GFM の tagfilter が無効にするタグ",
    lines(...TABLE, "| a<script>x</script>b | c<xmp>d |"),
  ],
  ["セルの中の全角空白", lines(...TABLE, "|\u3000orders\u3000items\u3000| x |")],
];

test.each<[string, string]>([...GFM_TABLE_CASES, ...VALUE_CASES])(
  "predicate-coverage-check は GFM の描画と同じ表と見出しを読む: %s",
  (_name, text) => {
    // 比べる相手が空なら、描画の取り出し方が動いていない場合と区別できないので、表の数も比べる
    expect(parsed(text)).toEqual(rendered(text));
  },
);

test("比べ方の確認: 描画から見出しを表ごとに取り出す", () => {
  expect(renderedHeadings(lines(...TABLE, "", "## `B` 節", "", ...TABLE))).toEqual(["", "B 節"]);
  expect(renderedHeadings("## 見出しだけ\n")).toEqual([]);
});

// 語を分けるタグの一覧（lib/markdown.mjs の SEPARATING_TAGS）の名前を 1 つずつ、比べる側の一覧から独立に確かめる。
// 開くタグと閉じるタグの両方を置く。一覧から名前が抜けるか綴りを誤ると、その名前の入力が落ちる。
// table は見出しで確かめる（下の test）。比べる側の renderedTables は表を閉じるタグまでの正規表現で取り出すので、セルの中に </table> があると、そこで取り出しが終わる。
test.each(SEPARATING_TAG_NAMES.filter((name) => name !== "table"))(
  "語を分けるタグ <%s> を、描画と同じく空白として読む",
  (name) => {
    const text = lines(...TABLE, `| a<${name}>b | c</${name}>d |`);
    expect(parsed(text)).toEqual(rendered(text));
  },
);

test("語を分けるタグ <table> を、見出しの中で空白として読む", () => {
  // 中身を入れると、ブラウザは中身を表の前へ移すので、空の表で確かめる
  const text = lines("## a<table></table>c", "", ...TABLE);
  expect(parseTables(text).map((table) => table.heading)).toEqual(["a c"]);
  expect(renderedHeadings(text)).toEqual(["a c"]);
});

// 表の部品の要素は、表の外ではブラウザがタグを無視するので、見出しの中では語を分けない
test.each(TABLE_PART_TAG_NAMES)("表の部品のタグ <%s> は、見出しの中で語を分けない", (name) => {
  const text = lines(`## a<${name}>b</${name}>c`, "", ...TABLE);
  expect(parseTables(text).map((table) => table.heading)).toEqual(["abc"]);
  expect(renderedHeadings(text)).toEqual(["abc"]);
});

// GFM の tagfilter が無効にするタグ（lib/markdown.mjs の FILTERED_TAG）の名前を 1 つずつ確かめる。
// 名前は大文字と小文字を区別せず、後ろに属性が続いても無効にする。
test.each(FILTERED_TAG_NAMES)(
  "GFM の tagfilter が無効にするタグ <%s> を、描画と同じく文字のまま読む",
  (name) => {
    const upper = name.toUpperCase();
    const text = lines(
      ...TABLE,
      `| a<${name}>b | c</${name}>d |`,
      `| e<${upper}>f | g<${name} x="y">h |`,
    );
    expect(parsed(text)).toEqual(rendered(text));
  },
);
