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

test("oxlint: import・export from・import()・require()・import 型の向きに反する参照を報告し、反しない参照は報告しない", () => {
  const lib = [
    'import { a } from "../gates/code/b.ts";',
    'export { c } from "../gates/code/b.ts";',
    'export * from "../eval/d.ts";',
    'const e = await import("../hooks/f.ts");',
    'const i = require("../gates/code/b.ts");',
    'export type J = typeof import("../eval/d.ts");',
    'import { g } from "./text/h.ts";',
    'import { readFileSync } from "node:fs";',
    'const k = require("./text/h.ts");',
    'const l = load("../gates/code/b.ts");',
    'const m = obj.require("../gates/code/b.ts");',
    "",
  ].join("\n");
  expect(reported({ "scripts/lib/a.ts": lib }, (root) => ({ root }))).toEqual([
    "scripts/lib/a.ts:1",
    "scripts/lib/a.ts:2",
    "scripts/lib/a.ts:3",
    "scripts/lib/a.ts:4",
    "scripts/lib/a.ts:5",
    "scripts/lib/a.ts:6",
  ]);
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
