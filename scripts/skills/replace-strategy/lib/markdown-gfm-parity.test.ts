// replace-strategy の lib/markdown.mjs の parseTables が、GFM の描画（micromark の HTML）と同じ表を読むことを確かめる（Issue #672）。
//
// 入力の一覧と描画から表を取り出す処理は、scripts/lib/testing/gfm-table-cases.ts にある。
//
// parseTables のセルの値（元の Markdown の文字列）も micromark で描画して、表示される文字列にしてから比べる。
// GFM の描画は、見出しより多いセルを捨て、足りないセルを空にするので、parseTables の行も同じ数にそろえてから比べる。

import { expect, test } from "vitest";
import { parseTables } from "../../../../skills/replace-strategy/scripts/lib/markdown.mjs";
import {
  GFM_TABLE_CASES,
  TABLE,
  cellVisible,
  renderedTables,
} from "../../../lib/testing/gfm-table-cases.ts";
import { lines } from "../../../lib/testing/text-lines.ts";

/** parseTables が読んだ表を、描画と同じ形（見出しの数にそろえた行）にする。 */
function parsedTables(text: string): string[][][] {
  return parseTables(text, { normalizeHeader: (cell) => cell }).tables.map((table) => {
    const width = table.headers.length;
    const padRow = (row: string[]) =>
      Array.from({ length: width }, (_, i) => cellVisible(row[i] ?? ""));
    return [padRow(table.headers), ...table.rows.map(padRow)];
  });
}

test.each<[string, string]>(GFM_TABLE_CASES)(
  "parseTables は GFM の描画と同じ表を読む: %s",
  (_name, text) => {
    const rendered = renderedTables(text);
    // 比べる相手が空なら、描画の取り出し方が動いていない場合と区別できないので、表の数も比べる
    expect(parsedTables(text)).toEqual(rendered);
  },
);

test("比べ方の確認: 描画から表とセルを取り出せ、表示されない文字を除く", () => {
  // 取り出し方が動いていないと、両辺が空の配列で一致してしまうので、既知の入力で中身を確かめる
  expect(renderedTables(lines(...TABLE, "| `x` | y <!-- z --> &amp; |"))).toEqual([
    [
      ["a", "b"],
      ["1", "2"],
      ["x", "y &"],
    ],
  ]);
  expect(renderedTables("段落だけ\n")).toEqual([]);
  expect(cellVisible(" **x** <!-- y --> z ")).toBe("x z");
});
