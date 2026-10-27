// fallow の設定（`.fallowrc.json`）を、手で書く設定と意図したコピーの宣言から生成するスクリプトの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                   | 値                                                                                   |
// | -------------------- | ------------------------------------------------------------------------------------ |
// | 手で書く設定         | 在る / 無い / JSONC として読めない / object でない / extends を持つ                    |
// | 手で書く ignoreExports | 無い / 正しい / 配列でない / file が空 / exports が空・文字列でない                    |
// | コピーの組           | ファイル全体 / 範囲（export する・しない）/ 同じファイルが両方に属する / 印が崩れている |
// | 組のファイル         | 基準（最初）/ 基準以外 / JS・TS でない                                                 |
// | export の形          | 関数・変数・クラス・interface・型・enum / export { a as b } / default / 分割代入 / export * |
// | 生成先               | 無い / 生成した内容と同じ / 違う                                                     |
// | 引数                 | なし / --check / --index / 知らない引数                                              |
// | 読む元               | 作業ツリー / index（作業ツリーと違う内容）                                            |
import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_PATH,
  OUTPUT_PATH,
  baseIgnores,
  copyIgnores,
  exportedNames,
  main,
  parseJsonc,
  renderConfig,
} from "./generate-fallow-config.ts";
import { DECLARATION_PATH } from "./check-identical-copies.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";
import { write } from "../../../lib/testing/repo-file.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";

// ---- exportedNames ----

test("exportedNames: 宣言の export・export { } の名前・default を読み、export しない宣言は読まない", () => {
  const ts = [
    "export function f() {}",
    "export const a = 1, b = 2;",
    "export class C {}",
    "export interface I {}",
    "export type T = number;",
    "export enum E { X }",
    "const hidden = 1;",
    "function inner() {}",
    "export { hidden as shown, inner };",
    "export default function () {}",
    "",
  ].join("\n");
  expect(exportedNames(ts, "x.ts")).toEqual(
    ["C", "E", "I", "T", "a", "b", "default", "f", "inner", "shown"].sort(),
  );
  expect(exportedNames("const v = 1;\nexport default v;\n", "y.mjs")).toEqual(["default"]);
  expect(exportedNames("function g() {}\n", "z.mjs")).toEqual([]);
  expect(exportedNames('export * as ns from "./m.mjs";\n', "w.mjs")).toEqual(["ns"]);
});

test.each([
  ["分割代入", "export const { a } = o;\n", /分割代入/],
  ["export *", 'export * from "./m.mjs";\n', /export \*/],
])("exportedNames: %s は名前を読めないので例外にする", (_, text, error) => {
  expect(() => exportedNames(text, "x.mjs")).toThrow(error);
});

// ---- baseIgnores ----

test("baseIgnores: 無ければ空、正しい形なら読む", () => {
  expect(baseIgnores({})).toEqual([]);
  expect(baseIgnores({ ignoreExports: [{ file: "a.ts", exports: ["x"] }] })).toEqual([
    { file: "a.ts", exports: ["x"] },
  ]);
});

test.each([
  ["配列でない", { ignoreExports: {} }],
  ["file が空", { ignoreExports: [{ file: "", exports: ["x"] }] }],
  ["exports が空", { ignoreExports: [{ file: "a.ts", exports: [] }] }],
  ["exports が文字列でない", { ignoreExports: [{ file: "a.ts", exports: [1] }] }],
  ["要素が object でない", { ignoreExports: ["a.ts"] }],
])("baseIgnores: %s なら例外にする", (_, base) => {
  expect(() => baseIgnores(base)).toThrow(/ignoreExports/);
});

// ---- parseJsonc ----

test("parseJsonc: コメントを読み、構文の誤りは例外にする", () => {
  expect(parseJsonc('{\n  // c\n  "a": 1\n}', "x")).toEqual({ a: 1 });
  expect(() => parseJsonc('{ "a": }', "x")).toThrow(/JSONC/);
});

// ---- copyIgnores ----

const REGION = ["// r:begin", "function f() {}", "export const g = 1;", "// r:end", ""].join("\n");
const files: Record<string, string> = {
  "s/a.mjs": "export const a = 1;\n",
  "s/b.mjs": "export const a = 1;\n",
  "s/c.mjs": "export const a = 1;\n",
  "s/a.md": "# a\n",
  "s/b.md": "# a\n",
  "s/x.mjs": `export const own = 1;\n${REGION}`,
  "s/y.mjs": `export const other = 1;\n${REGION}`,
  "s/n.mjs": ["// r:begin", "function f() {}", "// r:end", ""].join("\n"),
};
const read = (p: string) => {
  const text = files[p];
  if (text === undefined) throw new Error(`no ${p}`);
  return text;
};

test("copyIgnores: ファイル全体の組は基準以外のコピーのすべての export を、範囲の組は印の間の export だけを外す", () => {
  expect(
    copyIgnores(
      [
        { files: ["s/a.mjs", "s/b.mjs", "s/c.mjs"], reason: "r" },
        { files: ["s/a.md", "s/b.md"], reason: "JS・TS でないファイル" },
        { files: ["s/x.mjs", "s/y.mjs", "s/n.mjs"], reason: "r", region: "r" },
      ],
      read,
    ),
  ).toEqual([
    { file: "s/b.mjs", exports: ["*"] },
    { file: "s/c.mjs", exports: ["*"] },
    { file: "s/y.mjs", exports: ["g"] },
  ]);
});

test("copyIgnores: ファイル全体の組と範囲の組の両方で基準以外なら、すべての export を外す", () => {
  expect(
    copyIgnores(
      [
        { files: ["s/x.mjs", "s/y.mjs"], reason: "r", region: "r" },
        { files: ["s/a.mjs", "s/y.mjs"], reason: "r" },
      ],
      read,
    ),
  ).toEqual([{ file: "s/y.mjs", exports: ["*"] }]);
});

test("copyIgnores: 範囲の印が崩れていれば例外にする", () => {
  expect(() =>
    copyIgnores([{ files: ["s/x.mjs", "s/a.mjs"], reason: "r", region: "r" }], read),
  ).toThrow(/s\/a\.mjs/);
});

// ---- main・renderConfig ----

const BASE =
  '{\n  // 手で書く設定\n  "entry": ["s/a.mjs"],\n  "ignoreExports": [{ "file": "s/z.mjs", "exports": ["z"] }]\n}\n';
const GROUPS = { groups: [{ files: ["s/a.mjs", "s/b.mjs"], reason: "r" }] };

function makeRepo(base: string | null = BASE) {
  const root = makeTempDir("fallow-config-");
  if (base !== null) write(root, BASE_PATH, base);
  write(root, DECLARATION_PATH, JSON.stringify(GROUPS));
  for (const [p, t] of Object.entries(files)) write(root, p, t);
  return root;
}

const output = (root: string): unknown => JSON.parse(readFileSync(join(root, OUTPUT_PATH), "utf8"));

test("main: 手で書く設定に、手で書く例外とコピーの分を合わせた ignoreExports を書き、$schema を直下からのパスにする", () => {
  const root = makeRepo();
  expect(main([], root)).toBe(0);
  expect(output(root)).toEqual({
    $schema: "./node_modules/fallow/schema.json",
    entry: ["s/a.mjs"],
    ignoreExports: [
      { file: "s/z.mjs", exports: ["z"] },
      { file: "s/b.mjs", exports: ["*"] },
    ],
  });
});

test("main: 生成した内容と同じなら書かず、--check は同じなら 0・違えば 1（書き換えない）", () => {
  const root = makeRepo();
  expect(main(["--check"], root)).toBe(1);
  expect(existsSync(join(root, OUTPUT_PATH))).toBe(false);
  expect(main([], root)).toBe(0);
  expect(main(["--check"], root)).toBe(0);
  write(root, OUTPUT_PATH, "{}\n");
  expect(main(["--check"], root)).toBe(1);
  expect(readFileSync(join(root, OUTPUT_PATH), "utf8")).toBe("{}\n");
});

test.each([
  ["手で書く設定が無い", null],
  ["JSONC として読めない", "{"],
  ["object でない", "[]"],
  ["extends を持つ", '{ "extends": ["x.json"] }'],
])("main: %s なら生成できないので exit 2", (_, base) => {
  const root = makeRepo(base);
  expect(main([], root)).toBe(2);
  expect(existsSync(join(root, OUTPUT_PATH))).toBe(false);
});

test("main: 知らない引数は exit 2", () => {
  expect(main(["--fix"], makeRepo())).toBe(2);
});

test("main: --index は、作業ツリーではなく index の内容から生成する", () => {
  const root = makeRepo();
  // execFileSync は 0 以外の終了で例外を投げるので、git の失敗はテストの失敗になる。
  for (const args of [
    ["init", "-q"],
    ["add", "."],
  ]) {
    execFileSync("git", args, { cwd: root, stdio: "pipe", timeout: CHILD_TIMEOUT_MS });
  }
  write(root, BASE_PATH, '{ "entry": ["s/other.mjs"] }');
  expect(main(["--index"], root)).toBe(0);
  expect(output(root)).toMatchObject({ entry: ["s/a.mjs"] });
  expect(renderConfig(root)).toContain("s/other.mjs");
});
