// golden-dataset の predicate-coverage-check が、GFM の描画（micromark の HTML）と同じ表と見出しを読むことを確かめる（Issue #926）。
//
// 入力の一覧と描画から表を取り出す処理は、scripts/lib/testing/gfm-table-cases.ts にある（replace-strategy と同じ入力）。
// predicate-coverage-check はセルと見出しを normalizeCell で畳む（コード引用の ` と強調の * を落とす）ので、描画の側にも同じ処理を当ててから比べる。
// 各表の見出しは、描画で表より前にある最後の h1〜h6 と比べる。

import { expect, test } from "vitest";
import {
  normalizeCell,
  parseTables,
} from "../../../skills/golden-dataset/scripts/predicate-coverage-check.mjs";
import {
  GFM_TABLE_CASES,
  TABLE,
  cellVisible,
  renderedHeadings,
  renderedTables,
} from "../../lib/testing/gfm-table-cases.ts";
import { lines } from "../../lib/testing/text-lines.ts";

/**
 * normalizeCell はバッククォートを落とすが、バッククォートをエスケープするバックスラッシュは残す。
 * 描画では、エスケープしたバッククォートはバッククォートだけになる。
 * 表と行の読み取りは一致するので、この入力ではセルのバックスラッシュを両辺から除き、読んだセルを描画し直さずに比べる。
 * 描画し直すと、バッククォートを落としてコードスパンでなくなったコメントの記号が、コメントとして消える。
 * predicate-coverage-check が読む列（テーブル名・slug・述語 id・件数）には、エスケープしたバッククォートを書かない。
 */
const ESCAPED_BACKTICK_CASES = new Set([
  "セルの中の `` \\` `` で挟んだコメント",
  "セルの中の `` \\\\` `` で開くコードスパン",
]);

/** 比べる前にセルに当てる処理（エスケープした ` の入力だけ `\` を除く）。 */
function cellOf(name: string) {
  return (cell: string) =>
    ESCAPED_BACKTICK_CASES.has(name) ? normalizeCell(cell.replaceAll("\\", "")) : cell;
}

/** 読んだセルを、描画したときに表示される文字列にする（エスケープした ` の入力は描画し直さない）。 */
function visibleOf(name: string) {
  return (cell: string) =>
    ESCAPED_BACKTICK_CASES.has(name) ? cell : normalizeCell(cellVisible(cell));
}

/** 描画した表を、見出しと、正規化したセルの行にする。 */
function rendered(text: string) {
  const headings = renderedHeadings(text);
  return renderedTables(text).map((rows, i) => ({
    heading: normalizeCell(headings[i] ?? ""),
    rows: rows.map((row) => row.map((cell) => normalizeCell(cell))),
  }));
}

/** predicate-coverage-check が読んだ表を、描画と同じ形（列名の数にそろえた行）にする。 */
function parsed(text: string, name: string) {
  const visible = visibleOf(name);
  return parseTables(text).map((table) => {
    const width = table.headers.length;
    const padRow = (row: string[]) =>
      Array.from({ length: width }, (_, i) => visible(row[i] ?? ""));
    return { heading: table.heading, rows: [padRow(table.headers), ...table.rows.map(padRow)] };
  });
}

/** 見出しの読み方の入力（表の読み方の入力は GFM_TABLE_CASES）。 */
const HEADING_CASES: [string, string][] = [
  ["ATX の見出しの閉じる `#`", lines("## 対象テーブル ##", "", ...TABLE)],
  ["Setext の見出し", lines("対象テーブル", "---", "", ...TABLE)],
  ["見出しの中のコード", lines("## `orders` の表", "", ...TABLE)],
  ["HTML コメントの中の見出し", lines("## 本文", "", "<!--", "## 例", "-->", "", ...TABLE)],
  ["フェンスの中の見出し", lines("## 本文", "", "```md", "## 例", "```", "", ...TABLE)],
  ["4 文字字下げした `#`", lines("## 本文", "", "    ## 例", "", ...TABLE)],
  ["引用の中の見出し", lines("## 本文", "", "> ## 引用", "", ...TABLE)],
  ["見出しの無い表", lines(...TABLE)],
  ["見出しを挟む 2 つの表", lines("## A", "", ...TABLE, "", "## B", "", ...TABLE)],
];

test.each<[string, string]>([...GFM_TABLE_CASES, ...HEADING_CASES])(
  "predicate-coverage-check は GFM の描画と同じ表と見出しを読む: %s",
  (name, text) => {
    const cell = cellOf(name);
    const tables = (list: ReturnType<typeof rendered>) =>
      list.map((t) => ({ heading: t.heading, rows: t.rows.map((row) => row.map(cell)) }));
    // 比べる相手が空なら、描画の取り出し方が動いていない場合と区別できないので、表の数も比べる
    expect(tables(parsed(text, name))).toEqual(tables(rendered(text)));
  },
);

test("比べ方の確認: `\\` を除いて比べる入力は、入力の一覧にある", () => {
  const names = new Set(GFM_TABLE_CASES.map(([name]) => name));
  for (const name of ESCAPED_BACKTICK_CASES) expect(names).toContain(name);
});

test("比べ方の確認: 描画から見出しを表ごとに取り出す", () => {
  expect(renderedHeadings(lines(...TABLE, "", "## `B` 節", "", ...TABLE))).toEqual(["", "B 節"]);
  expect(renderedHeadings("## 見出しだけ\n")).toEqual([]);
});
