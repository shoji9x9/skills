// describe のコールバックを除いて関数の行数を数えるルール（max-lines-except-describe.ts）のテスト（Issue #658）。
//
// 実物の oxlint に JS プラグインとして読ませて確かめる。行数は空行も数えるので、本体を空行で埋めて長さを決める。
// 外すのは describe（と別名の suite）の呼び出しの引数だけで、他の呼び出しの引数・メソッド・ヘルパー関数は数える。
import { expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { calleeRoot } from "./max-lines-except-describe.ts";
import { PLUGIN_PATH, runOxlint } from "./run-oxlint.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";

const RULE = "skills-repo/max-lines-per-function-except-describe";

/** 全体が lines 行になる関数の本体（開きと閉じの 2 行を除いた空行）。 */
const body = (lines: number) => "\n".repeat(lines - 1);

/** source を 1 ファイルに書き、ルールだけを有効にした oxlint の診断の行を返す。 */
function reportedLines(source: string, option?: { max: number }): number[] {
  const dir = makeTempDir("max-lines-except-describe-");
  const config = join(dir, "oxlintrc.json");
  const rule = option ? ["error", option] : "error";
  writeFileSync(
    config,
    JSON.stringify({
      categories: { correctness: "off" },
      jsPlugins: [PLUGIN_PATH],
      rules: { [RULE]: rule },
    }),
  );
  writeFileSync(join(dir, "a.test.ts"), source);
  return runOxlint(["-c", config, join(dir, "a.test.ts")]).map((d) => {
    expect(d.rule).toBe(RULE);
    return d.line;
  });
}

test.each([
  { name: "test のコールバック", head: 'test("x", () => {', tail: "});", reported: true },
  { name: "関数の宣言", head: "function helper() {", tail: "}", reported: true },
  { name: "関数式", head: "const helper = function () {", tail: "};", reported: true },
  { name: "アロー関数", head: "const helper = () => {", tail: "};", reported: true },
  { name: "describe 以外の呼び出しの引数", head: "foo(() => {", tail: "});", reported: true },
  {
    name: "describe という名前のプロパティの呼び出し",
    head: "obj.describe(() => {",
    tail: "});",
    reported: true,
  },
  {
    name: "suite のメソッドの呼び出しの引数",
    head: "suite.add(() => {",
    tail: "});",
    reported: true,
  },
  {
    name: "describe の修飾でないメンバーの呼び出し",
    head: 'describe.custom("x", () => {',
    tail: "});",
    reported: true,
  },
  {
    name: "変数で計算したプロパティの describe の呼び出し",
    head: 'describe[skip]("x", () => {',
    tail: "});",
    reported: true,
  },
  {
    name: "計算したプロパティの describe の呼び出し",
    head: 'describe["skip"]("x", () => {',
    tail: "});",
    reported: true,
  },
  { name: "describe のコールバック", head: 'describe("x", () => {', tail: "});", reported: false },
  { name: "suite のコールバック", head: 'suite("x", () => {', tail: "});", reported: false },
  {
    name: "describe.skip のコールバック",
    head: 'describe.skip("x", () => {',
    tail: "});",
    reported: false,
  },
  {
    name: "describe.each(表) のコールバック",
    head: 'describe.each([1])("x", () => {',
    tail: "});",
    reported: false,
  },
  {
    name: "describe.each`表` のコールバック",
    head: 'describe.each`a`("x", () => {',
    tail: "});",
    reported: false,
  },
  { name: "即時実行の関数", head: "(() => {", tail: "})();", reported: false },
])("$name が 51 行なら、報告するか: $reported", ({ head, tail, reported }) => {
  expect(reportedLines(`${head}${body(51)}${tail}\n`)).toEqual(reported ? [1] : []);
});

test("境界: 50 行の関数は報告せず、51 行の関数は報告する", () => {
  const source = `function a() {${body(50)}}\nfunction b() {${body(51)}}\n`;
  expect(reportedLines(source)).toEqual([51]);
});

test("describe のコールバックの中の test とヘルパー関数は数える", () => {
  const source = [
    'describe("x", () => {',
    `  test("long", () => {${body(51)}});`,
    `  function helper() {${body(51)}}`,
    `  test("short", () => {${body(50)}});`,
    "});",
    "",
  ].join("\n");
  expect(reportedLines(source)).toEqual([2, 53]);
});

test("メソッドと getter は、キーを含む行から数える", () => {
  // キー・引数の括弧・本体を別の行に置く。括弧から数えると 50 行で、キーから数えると 51 行になる。
  const source = [
    "const o = {",
    "  method",
    "  ()",
    `  {${body(49)}},`,
    "  get value",
    "  ()",
    `  {${body(49)}},`,
    "  short",
    "  ()",
    `  {${body(48)}},`,
    "};",
    "class C {",
    "  m",
    "  ()",
    `  {${body(49)}}`,
    "}",
    "",
  ].join("\n");
  // 報告の位置は、関数の始まり（引数の括弧の行）である。
  expect(reportedLines(source)).toEqual([3, 54, 157]);
});

test("オプションの max を上限にする", () => {
  expect(
    reportedLines(`function a() {${body(4)}}\nfunction b() {${body(3)}}\n`, { max: 3 }),
  ).toEqual([1]);
});

test("max が 1 以上の整数でなければ、oxlint の実行を失敗にする", () => {
  expect(() => reportedLines("function a() {}\n", { max: 0 })).toThrow(/oxlint を実行できない/);
});

test("calleeRoot: 名前の根を、メンバー・呼び出し・タグ付きテンプレートの順にたどり、それ以外の形は null にする", () => {
  const loc = { start: { line: 1 }, end: { line: 1 } };
  const id = { type: "Identifier", name: "describe", loc };
  const property = { type: "Identifier", name: "each", loc };
  const member = { type: "MemberExpression", object: id, property, loc };
  expect(calleeRoot(id)).toBe("describe");
  expect(calleeRoot({ type: "CallExpression", callee: member, loc })).toBe("describe");
  expect(calleeRoot({ type: "TaggedTemplateExpression", tag: member, loc })).toBe("describe");
  expect(calleeRoot({ type: "ThisExpression", loc })).toBeNull();
  expect(calleeRoot(undefined)).toBeNull();
});
