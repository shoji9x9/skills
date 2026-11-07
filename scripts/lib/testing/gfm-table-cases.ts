// Markdown の表の読み方を GFM の描画（micromark の HTML）と比べるテストが共通に使う、比べ方と入力の一覧（Issue #672・#926）。
//
// 入力は、手書きのパーサを直した PR #670 のレビューで、描画と読み方が食い違うと指摘された形である。
// 軸は、HTML コメント（行頭・行の途中・閉じない・セルの中・`<!-->`）、フェンス（情報文字列の付いた閉じる行・字下げ）、
// バックスラッシュのエスケープ（`\<!--`・`` \` ``・`\\`・`\|`）、コンテナ（リスト・引用）、段落を中断する表と見出し、の 5 つ。
//
// 比べ方: 同じ入力を micromark（GFM の拡張付き）で HTML に描画し、<table> のセルの表示される文字列を取り出す。

import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { lines } from "./text-lines.ts";

const OPTIONS = { allowDangerousHtml: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] };

/** 描画した HTML の断片から、表示される文字列を取り出す（コメントとタグを除き、文字参照を戻し、空白を畳む）。 */
function visibleText(html: string): string {
  // CodeQL の js/incomplete-multi-character-sanitization に合わせ、変わらなくなるまで除く（比べる側の文字列だけで使い、外に出さない）
  let stripped = html;
  for (let previous = ""; previous !== stripped;) {
    previous = stripped;
    stripped = stripped
      .replace(/<!--[\s\S]*?-->|<!-->|<!--->/gu, " ")
      .replace(/<br(?:\s[^>]*)?\/?>/giu, " ")
      .replace(/<[^>]*>/gu, "");
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
export function renderedTables(text: string): string[][][] {
  const html = micromark(text, OPTIONS);
  return [...html.matchAll(/<table>([\s\S]*?)<\/table>/gu)].map((table) =>
    [...table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gu)].map((row) =>
      [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gu)].map((cell) => visibleText(cell[1])),
    ),
  );
}

/** parseTables のセルの値を、描画したときに表示される文字列にする。 */
export function cellVisible(cell: string): string {
  return visibleText(micromark(cell.trim(), OPTIONS).replace(/^<p>|<\/p>\n?$/gu, ""));
}

/** 描画した HTML の表ごとに、その表より前で最後の見出し（h1〜h6）の表示される文字列（無ければ空）を返す。 */
export function renderedHeadings(text: string): string[] {
  const html = micromark(text, OPTIONS);
  const headings: string[] = [];
  let heading = "";
  for (const m of html.matchAll(/<h[1-6]>([\s\S]*?)<\/h[1-6]>|<table>/gu)) {
    if (m[1] === undefined) headings.push(heading);
    else heading = visibleText(m[1]);
  }
  return headings;
}

export const TABLE = ["| a | b |", "|---|---|", "| 1 | 2 |"];

/** 描画と読み方が食い違いやすい入力（名前と Markdown）。 */
export const GFM_TABLE_CASES: [string, string][] = [
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
];
