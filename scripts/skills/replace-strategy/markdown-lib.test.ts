// replace-strategy の lib/markdown.mjs の parseTables と、それを使う 3 つのスクリプトの回帰テスト（Issue #598・#611）。
//
// 3 つのスクリプト（asset-delivery-check・evidence-gap-check・procedure-staleness-check）は、
// 表の行の途中のフェンス行で表を終え（GFM と同じ）、HTML コメントの中の表を台帳として読まない。
// #598 では読み方の違いを呼び出し元のオプションで残していたが、#611 で 1 つにそろえた。

import { expect, test } from "vitest";
import { readAssetLedger } from "../../../skills/replace-strategy/scripts/asset-delivery-check.mjs";
import { readRow } from "../../../skills/replace-strategy/scripts/evidence-gap-check.mjs";
import { parseTables } from "../../../skills/replace-strategy/scripts/lib/markdown.mjs";
import { readProcedureLedger } from "../../../skills/replace-strategy/scripts/procedure-staleness-check.mjs";

const lines = (...xs: string[]) => [...xs, ""].join("\n");

test("表の行の途中の `|` を含むフェンス行で表を終え、フェンスの中の表の行を読まない", () => {
  const { tables } = parseTables(
    lines("| a | b |", "|---|---|", "| 1 | 2 |", "```| x", "| 3 | 4 |", "```"),
  );
  expect(tables).toHaveLength(1);
  expect(tables[0].rows).toEqual([[" 1 ", " 2 "]]);
});

test("HTML コメントの中の表は読まない（複数行のコメントと、行の途中で開いたコメント）", () => {
  const { tables, strayRows } = parseTables(
    lines(
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "<!--",
      "| c | d |",
      "|---|---|",
      "| 3 | 4 |",
      "-->",
      "",
      "散文 <!-- | e | f |",
      "|---|---| -->",
    ),
  );
  expect(tables.map((t) => t.rows)).toEqual([[[" 1 ", " 2 "]]]);
  expect(strayRows).toEqual([]);
});

test("誤検知しないことの確認: フェンスの中の `<!--` は、以降の表を消さない", () => {
  const { tables } = parseTables(
    lines("```html", "<!-- 例", "```", "", "| a | b |", "|---|---|", "| 1 | 2 |"),
  );
  expect(tables.map((t) => t.rows)).toEqual([[[" 1 ", " 2 "]]]);
});

test("誤検知しないことの確認: コメントの中のフェンス行はフェンスを開かず、コメントの後の表を読む", () => {
  const { tables } = parseTables(
    lines("<!--", "```", "-->", "", "| a | b |", "|---|---|", "| 1 | 2 |"),
  );
  expect(tables.map((t) => t.rows)).toEqual([[[" 1 ", " 2 "]]]);
});

test("誤検知しないことの確認: コードスパンの中の `<!--` は、以降の表を消さない", () => {
  const { tables } = parseTables(
    lines("`<!--` で始まる行", "``a` <!--`` も同じ", "", "| a | b |", "|---|---|", "| 1 | 2 |"),
  );
  expect(tables.map((t) => t.rows)).toEqual([[[" 1 ", " 2 "]]]);
});

test("閉じないバッククォートの後ろの `<!--` は、コメントの始まりとして読む", () => {
  const { tables } = parseTables(
    lines(
      "` だけ <!--",
      "| c | d |",
      "|---|---|",
      "| 3 | 4 |",
      "-->",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ),
  );
  expect(tables.map((t) => t.rows)).toEqual([[[" 1 ", " 2 "]]]);
});

const CHANGE = "| ID | 追加日 | 足した軸 | 由来 | 対象の種類 | 見直しの置き場 |";
const RECORD = "| 記録 ID | 変更 ID | slug | 判断 | 記録日 | 根拠・理由 |";
const D6 = "|---|---|---|---|---|---|";
const PC = (id: string) => `| ${id} | 2026-09-20 | 軸 | 由来 | feature | #1 |`;
const procedureIds = (text: string) => {
  const r = readProcedureLedger(text, new Set());
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.changes.map((c) => c.id);
};

const FEATURE = "| slug | 機能名 | 新規実装 API | 要求単位の根拠 | テーブル | Issue |";
const PLAN = (api: string) => `| plan | 計画管理 | ${api} | ${api}: measured | MST_PLAN | #210 |`;
const ASSET = "| 種類 | 方針 | 状態 |";
const COPY = (kind: string) => `| ${kind} | 実体をコピーする | 有効 |`;

test.each([
  [
    "asset-delivery-check",
    () =>
      readAssetLedger(
        lines(ASSET, "|---|---|---|", COPY("新"), "```| x", COPY("旧"), "```"),
      ).copyRows.map((r) => r.kind),
    ["新"],
  ],
  [
    "evidence-gap-check",
    () =>
      readRow(lines(FEATURE, D6, PLAN("GET /a"), "```| x", PLAN("GET /b"), "```"), "plan")
        .endpoints,
    ["GET /a"],
  ],
  [
    "procedure-staleness-check",
    () =>
      procedureIds(lines(CHANGE, D6, PC("PC-001"), "```| x", PC("PC-002"), "```", "", RECORD, D6)),
    ["PC-001"],
  ],
])("%s: 表の直後の `|` を含むフェンス行で表を終える", (_name, read, expected) => {
  expect(read()).toEqual(expected);
});

test.each([
  [
    "asset-delivery-check",
    () =>
      readAssetLedger(
        lines(
          ASSET,
          "|---|---|---|",
          COPY("新"),
          "",
          "<!--",
          ASSET,
          "|---|---|---|",
          COPY("旧"),
          "-->",
        ),
      ).copyRows.map((r) => r.kind),
    ["新"],
  ],
  [
    "evidence-gap-check",
    () =>
      readRow(
        lines(FEATURE, D6, PLAN("GET /a"), "", "<!--", FEATURE, D6, PLAN("GET /b"), "-->"),
        "plan",
      ).endpoints,
    ["GET /a"],
  ],
  [
    "procedure-staleness-check",
    () =>
      procedureIds(
        lines(
          "<!--",
          CHANGE,
          D6,
          PC("PC-900"),
          "-->",
          "",
          CHANGE,
          D6,
          PC("PC-001"),
          "",
          RECORD,
          D6,
        ),
      ),
    ["PC-001"],
  ],
])("%s: HTML コメントの中の表の行を台帳として読まない", (_name, read, expected) => {
  expect(read()).toEqual(expected);
});

test("evidence-gap-check: 表の途中の HTML コメントの行で表が切れたら、行が無いというエラーに表の外の行番号を添える", () => {
  const other = "| other | 他 | GET /c | GET /c: measured | T | #2 |";
  const text = lines(FEATURE, D6, PLAN("GET /a"), `<!-- ${PLAN("GET /b")} -->`, other);
  expect(() => readRow(text, "other")).toThrow(/行がインベントリに無い（5 行目は表に属さない/u);
});
