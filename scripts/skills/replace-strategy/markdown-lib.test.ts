// replace-strategy の lib/markdown.mjs の parseTables と、それを使う 3 つのスクリプトの回帰テスト（Issue #598・#611）。
//
// 3 つのスクリプト（asset-delivery-check・evidence-gap-check・procedure-staleness-check）は、
// 表の行の途中のフェンス行で表を終え（GFM と同じ）、HTML コメントの中の表を台帳として読まない。
// #598 では読み方の違いを呼び出し元のオプションで残していたが、#611 で 1 つにそろえた。

import { expect, test } from "vitest";
import { readAssetLedger } from "../../../skills/replace-strategy/scripts/asset-delivery-check.mjs";
import { readRow } from "../../../skills/replace-strategy/scripts/evidence-gap-check.mjs";
import { stepFence } from "../../../skills/replace-strategy/scripts/lib/fence.mjs";
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

test("HTML コメントの中の表は読まない（行頭で開いた複数行のコメントと、行の途中で開いて同じ行で閉じたコメント）", () => {
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
      "散文 <!-- | e | f | -->",
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

// セルの値を前後の空白を除いて返す（コメントを空白に置き換えた分の空白を比べない）。
const cells = (text: string) =>
  parseTables(text).tables.flatMap((t) => t.rows.map((r) => r.map((c) => c.trim())));

test("誤検知しないことの確認: コードスパンの中の `<!-- -->` は、コメントとして消さない", () => {
  expect(
    cells(lines("| a | b |", "|---|---|", "| 1 | `<!-- x -->` |", "| 2 | ``a` <!-- y -->`` |")),
  ).toEqual([
    ["1", "`<!-- x -->`"],
    ["2", "``a` <!-- y -->``"],
  ]);
});

test("閉じないバッククォートの後ろの `<!-- -->` は、コメントとして消す", () => {
  expect(cells(lines("| a | b |", "|---|---|", "| 1 | ` だけ <!-- x --> |"))).toEqual([
    ["1", "` だけ"],
  ]);
});

test("`<!-->` と `<!--->` は、それだけで閉じたコメントとして消す（CommonMark 0.31）", () => {
  expect(cells(lines("| a | b |", "|---|---|", "| 1 | <!--> x |", "| 2 | <!---> y |"))).toEqual([
    ["1", "x"],
    ["2", "y"],
  ]);
  const { tables } = parseTables(lines("<!-->", "", "| a | b |", "|---|---|", "| 1 | 2 |"));
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

test("evidence-gap-check: 行頭の `|` を省いた行で表が切れても、表の外の行番号を添える", () => {
  const other = "other | 他 | GET /c | GET /c: measured | T | #2";
  const text = lines(FEATURE, D6, PLAN("GET /a"), "<!-- 退役 -->", other);
  expect(() => readRow(text, "other")).toThrow(/行がインベントリに無い（5 行目は表に属さない/u);
});

test("行の途中の閉じない `<!--` は文字として読み、以降の表の行を消さない", () => {
  const text = lines(
    "| 種類 | 方針 | 状態 | 備考 |",
    "|---|---|---|---|",
    "| 新 | 実体をコピーする | 有効 | 旧形式は <!-- で始まる |",
    "| 旧 | 実体をコピーする | 有効 | |",
  );
  expect(readAssetLedger(text).copyRows.map((r) => r.kind)).toEqual(["新", "旧"]);
});

test("行の途中の閉じない `<!--` は、空行を挟まない後ろの行の表も消さない（表は段落を中断する）", () => {
  const text = lines(
    "テンプレートの <!-- は記入例。",
    FEATURE,
    D6,
    PLAN("GET /a"),
    "閉じは --> と書く。",
  );
  expect(readRow(text, "plan").endpoints).toEqual(["GET /a"]);
});

test("行頭の閉じない `<!--` は、末尾までコメントとして読む（字下げ 3 文字まで）", () => {
  for (const open of ["<!-- 退役", "   <!-- 退役"]) {
    const { tables } = parseTables(lines(open, "", "| a | b |", "|---|---|", "| 1 | 2 |"));
    expect(tables).toEqual([]);
  }
});

test("4 文字以上字下げした `<!--` は、HTML ブロックを開かない", () => {
  const { tables } = parseTables(
    lines("    <!-- 書き方", "", "| a | b |", "|---|---|", "| 1 | 2 |"),
  );
  expect(tables.map((t) => t.rows)).toEqual([[[" 1 ", " 2 "]]]);
});

test("行頭のコメントが同じ行で閉じたら、その行の後ろの `<!--` で後ろの行を消さない", () => {
  const { tables } = parseTables(
    lines("<!-- a --> <!-- b", "| a | b |", "|---|---|", "| 1 | 2 |", "c -->"),
  );
  expect(tables.map((t) => t.rows)).toEqual([[[" 1 ", " 2 "]]]);
});

test("表のセルの中で閉じない `<!--` は、後ろの行の `-->` までの表の行を消さない", () => {
  expect(
    cells(lines("| a | b |", "|---|---|", "| 1 | x <!-- y |", "| 2 | z |", "| 3 | --> w |")),
  ).toEqual([
    ["1", "x <!-- y"],
    ["2", "z"],
    ["3", "--> w"],
  ]);
});

test("バックスラッシュを付けた `\\<!--` と `` \\` `` は、コメントとコードスパンの始まりにしない", () => {
  expect(
    cells(lines("| a | b |", "|---|---|", "| 1 | \\<!-- x --> y |", "| 2 | \\` <!-- c --> \\` |")),
  ).toEqual([
    ["1", "\\<!-- x --> y"],
    ["2", "\\`" + " ".repeat(12) + "\\`"],
  ]);
});

test("HTML ブロックを閉じる行は、`-->` の後ろもブロックに入るので表の行として読まない", () => {
  const { tables, strayRows } = parseTables(
    lines("| a | b |", "|---|---|", "| 1 | 2 |", "", "<!-- 退役", "| 3 | 4 |", "--> | 5 | 6 |"),
  );
  expect(tables.map((t) => t.rows)).toEqual([[[" 1 ", " 2 "]]]);
  expect(strayRows).toEqual([]);
});

const norm = (text: string) => cells(text).map((r) => r.map((c) => c.replace(/\s+/gu, " ")));

// フェンスの開閉（Issue #679）。閉じる行は、開いた記号と同じ文字で同じ長さ以上の記号の後ろが空白だけの行（CommonMark）。
test.each<[string, string | null, string | undefined, { fence: string | null; marker: boolean }]>([
  ["開いていない・``` で開く", null, "```", { fence: "```", marker: true }],
  ["開いていない・情報文字列付きで開く", null, "```bash", { fence: "```", marker: true }],
  [
    "開いていない・情報文字列に行区切りの文字があっても開く",
    null,
    "```a\u2028b",
    { fence: "```", marker: true },
  ],
  ["開いていない・~~~ で開く", null, "~~~", { fence: "~~~", marker: true }],
  [
    "開いていない・情報文字列にバッククォートを含む ``` は開かない",
    null,
    "```x``` はインラインのコード",
    { fence: null, marker: false },
  ],
  [
    "開いていない・情報文字列にバッククォートを含む ~~~ は開く",
    null,
    "~~~ `x`",
    { fence: "~~~", marker: true },
  ],
  ["開いていない・字下げ 4 文字は開かない", null, "    ```", { fence: null, marker: false }],
  ["開いていない・行が無い", null, undefined, { fence: null, marker: false }],
  ["開いている・同じ記号で閉じる", "```", "```", { fence: null, marker: true }],
  ["開いている・情報文字列付きの行では閉じない", "```", "```bash", { fence: "```", marker: false }],
  [
    "開いている・~~~ の情報文字列付きの行では閉じない",
    "~~~",
    "~~~ text",
    { fence: "~~~", marker: false },
  ],
  ["開いている・後ろの空白とタブは閉じる", "```", "```  \t", { fence: null, marker: true }],
  ["開いている・長い記号で閉じる", "```", "`````", { fence: null, marker: true }],
  ["開いている・短い記号では閉じない", "````", "```", { fence: "````", marker: false }],
  ["開いている・別の文字では閉じない", "```", "~~~", { fence: "```", marker: false }],
  ["開いている・字下げ 3 文字は閉じる", "```", "   ```", { fence: null, marker: true }],
  ["開いている・字下げ 4 文字は閉じない", "```", "    ```", { fence: "```", marker: false }],
  ["開いている・行が無い", "```", undefined, { fence: "```", marker: false }],
])("stepFence: %s", (_name, fence, line, expected) => {
  expect(stepFence(fence, line)).toEqual(expected);
});

test("情報文字列の付いた行でフェンスを閉じず、フェンスの中の表と HTML コメントを読まない", () => {
  const { tables } = parseTables(
    lines(
      "```",
      "```bash",
      "<!--",
      "| c | d |",
      "|---|---|",
      "| 3 | 4 |",
      "```",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ),
  );
  expect(tables.map((t) => t.rows)).toEqual([[[" 1 ", " 2 "]]]);
});

test.each([
  [
    "asset-delivery-check",
    () =>
      readAssetLedger(
        lines(
          "```",
          "```bash",
          ASSET,
          "|---|---|---|",
          COPY("旧"),
          "```",
          "",
          ASSET,
          "|---|---|---|",
          COPY("新"),
        ),
      ).copyRows.map((r) => r.kind),
    ["新"],
  ],
  [
    "evidence-gap-check",
    () =>
      readRow(
        lines(
          "```",
          "```bash",
          FEATURE,
          D6,
          PLAN("GET /b"),
          "```",
          "",
          FEATURE,
          D6,
          PLAN("GET /a"),
        ),
        "plan",
      ).endpoints,
    ["GET /a"],
  ],
  [
    "procedure-staleness-check",
    () =>
      procedureIds(
        lines(
          "```",
          "```bash",
          CHANGE,
          D6,
          PC("PC-002"),
          "```",
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
])(
  "%s: 情報文字列の付いた行でフェンスを閉じず、フェンスの中の表を読まない",
  (_name, read, expected) => {
    expect(read()).toEqual(expected);
  },
);

test("コメントを空白にして初めてフェンスに見える行では、フェンスを開かない", () => {
  const { tables } = parseTables(
    lines(
      "```<!-- ` -->",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "```",
      "| x | y |",
      "|---|---|",
      "| 9 | 9 |",
      "```",
    ),
  );
  expect(tables.map((t) => t.rows)).toEqual([[[" 1 ", " 2 "]]]);
});

test("バックスラッシュが 2 つ続く `\\\\<!--` とバッククォートは、エスケープにならない", () => {
  expect(
    norm(lines("| a | b |", "|---|---|", "| 1 | \\\\<!-- x --> y |", "| 2 | \\\\` <!-- z --> ` |")),
  ).toEqual([
    ["1", "\\\\ y"],
    ["2", "\\\\` <!-- z --> `"],
  ]);
});

// 閉じないコードフェンス（#679 の利用者の決定 A）。閉じる行に情報文字列を付けると（` ```sh ` など）フェンスは閉じず、
// 文書の末尾までフェンスの中になる。後ろの表を警告なしに読まずに通さないよう、開いた行の番号を返して、各スクリプトが止める。
test.each([
  [
    "閉じたフェンス",
    lines("```bash", "cmd", "```", "", "| a | b |", "|---|---|", "| 1 | 2 |"),
    null,
  ],
  [
    "情報文字列の付いた行で閉じたつもりのフェンス",
    lines("```bash", "cmd", "```sh", "", "| a | b |", "|---|---|", "| 1 | 2 |"),
    1,
  ],
  ["閉じた後に開き直したフェンス", lines("```", "x", "```", "", "```", "y"), 5],
  ["字下げした `~~~` のフェンス", lines("説明", "   ~~~", "x"), 2],
  ["閉じない HTML コメントの中のフェンス行", lines("<!--", "```", "x"), null],
  ["閉じた HTML コメントの中のフェンス行", lines("<!--", "```", "-->"), null],
  ["フェンスが無い", lines("| a | b |", "|---|---|", "| 1 | 2 |"), null],
])(
  "parseTables は、末尾まで閉じないフェンスを開いた行の番号を返す: %s",
  (_name, text, expected) => {
    expect(parseTables(text).unclosedFence).toBe(expected);
  },
);

test.each([
  [
    "asset-delivery-check",
    () => readAssetLedger(lines(ASSET, "|---|---|---|", COPY("新"), "", "```bash", "cmd", "```sh")),
  ],
  [
    "evidence-gap-check",
    () => readRow(lines(FEATURE, D6, PLAN("GET /a"), "", "```bash", "cmd", "```sh"), "plan"),
  ],
  [
    "procedure-staleness-check",
    () =>
      procedureIds(lines(CHANGE, D6, PC("PC-001"), "", RECORD, D6, "", "```bash", "cmd", "```sh")),
  ],
])("%s: 閉じないコードフェンスは、開いた行の番号を付けて止める", (name, read) => {
  const line = name === "procedure-staleness-check" ? 8 : 5;
  expect(read).toThrow(`${line} 行目で開いたコードフェンスが閉じていない`);
});

test("procedure-staleness-check: 閉じないフェンスが表を読めなくしたときは、表が無いエラーより先にフェンスを報告する", () => {
  const r = readProcedureLedger(
    lines("```bash", "cmd", "```sh", "", CHANGE, D6, PC("PC-001")),
    new Set(),
  );
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.errors[0]).toContain("1 行目で開いたコードフェンスが閉じていない");
  expect(r.errors.join("\n")).toContain("表が無い");
});

test.each([
  [
    "asset-delivery-check",
    () =>
      readAssetLedger(
        lines(ASSET, "|---|---|---|", COPY("新"), "", "```bash", "cmd", "```"),
      ).copyRows.map((r) => r.kind),
    ["新"],
  ],
  [
    "evidence-gap-check",
    () =>
      readRow(lines(FEATURE, D6, PLAN("GET /a"), "", "```bash", "cmd", "```"), "plan").endpoints,
    ["GET /a"],
  ],
  [
    "procedure-staleness-check",
    () =>
      procedureIds(lines(CHANGE, D6, PC("PC-001"), "", RECORD, D6, "", "```bash", "cmd", "```")),
    ["PC-001"],
  ],
])("誤検知しないことの確認: %s は、閉じたコードフェンスでは止めない", (_name, read, expected) => {
  expect(read()).toEqual(expected);
});
