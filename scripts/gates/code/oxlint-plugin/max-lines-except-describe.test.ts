// describe のコールバックを除いて関数の行数を数えるルール（max-lines-except-describe.ts）のテスト（Issue #658）。
//
// 実物の oxlint に JS プラグインとして読ませて確かめる。行数は空行も数えるので、本体を空行で埋めて長さを決める。
// 外すのは、vitest から import した describe（と別名の suite）の呼び出しの引数だけで、他の呼び出しの引数・メソッド・ヘルパー関数は数える。
// oxlint の起動は時間がかかるので、デフォルトのオプションで確かめるケースはファイルを分けて置き、1 回の起動でまとめて判定する。
import { beforeAll, expect, test } from "vitest";
import { calleeRoot } from "./max-lines-except-describe.ts";
import { runRule } from "./run-rule.ts";
import { makeSharedTempDir, makeTempDir } from "../../../lib/testing/test-tmpdir.ts";

const RULE = "skills-repo/max-lines-per-function-except-describe";
const IMPORT = 'import { describe, suite, test } from "vitest";';

/** 全体が lines 行になる関数の本体（開きと閉じの 2 行を除いた空行）。 */
const body = (lines: number) => "\n".repeat(lines - 1);

/** 1 行目で vitest から import し、2 行目に 51 行の関数を置くケース。 */
const TABLE = [
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
].map((c, i) => ({ ...c, file: `table-${i}.test.ts` }));

/** 1 つのファイルで確かめるケース（ファイル名 → 内容）。 */
const CASES: Record<string, string> = {
  // vitest から import していない同じ名前の関数は、describe として扱わない。
  "local-suite.test.ts": [
    "const suite = (name, fn) => fn();",
    `suite("x", () => {${body(51)}});`,
    "",
  ].join("\n"),
  // 別名で import した describe は、ファイルの中の名前で数える。
  "alias.test.ts": [
    'import { describe as group } from "vitest";',
    `group("x", () => {${body(51)}});`,
    `describe("y", () => {${body(51)}});`,
    "",
  ].join("\n"),
  // 名前空間で import した vitest の describe は外し、同じ名前空間の他の関数は数える。
  "namespace.test.ts": [
    'import * as v from "vitest";',
    `v.describe("x", () => {${body(51)}});`,
    `v.describe.skip("y", () => {${body(51)}});`,
    `v.test("z", () => {${body(51)}});`,
    "",
  ].join("\n"),
  "boundary.test.ts": `function a() {${body(50)}}\nfunction b() {${body(51)}}\n`,
  "inside-describe.test.ts": [
    IMPORT,
    'describe("x", () => {',
    `  test("long", () => {${body(51)}});`,
    `  function helper() {${body(51)}}`,
    `  test("short", () => {${body(50)}});`,
    "});",
    "",
  ].join("\n"),
  // キー・引数の括弧・本体を別の行に置く。括弧から数えると 50 行で、キーから数えると 51 行になる。
  "methods.test.ts": [
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
  ].join("\n"),
};

const dir = makeSharedTempDir("max-lines-except-describe-");
let lines: Record<string, number[]> = {};
beforeAll(() => {
  const files: Record<string, string> = { ...CASES };
  for (const c of TABLE) files[c.file] = `${IMPORT}\n${c.head}${body(51)}${c.tail}\n`;
  lines = runRule({ dir, rule: RULE, files });
});

test.each(TABLE)("$name が 51 行なら、報告するか: $reported", ({ file, reported }) => {
  expect(lines[file]).toEqual(reported ? [2] : []);
});

test("vitest から import していない suite に渡したコールバックは数える", () => {
  expect(lines["local-suite.test.ts"]).toEqual([2]);
});

test("別名で import した describe のコールバックは外し、import していない describe のコールバックは数える", () => {
  expect(lines["alias.test.ts"]).toEqual([53]);
});

test("名前空間で import した describe のコールバックは外し、test のコールバックは数える", () => {
  expect(lines["namespace.test.ts"]).toEqual([104]);
});

test("境界: 50 行の関数は報告せず、51 行の関数は報告する", () => {
  expect(lines["boundary.test.ts"]).toEqual([51]);
});

test("describe のコールバックの中の test とヘルパー関数は数える", () => {
  expect(lines["inside-describe.test.ts"]).toEqual([3, 54]);
});

test("メソッドと getter は、キーを含む行から数える", () => {
  // 報告の位置は、関数の始まり（引数の括弧の行）である。
  expect(lines["methods.test.ts"]).toEqual([3, 54, 157]);
});

test("オプションの max を上限にする", () => {
  const files = { "a.test.ts": `function a() {${body(4)}}\nfunction b() {${body(3)}}\n` };
  const found = runRule({
    dir: makeTempDir("max-lines-option-"),
    rule: RULE,
    option: { max: 3 },
    files,
  });
  expect(found["a.test.ts"]).toEqual([1]);
});

test("max の無いオプション（{}）は、デフォルトの 50 行を上限にする", () => {
  const files = { "a.test.ts": `function a() {${body(51)}}\nfunction b() {${body(50)}}\n` };
  const found = runRule({ dir: makeTempDir("max-lines-option-"), rule: RULE, option: {}, files });
  expect(found["a.test.ts"]).toEqual([1]);
});

test("max が 1 以上の整数でなければ、oxlint の実行を失敗にする", () => {
  const files = { "a.test.ts": "function a() {}\n" };
  expect(() =>
    runRule({ dir: makeTempDir("max-lines-option-"), rule: RULE, option: { max: 0 }, files }),
  ).toThrow(/oxlint を実行できない/);
  // 数だけの短縮形（["error", 30]）は schema が受け付けない。デフォルトの 50 行として扱わずに失敗にする。
  expect(() =>
    runRule({ dir: makeTempDir("max-lines-option-"), rule: RULE, option: 30, files }),
  ).toThrow(/oxlint を実行できない/);
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
  const ns = {
    type: "MemberExpression",
    object: { type: "Identifier", name: "v", loc },
    property: { type: "Identifier", name: "describe", loc },
    loc,
  };
  expect(calleeRoot({ type: "MemberExpression", object: ns, property, loc })).toBe("v.describe");
  expect(calleeRoot(undefined)).toBeNull();
});
