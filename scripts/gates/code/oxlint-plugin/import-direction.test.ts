// 参照の向きのルール（import-direction.ts）のテスト（Issue #658）。
//
// 判定の表（directionViolation）は、向きごとに、反する参照と反しない参照を同じ数だけ置く。
// ルール全体は実物の oxlint に読ませ、参照の書き方（ts.preProcessFile が集めるもの・createRequire の別名・JSDoc の型）と
// 相対パスの解決を確かめる。
import { expect, test } from "vitest";
import { join } from "node:path";
import { directionViolation, resolveFromRoot } from "./import-direction.ts";
import { runRule } from "./run-oxlint.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";

const RULE = "skills-repo/import-direction";

test.each([
  { from: "scripts/lib/a.ts", to: "scripts/gates/code/b.ts", denied: true },
  { from: "scripts/lib/text/a.ts", to: "scripts/skills/x/b.ts", denied: true },
  { from: "scripts/lib/a.ts", to: "scripts/lib/text/b.ts", denied: false },
  { from: "scripts/lib/a.ts", to: "skills/x/scripts/b.mjs", denied: false },
  { from: "scripts/gates/code/a.ts", to: "scripts/eval/b.ts", denied: true },
  { from: "scripts/hooks/a.ts", to: "scripts/gates/docs/b.ts", denied: true },
  { from: "scripts/gates/code/a.ts", to: "scripts/gates/docs/b.ts", denied: false },
  { from: "scripts/gates/code/a.ts", to: "scripts/lib/b.ts", denied: false },
  { from: "scripts/eval/a.ts", to: "skills/x/scripts/b.mjs", denied: false },
  { from: "scripts/skills/x/a.test.ts", to: "scripts/gates/code/b.ts", denied: false },
  { from: "skills/x/scripts/a.mjs", to: "scripts/lib/b.ts", denied: true },
  { from: "skills/x/scripts/a.mjs", to: "skills/y/scripts/b.mjs", denied: true },
  { from: "skills/x/scripts/a.mjs", to: "skills/xy/scripts/b.mjs", denied: true },
  { from: "skills/x/scripts/a.mjs", to: "../outside.mjs", denied: true },
  { from: "skills/x/scripts/a.mjs", to: "skills/x/scripts/lib/b.mjs", denied: false },
  { from: "skills/x/assets/a.template.ts", to: "skills/lib/b.mjs", denied: false },
  { from: "oxlint.config.ts", to: "scripts/gates/code/b.ts", denied: false },
])("$from → $to は向きに反するか: $denied", ({ from, to, denied }) => {
  expect(directionViolation(from, to) !== null).toBe(denied);
});

test("resolveFromRoot: 相対パスはルートからのパスにし、パッケージの名前は null にする", () => {
  const root = "/repo";
  expect(resolveFromRoot(root, "/repo/scripts/lib/a.ts", "../gates/b.ts")).toBe(
    "scripts/gates/b.ts",
  );
  expect(resolveFromRoot(root, "/repo/scripts/lib/a.ts", "./b.ts")).toBe("scripts/lib/b.ts");
  expect(resolveFromRoot(root, "/repo/skills/x/a.mjs", "../../../c.mjs")).toBe("../c.mjs");
  expect(resolveFromRoot(root, "/repo/scripts/lib/a.ts", "node:fs")).toBeNull();
  expect(resolveFromRoot(root, "/repo/scripts/lib/a.ts", "vitest")).toBeNull();
});

/**
 * 一時ディレクトリに files（ルートからのパス → 内容）を置き、ルールだけを有効にした oxlint の診断を「ファイル:行」で返す。
 * option は、一時ディレクトリ（ルート）を受けてルールのオプションを返す。
 */
function reported(files: Record<string, string>, option: (root: string) => unknown): string[] {
  const root = makeTempDir("import-direction-");
  const lines = runRule({ dir: root, rule: RULE, option: option(root), files });
  return Object.entries(lines)
    .flatMap(([file, found]) => found.map((line) => `${file}:${line}`))
    .sort();
}

test("oxlint: import・export from・import()・型の import と、相対パスの文字列を渡す呼び出しを報告し、向きに反しない参照は報告しない", () => {
  const lib = [
    'import { a } from "../gates/code/b.ts";',
    'export { c } from "../gates/code/b.ts";',
    'export * from "../eval/d.ts";',
    'const e = await import("../hooks/f.ts");',
    'const i = require("../gates/code/b.ts");',
    'export type J = typeof import("../eval/d.ts");',
    'const l = load("../gates/code/b.ts");',
    'const m = obj.require("../gates/code/b");',
    'vi.mock("../hooks/f.ts");',
    'const n = await vi.importActual("../eval/d.json");',
    'const o = createRequire(import.meta.url)("../gates/code/b.ts");',
    'import { g } from "./text/h.ts";',
    'import { readFileSync } from "node:fs";',
    'const k = require("./text/h.ts");',
    'const p = readFileSync("../gates/docs/x.md");',
    'const q = join(dir, "../gates/code");',
    "",
  ].join("\n");
  expect(reported({ "scripts/lib/a.ts": lib }, (root) => ({ root }))).toEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16].map((n) => `scripts/lib/a.ts:${n}`).sort(),
  );
});

test("oxlint: import = require・テンプレート文字列の import()・createRequire の別名・JSDoc の型の参照も報告する", () => {
  const lib = [
    'import a = require("../gates/code/b.ts");',
    "const c = await import(`../eval/d.ts`);",
    "const r = createRequire(import.meta.url);",
    'const e = r("../hooks/f.ts");',
    '/** @typedef {import("../gates/code/b.ts").T} T */',
    "const s = 'import(\"../gates/code/b.ts\")';",
    '// require("../gates/code/b.ts")',
    'const t = r("./text/h.ts");',
    "",
  ].join("\n");
  expect(reported({ "scripts/lib/a.ts": lib }, (root) => ({ root }))).toEqual([
    "scripts/lib/a.ts:1",
    "scripts/lib/a.ts:2",
    "scripts/lib/a.ts:4",
    "scripts/lib/a.ts:5",
  ]);
});

test("oxlint: 配布スキルの .mjs の JSDoc の型が、自分のディレクトリの外を参照したら報告する", () => {
  const mjs = [
    '/** @typedef {import("../../../scripts/lib/x.ts").T} T */',
    '/** @param {import("./lib/y.mjs").U} u */',
    "export const f = (u) => u;",
    "",
  ].join("\n");
  expect(reported({ "skills/x/scripts/a.mjs": mjs }, (root) => ({ root }))).toEqual([
    "skills/x/scripts/a.mjs:1",
  ]);
});

test("oxlint: 正規表現の中のバッククォート・宣言より前の createRequire の別名・import した createRequire の別名でも報告し、同じ参照を 2 回報告しない", () => {
  const lib = [
    'import { createRequire as cr } from "node:module";',
    "const re = /`/;",
    'import { a } from "../gates/code/b.ts";',
    'function f() { return r("../eval/d.ts"); }',
    "const r = cr(import.meta.url);",
    "const require = createRequire(import.meta.url);",
    'const g = require("../hooks/f.ts");',
    "const h = await import(`../eval/sub/${name}.ts`);",
    "",
  ].join("\n");
  expect(reported({ "scripts/lib/a.ts": lib }, (root) => ({ root }))).toEqual([
    "scripts/lib/a.ts:3",
    "scripts/lib/a.ts:4",
    "scripts/lib/a.ts:7",
  ]);
});

test("oxlint: JSDoc の @example のコード・型の式（{…}）の外の文・JSDoc でないコメントは参照として扱わない", () => {
  const lib = [
    "/**",
    ' * 使い方の説明で import("../gates/code/b.ts") と書いた文。',
    ' * @param {import("../gates/code/b.ts").T} t',
    " * @example",
    ' * import { a } from "../gates/code/b.ts";',
    ' * const x = { y: import("../eval/d.ts") };',
    " * @returns {void}",
    " */",
    "export function f(t) {}",
    '/* JSDoc でないコメント {import("../gates/code/b.ts")} */',
    "",
  ].join("\n");
  expect(reported({ "scripts/lib/a.ts": lib }, (root) => ({ root }))).toEqual([
    "scripts/lib/a.ts:3",
  ]);
});

test("oxlint: JSDoc の @import・/// <reference path>・閉じていない { の後の型の参照と、同じ節点に付いた 2 つ目の JSDoc も報告する", () => {
  const lib = [
    '/// <reference path="../gates/code/ref.d.ts" />',
    '/** @import { T } from "../eval/d.ts" */',
    "/**",
    " * 設定の例は { a: 1 のように書く。",
    ' * @param {import("../gates/code/b.ts").T} t',
    " */",
    "export function f(t) {}",
    "",
  ].join("\n");
  expect(reported({ "scripts/lib/a.mjs": lib }, (root) => ({ root }))).toEqual([
    "scripts/lib/a.mjs:1",
    "scripts/lib/a.mjs:2",
    "scripts/lib/a.mjs:5",
  ]);
});

test("oxlint: new の引数とディレクトリへの参照も判定し、自分のスキルのディレクトリは報告しない", () => {
  const files = {
    "skills/x/scripts/lib/a.mjs": [
      'const u = new URL("../../../../scripts/lib/y.ts", import.meta.url);',
      'const self = resolve(here, "../..");',
      "",
    ].join("\n"),
    "scripts/lib/a.ts": 'const d = join(here, "../gates");\n',
  };
  expect(reported(files, (root) => ({ root }))).toEqual([
    "scripts/lib/a.ts:1",
    "skills/x/scripts/lib/a.mjs:1",
  ]);
});

test("oxlint: 同じ内容でも、root の外のファイルとして読めば向きを当てない", () => {
  const lib = 'import { a } from "../gates/code/b.ts";\n';
  expect(reported({ "scripts/lib/a.ts": lib }, (root) => ({ root: join(root, "sub") }))).toEqual(
    [],
  );
});

test("root のオプションが無いか絶対パスでなければ、oxlint の実行を失敗にする", () => {
  const files = { "scripts/lib/a.ts": "export {};\n" };
  expect(() => reported(files, () => ({}))).toThrow(/oxlint を実行できない/);
  expect(() => reported(files, () => ({ root: "relative" }))).toThrow(/oxlint を実行できない/);
});
