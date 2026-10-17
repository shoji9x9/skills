// 型ガードの絞る型の検査（check-type-guard-brands.ts）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力は次のとおりである。
//
// | 軸           | 値                                                                                                    |
// | ------------ | ----------------------------------------------------------------------------------------------------- |
// | 型述語の書き方 | TypeScript の戻り値の型 / JSDoc の @returns / 変数の JSDoc の @type / asserts                       |
// | 絞る型       | string / number / string \| null / string[] / ブランド型 / オブジェクトの型                           |
// | 本体         | typeof だけ / typeof と null の \|\| / isArray と every(typeof) / 余分な条件 / 2 文以上のブロック     |
// | 渡し方       | 宣言 / filter のコールバック / every のコールバック                                                   |
// | 置き場所     | scripts/ / skills/ / private skill / 配布スキルのコピー / .d.ts / .ts・.mjs でない                    |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findViolations, isTarget } from "./check-type-guard-brands.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-type-guard-brands.ts");
const ts = (text: string) => findViolations(text, "scripts/a.ts");
const mjs = (text: string) => findViolations(text, "skills/demo/scripts/a.mjs");

test.each([
  [
    "空文字を除く string",
    'function f(v: unknown): v is string { return typeof v === "string" && v !== ""; }\n',
  ],
  [
    "trim する string",
    'const f = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";\n',
  ],
  [
    "有限の number",
    'function f(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }\n',
  ],
  [
    "string | null に絞る",
    'function f(v: unknown): v is string | null { return v === null || (typeof v === "string" && v !== ""); }\n',
  ],
  [
    "空でない string[]",
    "function f(v: unknown): v is string[] { return Array.isArray(v) && v.length > 0; }\n",
  ],
  ["他の関数を呼ぶ", "function f(v: unknown): v is string { return g(v); }\n"],
  [
    "2 文以上のブロック",
    'function f(v: unknown): v is string { const t = typeof v; return t === "string"; }\n',
  ],
  ["every のコールバック", 'a.every((x): x is string => typeof x === "string" && x !== "");\n'],
])("ブランド型でない型ガードの余分な条件を検出する（TypeScript）: %s", (_name, text) => {
  expect(ts(text)).toHaveLength(1);
});

test.each([
  [
    "@returns",
    '/**\n * @param {unknown} v\n * @returns {v is string}\n */\nfunction f(v) { return typeof v === "string" && v !== ""; }\n',
  ],
  [
    "変数の @type",
    '/** @type {(v: unknown) => v is string} */\nconst f = (v) => typeof v === "string" && v !== "";\n',
  ],
])("ブランド型でない型ガードの余分な条件を検出する（JSDoc）: %s", (_name, text) => {
  expect(mjs(text)).toHaveLength(1);
});

test("行番号と名前を報告する", () => {
  expect(
    ts(
      '\n\nfunction nonEmpty(v: unknown): v is string { return typeof v === "string" && v !== ""; }\n',
    ),
  ).toEqual(["3: nonEmpty は string の値にも false を返しうるのに、ブランド型に絞っていない"]);
});

test.each([
  ["typeof だけ", 'function f(v: unknown): v is string { return typeof v === "string"; }\n'],
  [
    "typeof と null",
    'const f = (v: unknown): v is number | null => typeof v === "number" || v === null;\n',
  ],
  [
    "isArray と every(typeof)",
    'const f = (v: unknown): v is string[] => isArray(v) && v.every((x) => typeof x === "string");\n',
  ],
  [
    "ブランド型",
    'function f(v: unknown): v is string & { readonly __f: true } { return typeof v === "string" && v !== ""; }\n',
  ],
  [
    "配列のブランド型",
    "function f(v: unknown): v is string[] & { readonly __f: true } { return Array.isArray(v) && v.length > 0; }\n",
  ],
  [
    "asserts",
    'function f(v: unknown): asserts v is string { if (typeof v !== "string" || v === "") throw new Error(); }\n',
  ],
  ["filter のコールバック", 'a.filter((x): x is string => typeof x === "string" && x !== "");\n'],
  [
    "オブジェクトの型（対象外）",
    'function f(v: unknown): v is { a: string } { return isRecord(v) && v.a !== ""; }\n',
  ],
  [
    "型述語でない関数",
    'function f(v: unknown): boolean { return typeof v === "string" && v !== ""; }\n',
  ],
])("判定が型と一致するものと対象外のものは検出しない（TypeScript）: %s", (_name, text) => {
  expect(ts(text)).toEqual([]);
});

test.each([
  [
    "@returns のブランド型",
    '/**\n * @param {unknown} v\n * @returns {v is string & { readonly __f: true }}\n */\nfunction f(v) { return typeof v === "string" && v !== ""; }\n',
  ],
  [
    "@returns の typeof だけ",
    '/**\n * @param {unknown} v\n * @returns {v is string}\n */\nfunction f(v) { return typeof v === "string"; }\n',
  ],
])("判定が型と一致するものは検出しない（JSDoc）: %s", (_name, text) => {
  expect(mjs(text)).toEqual([]);
});

test.each([
  ["scripts/ の .ts", "scripts/gates/a.ts", true],
  ["skills/ の .mjs", "skills/demo/scripts/a.mjs", true],
  ["private skill の .ts", ".agents/skills/priv/scripts/a.ts", true],
  ["配布スキルのコピー", ".agents/skills/demo/scripts/a.mjs", false],
  [".d.ts", "scripts/a.d.ts", false],
  [".js", "scripts/a.js", false],
])("対象のファイル: %s", (_name, file, expected) => {
  expect(isTarget(file, new Set(["priv"]))).toBe(expected);
});

/** 一時的な git リポジトリを作り、ファイルを追跡する。 */
function makeRepo(files: Record<string, string>): string {
  const root = makeTempDir("type-guard-brands-");
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git("add", "--", ...Object.keys(files));
  return root;
}

function runCli(cwd: string) {
  const r = spawnSync(process.execPath, [script], { cwd, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test("CLI: 違反をパスと行番号の付いた一覧で報告して exit 1", () => {
  const root = makeRepo({
    "skills/demo/scripts/bad.mjs":
      '/**\n * @param {unknown} v\n * @returns {v is string}\n */\nexport function f(v) { return typeof v === "string" && v !== ""; }\n',
    "scripts/ok.ts": 'export const g = (v: unknown): v is string => typeof v === "string";\n',
  });
  const r = runCli(root);
  expect(r.status).toBe(1);
  expect(r.out).toContain("skills/demo/scripts/bad.mjs:5: f は string の値にも false");
  expect(r.out).not.toContain("ok.ts");
});

test("CLI: 違反が無ければ件数を出して exit 0", () => {
  const root = makeRepo({
    "scripts/ok.ts": 'export const g = (v: unknown): v is string => typeof v === "string";\n',
  });
  const r = runCli(root);
  expect(r.status).toBe(0);
  expect(r.out).toContain("type-guard-brands: OK（1 件）");
});

test("CLI: 対象のファイルが 0 件なら判定できないので exit 2", () => {
  const root = makeRepo({ "docs/a.md": "x\n" });
  const r = runCli(root);
  expect(r.status).toBe(2);
});

test.each([
  ["否定した typeof", 'function f(v: unknown): v is string { return typeof v !== "string"; }\n'],
  [
    "null を除く number | null",
    'function f(v: unknown): v is number | null { return v !== null && typeof v === "number"; }\n',
  ],
  [
    "null を受けない number | null",
    'function f(v: unknown): v is number | null { return typeof v === "number"; }\n',
  ],
  [
    "Array<string> の長さ",
    "function f(v: unknown): v is Array<string> { return Array.isArray(v) && v.length > 0; }\n",
  ],
  [
    "変数の型の注釈",
    'const f: (v: unknown) => v is string = (v) => typeof v === "string" && v !== "";\n',
  ],
])("種類の集合が絞る型と違う本体を検出する: %s", (_name, text) => {
  expect(ts(text)).toHaveLength(1);
});

test.each([
  [
    "オブジェクトの欄の @type",
    'const o = {\n  /** @type {(v: unknown) => v is string} */\n  isX: (v) => typeof v === "string" && v !== "",\n};\n',
  ],
  [
    "代入の @type",
    'let g;\n/** @type {(v: unknown) => v is string} */\ng = (v) => typeof v === "string" && v !== "";\n',
  ],
])("置いた先の JSDoc の @type を読む: %s", (_name, text) => {
  expect(mjs(text)).toHaveLength(1);
});

test.each([
  ["型の別名", "type G = (v: unknown) => v is string;\n"],
  ["引数の型", "function apply(g: (v: unknown) => v is string) { return g; }\n"],
  ["本体の無い宣言", "declare function f(v: unknown): v is string;\n"],
  [
    "括弧で囲んだ filter のコールバック",
    'xs.filter(((v): v is string => typeof v === "string" && v !== ""));\n',
  ],
  [
    "Array<string> と every(typeof)",
    'function f(v: unknown): v is Array<string> { return isArray(v) && v.every((x) => typeof x === "string"); }\n',
  ],
  [
    "readonly string[] と every(typeof)",
    'const f = (v: unknown): v is readonly string[] => isArray(v) && v.every((x) => typeof x === "string");\n',
  ],
])("本体の無い形と、判定が型と一致するものは検出しない: %s", (_name, text) => {
  expect(ts(text)).toEqual([]);
});
