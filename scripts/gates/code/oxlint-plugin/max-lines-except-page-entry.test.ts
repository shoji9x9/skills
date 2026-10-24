// 最上位で export した本体を除いて関数の行数を数えるルール（max-lines-except-page-entry.ts）のテスト（Issue #758）。
//
// 実物の oxlint に JS プラグインとして読ませて確かめる。行数は空行も数えるので、本体を空行で埋めて長さを決める。
// 外すのは、ファイルの最上位で export した関数の宣言だけで、入れ子の関数・export しない関数・export した関数式は数える。
// oxlint の起動は時間がかかるので、デフォルトのオプションで確かめるケースはファイルを分けて置き、1 回の起動でまとめて判定する。
import { beforeAll, expect, test } from "vitest";
import { runRule } from "./run-rule.ts";
import { makeSharedTempDir, makeTempDir } from "../../../lib/testing/test-tmpdir.ts";

const RULE = "skills-repo/max-lines-per-function-except-page-entry";

/** 全体が lines 行になる関数の本体（開きと閉じの 2 行を除いた空行）。 */
const body = (lines: number) => "\n".repeat(lines - 1);
/** コードの n 行（各行が 1 つの文）。 */
const code = (n: number) => "  void 0;\n".repeat(n);

/** 1 行目から 51 行の関数を置くケース。 */
const TABLE = [
  {
    name: "最上位で export した関数の宣言",
    head: "export function entry() {",
    tail: "}",
    reported: false,
  },
  { name: "export しない関数の宣言", head: "function helper() {", tail: "}", reported: true },
  {
    name: "export した関数式",
    head: "export const entry = function () {",
    tail: "};",
    reported: true,
  },
  {
    name: "export したアロー関数",
    head: "export const entry = () => {",
    tail: "};",
    reported: true,
  },
  {
    name: "export default の関数の宣言",
    head: "export default function entry() {",
    tail: "}",
    reported: true,
  },
  { name: "即時実行の関数", head: "(() => {", tail: "})();", reported: false },
].map((c, i) => ({ ...c, file: `table-${i}.page.mjs` }));

/** 1 つのファイルで確かめるケース（ファイル名 → 内容）。 */
const CASES: Record<string, string> = {
  // 本体の中に入れ子で書いた関数（宣言・アロー関数）は数える。本体そのものは 100 行を超えても数えない。
  "nested.page.mjs": [
    "export function entry() {",
    `  function helper() {${body(51)}}`,
    `  const arrow = () => {${body(51)}};`,
    `  function short() {${body(50)}}`,
    "  return helper() + arrow() + short();",
    "}",
    "",
  ].join("\n"),
  // 入れ子の関数の中で export した名前を持つ関数（最上位ではない）は、本体として扱わない。
  "deep.page.mjs": [
    "export function entry() {",
    "  function outer() {",
    `    function entry2() {${body(51)}}`,
    "    return entry2();",
    "  }",
    "  return outer();",
    "}",
    "",
  ].join("\n"),
  "boundary.page.mjs": `function a() {${body(50)}}\nfunction b() {${body(51)}}\n`,
  // 本体の行は、入れ子の関数・空行・コメントだけの行を除いて数える。開きと閉じの 2 行を含めて 50 行なら報告しない。
  "entry-50.page.mjs": `export function e() {\n${code(48)}}\n`,
  "entry-51.page.mjs": `export function e() {\n${code(49)}}\n`,
  // コードの 30 行に、コメント・空行・入れ子の関数を足しても、本体は 32 行と数える（入れ子の 51 行の関数は報告する）。
  "entry-mixed.page.mjs": [
    "export function e() {",
    "  /**",
    ...Array.from({ length: 30 }, () => "   * 説明"),
    "   */",
    `  function helper() {${body(51)}}`,
    "",
    "  // 行のコメント",
    "  /* ブロックのコメント */",
    code(30).replace(/\n$/, ""),
    "}",
    "",
  ].join("\n"),
  // 入れ子の関数の中のコードの行（45 行）は、本体の行に数えない。本体は開きと閉じと return の 3 行と、入れ子の関数の外の 5 行である。
  "entry-nested-code.page.mjs": `export function e() {\n  function h() {\n${code(45)}  }\n${code(5)}  return h();\n}\n`,
  // コードと同じ行のコメントは、その行をコードとして数える。
  "entry-trailing.page.mjs": `export function e() {\n${code(49).replace(/;\n/g, "; // c\n")}}\n`,
};

const dir = makeSharedTempDir("max-lines-except-page-entry-");
let lines: Record<string, number[]> = {};
beforeAll(() => {
  const files: Record<string, string> = { ...CASES };
  for (const c of TABLE) files[c.file] = `${c.head}${body(51)}${c.tail}\n`;
  lines = runRule({ dir, rule: RULE, files });
});

test.each(TABLE)("$name が 51 行なら、報告するか: $reported", ({ file, reported }) => {
  expect(lines[file]).toEqual(reported ? [1] : []);
});

test("本体の中に入れ子で書いた関数は数え、本体は数えない", () => {
  expect(lines["nested.page.mjs"]).toEqual([2, 53]);
});

test("入れ子の関数の中の関数は、最上位の export でないので数える", () => {
  expect(lines["deep.page.mjs"]).toEqual([2, 3]);
});

test("本体は、入れ子の関数・空行・コメントを除いて 50 行なら報告せず、51 行なら報告する", () => {
  expect(lines["entry-50.page.mjs"]).toEqual([]);
  expect(lines["entry-51.page.mjs"]).toEqual([1]);
});

test("本体のコメント・空行・入れ子の関数の行は、本体の行に数えない", () => {
  expect(lines["entry-mixed.page.mjs"]).toEqual([34]);
});

test("入れ子の関数の中のコードの行は、本体の行に数えない", () => {
  expect(lines["entry-nested-code.page.mjs"]).toEqual([]);
});

test("コードと同じ行にあるコメントは、その行をコードとして数える", () => {
  expect(lines["entry-trailing.page.mjs"]).toEqual([1]);
});

test("境界: 50 行の関数は報告せず、51 行の関数は報告する", () => {
  expect(lines["boundary.page.mjs"]).toEqual([51]);
});

test("オプションの max を上限にする", () => {
  const files = {
    "a.page.mjs": `export function e() {\n  function a() {${body(4)}}\n  function b() {${body(3)}}\n}\n`,
  };
  const found = runRule({
    dir: makeTempDir("max-lines-page-option-"),
    rule: RULE,
    option: { max: 3 },
    files,
  });
  expect(found["a.page.mjs"]).toEqual([2]);
});

test("max が 1 以上の整数でなければ、oxlint の実行を失敗にする", () => {
  const files = { "a.page.mjs": "function a() {}\n" };
  expect(() =>
    runRule({ dir: makeTempDir("max-lines-page-option-"), rule: RULE, option: { max: 0 }, files }),
  ).toThrow(/oxlint を実行できない/);
});
