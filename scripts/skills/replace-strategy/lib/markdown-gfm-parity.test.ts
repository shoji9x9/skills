// replace-strategy の lib/markdown.mjs の parseTables が、GFM の描画（micromark の HTML）と同じ表を読むことを確かめる（Issue #672）。
//
// 入力は、手書きのパーサを直した PR #670 のレビューで、描画と読み方が食い違うと指摘された形である。
// 軸は、HTML コメント（行頭・行の途中・閉じない・セルの中・`<!-->`）、フェンス（情報文字列の付いた閉じる行・字下げ）、
// バックスラッシュのエスケープ（`\<!--`・`` \` ``・`\\`・`\|`）、コンテナ（リスト・引用）、段落を中断する表と見出し、の 5 つ。
//
// 比べ方: 同じ入力を micromark（GFM の拡張付き）で HTML に描画し、<table> のセルの表示される文字列を取り出す。
// parseTables のセルの値（元の Markdown の文字列）も micromark で描画して、表示される文字列にしてから比べる。
// GFM の描画は、見出しより多いセルを捨て、足りないセルを空にするので、parseTables の行も同じ数にそろえてから比べる。

import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { expect, test } from "vitest";
import { parseTables } from "../../../../skills/replace-strategy/scripts/lib/markdown.mjs";
import { lines } from "../../../lib/testing/text-lines.ts";

const OPTIONS = { allowDangerousHtml: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] };

/** 描画した HTML の断片から、表示される文字列を取り出す（コメントとタグを除き、文字参照を戻し、空白を畳む）。 */
function visibleText(html: string): string {
  // CodeQL の js/incomplete-multi-character-sanitization に合わせ、変わらなくなるまで除く（比べる側の文字列だけで使い、外に出さない）
  let stripped = html;
  for (let previous = ""; previous !== stripped;) {
    previous = stripped;
    stripped = stripped.replace(/<!--[\s\S]*?-->|<!-->|<!--->/gu, " ").replace(/<[^>]*>/gu, "");
  }
  return stripped
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/gu, " ")
    .trim();
}

/** micromark が描画した表を、行ごとのセルの表示される文字列にする（見出しの行を先頭に置く）。 */
function renderedTables(text: string): string[][][] {
  const html = micromark(text, OPTIONS);
  return [...html.matchAll(/<table>([\s\S]*?)<\/table>/gu)].map((table) =>
    [...table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gu)].map((row) =>
      [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gu)].map((cell) => visibleText(cell[1])),
    ),
  );
}

/** parseTables のセルの値を、描画したときに表示される文字列にする。 */
function cellVisible(cell: string): string {
  return visibleText(micromark(cell.trim(), OPTIONS).replace(/^<p>|<\/p>\n?$/gu, ""));
}

/** parseTables が読んだ表を、描画と同じ形（見出しの数にそろえた行）にする。 */
function parsedTables(text: string): string[][][] {
  return parseTables(text, { normalizeHeader: (cell) => cell }).tables.map((table) => {
    const width = table.headers.length;
    const padRow = (row: string[]) =>
      Array.from({ length: width }, (_, i) => cellVisible(row[i] ?? ""));
    return [padRow(table.headers), ...table.rows.map(padRow)];
  });
}

const TABLE = ["| a | b |", "|---|---|", "| 1 | 2 |"];

test.each<[string, string]>([
  // HTML コメント
  [
    "セルの中の閉じない `<!--` の後ろの行",
    lines(...TABLE, "| 3 | 旧形式は <!-- で始まる |", "| 4 | 5 |"),
  ],
  ["表の前の散文の閉じない `<!--`", lines("テンプレートの <!-- は記入例。", "", ...TABLE)],
  ["4 文字以上字下げした `<!--`", lines("例:", "", "    <!-- 書き方", "", ...TABLE)],
  [
    "`|` をまたぐセルの中のコメント",
    lines("| a | b | c |", "|---|---|---|", "| x <!-- | y --> | z |"),
  ],
  ["段落の中の閉じない `<!--` の後ろの表", lines("説明の <!-- 例", ...TABLE, "閉じは --> と書く")],
  ["見出しを挟んだ閉じない `<!--` の後ろの表", lines("説明の <!-- 例", "## 節", ...TABLE)],
  [
    "セルの中の `<!--` と後ろの行の `-->`",
    lines(...TABLE, "| 3 | x <!-- y |", "| 4 | z |", "| 5 | --> w |"),
  ],
  ["行頭のコメントが同じ行で閉じた後の `<!--`", lines("<!-- a --> <!-- b", ...TABLE, "c -->")],
  ["`<!-->` の後ろの表", lines("<!-->", "", ...TABLE)],
  ["`<!--->` の後ろの表", lines("<!--->", "", ...TABLE)],
  ["セルの中の `<!-->` と `<!--->`", lines(...TABLE, "| 3 | <!--> x |", "| 4 | <!---> y |")],
  [
    "段落の中で後ろの行に続くコメント",
    lines("注意 <!-- 記入例", "| 原本 | 実体をコピーする | 有効 |", "-->", "", ...TABLE),
  ],
  ["HTML ブロックを閉じる行の後ろ", lines(...TABLE, "", "<!-- 退役", "| 3 | 4 |", "--> | 5 | 6 |")],
  ["行頭の閉じない `<!--`", lines("<!-- 退役", "", ...TABLE)],
  ["HTML ブロックの中の `\\<!-- -->` で閉じる", lines("<!--", "メモ \\<!-- -->", ...TABLE, "-->")],
  ["4 文字字下げして同じ行で閉じたコメント", lines(...TABLE, "", "    <!-- | 4 | 5 | 6 | -->")],
  // フェンス
  ["情報文字列の付いた行で閉じないフェンス", lines("```", "```js", "<!-- 例", "```", "", ...TABLE)],
  ["表の行の途中の `|` を含むフェンス行", lines(...TABLE, "```| x", "| 3 | 4 |", "```")],
  [
    "コメントを空白にして初めてフェンスに見える行",
    lines("```<!-- ` -->", "", ...TABLE, "", "```", "| x | y |", "|---|---|", "```"),
  ],
  // エスケープ
  ["セルの中の `\\<!--`", lines(...TABLE, "| 3 | \\<!-- x --> y |")],
  ["セルの中の `` \\` `` で挟んだコメント", lines(...TABLE, "| \\` <!-- c --> \\` | z |")],
  ["セルの中の `\\\\<!--`", lines(...TABLE, "| 3 | \\\\<!-- x --> y |")],
  ["セルの中の `` \\\\` `` で開くコードスパン", lines(...TABLE, "| 3 | \\\\` <!-- x --> ` |")],
  ["セルの中の `\\\\|`", lines(...TABLE, "| 1 \\\\| 2 |")],
  ["セルの中の `\\|`", lines(...TABLE, "| x \\| y | `p \\| q` |")],
  [
    "エスケープしたバッククォートの並びの残りで開くコードスパン",
    lines(...TABLE, "| 1 | \\``<!-- c -->` |"),
  ],
  // コンテナ
  [
    "リストの中で開いたコメントの中の表",
    lines("- <!-- 退役", "  | a | b |", "  |---|---|", "  | 1 | 2 |", "  -->"),
  ],
  [
    "引用の中で開いたコメントの中の表",
    lines("> <!-- 退役", "> | a | b |", "> |---|---|", "-->", "", ...TABLE),
  ],
  ["引用の中の表", lines("> | a | b |", "> |---|---|", "> | 1 | 2 |")],
  ["リストの中の表", lines("- | a | b |", "  |---|---|", "  | 1 | 2 |")],
  // セルの数
  ["見出しより多いセルと少ないセル", lines(...TABLE, "| 3 | 4 | 5 |", "| 6 |")],
  ["行頭と行末の `|` を省いた表", lines("a | b", "--|--", "1 | 2")],
])("parseTables は GFM の描画と同じ表を読む: %s", (_name, text) => {
  const rendered = renderedTables(text);
  // 比べる相手が空なら、描画の取り出し方が動いていない場合と区別できないので、表の数も比べる
  expect(parsedTables(text)).toEqual(rendered);
});

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
