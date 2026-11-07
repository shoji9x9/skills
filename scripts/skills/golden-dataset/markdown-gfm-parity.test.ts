// golden-dataset の predicate-coverage-check が、GFM の描画（micromark の HTML）と同じ表と見出しを読むことを確かめる（Issue #926）。
//
// 入力の一覧と描画から表を取り出す処理は、scripts/lib/testing/gfm-table-cases.ts にある（replace-strategy と同じ入力）。
// predicate-coverage-check は、セルと見出しの表示される文字列を normalizeCell で畳む（コード引用の ` と強調の * を落とす）。
// そのため、描画の側にも normalizeCell を当ててから比べる。読んだ側は描画し直さずに、そのまま比べる。
// 各表の見出しは、描画で表より前にある最後の h1〜h6 と比べる。

import { expect, test } from "vitest";
import {
  normalizeCell,
  parseTables,
} from "../../../skills/golden-dataset/scripts/predicate-coverage-check.mjs";
import {
  GFM_TABLE_CASES,
  TABLE,
  renderedHeadings,
  renderedTables,
} from "../../lib/testing/gfm-table-cases.ts";
import { lines } from "../../lib/testing/text-lines.ts";

/** 描画した表を、見出しと、正規化したセルの行にする。 */
function rendered(text: string) {
  const headings = renderedHeadings(text);
  return renderedTables(text).map((rows, i) => ({
    heading: normalizeCell(headings[i] ?? ""),
    rows: rows.map((row) => row.map((cell) => normalizeCell(cell))),
  }));
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
  ["セルの中の `<br>`", lines(...TABLE, "| a<br>b | x |")],
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
