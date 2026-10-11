// 配布スキルの `.mjs` の JSDoc の検査（check-jsdoc-types.ts）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                          |
// | -------------- | --------------------------------------------------------------------------- |
// | JSDoc の @type | 表明（1 行・複数行・入れ子の波括弧・const）/ 宣言の注釈 / @satisfies       |
// | 型の書き方     | `any` / `*` / `?` / 型引数の無い Object・ジェネリック型 / 入れ子の any / Object.<K, V> / Array<T> / unknown |
// | ts コメント    | @ts-ignore（行）/ @ts-expect-error（ブロック）/ @ts-nocheck / 文字列の中    |
// | 置き場所       | skills/<name>/scripts・assets / その他のディレクトリ / .mjs でない          |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findEscapes, isTarget } from "./check-jsdoc-types.ts";
import { makeTempDir } from "../lib/test-tmpdir.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-jsdoc-types.ts");
const find = (text: string) => findEscapes("skills/demo/scripts/a.mjs", text);

test.each([
  ["1 行の表明", "const a = /** @type {string} */ (v);\n", 1],
  // 行番号は、表明する括弧の位置を指す。
  ["複数行の JSDoc の表明", "const a = /**\n * @type {string}\n */ (v);\n", 3],
  ["入れ子の波括弧の表明", "const a = /** @type {{ x: { y: number } }} */ (v);\n", 1],
  ["式の途中の表明", "f(/** @type {Record<string, unknown>} */ (v).x);\n", 1],
])("JSDoc の型の表明を検出する: %s", (_name, text, line) => {
  expect(find(text)).toEqual([
    `${line}: JSDoc の型の表明（/** @type {X} */ (v)）を使わない。型ガードで絞る`,
  ]);
});

test.each([
  ["宣言の注釈", "/** @type {string[]} */\nconst a = [];\n"],
  ["1 行の宣言の注釈", "/** @type {Map<string, number>} */ const m = new Map();\n"],
  ["@satisfies", "const a = /** @satisfies {Record<string, number>} */ ({ x: 1 });\n"],
  // `as const` と同じく、値から型を狭めるだけで検査を外さない。
  ["const の表明", "const a = /** @type {const} */ ([1, 2]);\n"],
  ["括弧だけ", "const a = (v);\n"],
  ["@param の付いた関数", "/** @param {unknown} v */\nfunction f(v) { return (v); }\n"],
  // 括弧で始まる初期化子・値・戻り値。JSDoc は宣言や文に付いていて、括弧には付いていない。
  ["括弧で始まる初期化子の宣言の注釈", "/** @type {string} */ const v = (String(1));\n"],
  ["括弧で始まる値の欄の注釈", "const o = { /** @type {string} */ a: (x) };\n"],
  ["括弧で始まる return の注釈", "function f() { /** @type {string} */ return (x); }\n"],
])("型を外さない書き方は検出しない: %s", (_name, text) => {
  expect(find(text)).toEqual([]);
});

test.each([
  ["any", "/** @param {any} v */\nfunction f(v) {}\n", "any"],
  ["*", "/** @param {*} v */\nfunction f(v) {}\n", "*"],
  ["?", "/** @returns {?} */\nfunction f() {}\n", "?"],
  ["型引数の無い Object", "/** @type {Object} */\nconst a = {};\n", "Object"],
  ["Function", "/** @param {Function} g */\nfunction f(g) {}\n", "Function"],
  ["小文字の function", "/** @param {function} g */\nfunction f(g) {}\n", "Function"],
  ["入れ子の any", "/** @type {Array<{ x: any }>} */\nconst a = [];\n", "any"],
  ["@typedef の any", "/** @typedef {{ x: any }} T */\n", "any"],
  [
    "型引数の無い Generator",
    "/** @param {Generator} g */\nfunction f(g) {}\n",
    "型引数の無い Generator",
  ],
  [
    "型引数の無い AsyncGenerator",
    "/** @param {AsyncGenerator} g */\nfunction f(g) {}\n",
    "型引数の無い AsyncGenerator",
  ],
])("JSDoc の型の any 相当を検出する: %s", (_name, text, kind) => {
  expect(find(text)).toEqual([`1: JSDoc の型に ${kind} を書かない`]);
});

test.each([
  ["unknown", "/** @param {unknown} v */\nfunction f(v) {}\n"],
  ["Object.<K, V>", "/** @type {Object.<string, number>} */\nconst a = {};\n"],
  ["Record", "/** @type {Record<string, unknown>} */\nconst a = {};\n"],
  ["object", "/** @param {object} v */\nfunction f(v) {}\n"],
  // 型引数の無い Array は、tsc が TS2314 で失敗にするので、このチェックでは数えない。
  ["型引数の無い Array", "/** @param {Array} a */\nfunction f(a) {}\n"],
  ["Array<T>", "/** @param {Array<string>} a */\nfunction f(a) {}\n"],
  ["Generator<T, R, N>", "/** @param {Generator<number, void, unknown>} g */\nfunction f(g) {}\n"],
  ["Array.<T>", "/** @param {Array.<string>} a */\nfunction f(a) {}\n"],
  ["T[]", "/** @param {string[]} a */\nfunction f(a) {}\n"],
  ["Promise<T>", "/** @returns {Promise<void>} */\nfunction f() {}\n"],
])("any でない型は検出しない: %s", (_name, text) => {
  expect(find(text)).toEqual([]);
});

test.each([
  ["行コメントの @ts-ignore", "// @ts-ignore\nconst a = 1;\n", "@ts-ignore"],
  ["ブロックの @ts-expect-error", "const a = 1; /* @ts-expect-error */\n", "@ts-expect-error"],
  ["@ts-nocheck", "// @ts-nocheck\nexport {};\n", "@ts-nocheck"],
  ["空のブロックの中", "if (x) {\n  // @ts-ignore\n}\n", "@ts-ignore"],
  ["複数行のブロックコメントの最後の行", "/*\n @ts-ignore */\nexport {};\n", "@ts-ignore"],
  ["ファイルの末尾", "export {};\n// @ts-ignore\n", "@ts-ignore"],
])("ts のコメントを検出する: %s", (_name, text, kind) => {
  const v = find(text);
  expect(v).toHaveLength(1);
  expect(v[0]).toContain(`${kind} で型の検査を外さない`);
});

test.each([
  ["文字列の中", 'const a = "// @ts-ignore";\n'],
  ["テンプレートの中", "const a = `/** @type {any} */ (v)`;\n"],
  ["正規表現の中", "const a = /@ts-ignore/;\n"],
  ["@ts-check", "// @ts-check\nexport {};\n"],
  // TypeScript が指示として読むのはコメントの行の先頭だけで、説明の文章の途中の語は指示ではない。
  ["説明の文章の途中", "// このファイルでは @ts-ignore を使わない\nexport {};\n"],
  // 複数行のブロックコメントは、最後の行だけが指示になる（tsc で確かめた）。
  ["複数行のブロックコメントの途中の行", "/**\n * @ts-ignore\n */\nexport {};\n"],
  // ts-nocheck の指示は、行コメントでだけ有効になる。
  ["ブロックの @ts-nocheck", "/* @ts-nocheck */\nexport {};\n"],
])("コメントでない文字列は検出しない: %s", (_name, text) => {
  expect(find(text)).toEqual([]);
});

test("@ts-* の行番号は、コメントの先頭ではなく指示のある行を指す", () => {
  expect(find("export {};\n/*\n @ts-ignore */\n")).toEqual(["3: @ts-ignore で型の検査を外さない"]);
});

test("行番号は違反の位置を指す", () => {
  expect(find("const a = 1;\n\nconst b = /** @type {string} */ (v);\n")).toEqual([
    "3: JSDoc の型の表明（/** @type {X} */ (v)）を使わない。型ガードで絞る",
  ]);
});

test.each([
  ["skills/demo/scripts/a.mjs", true],
  ["skills/demo/scripts/nested/a.mjs", true],
  ["skills/demo/assets/engine/a.mjs", true],
  ["skills/demo/references/a.mjs", true],
  ["skills/demo/hooks/a.mjs", true],
  ["skills/a.mjs", false],
  ["skills/demo/scripts/a.ts", false],
  ["scripts/gates/a.mjs", false],
  [".agents/skills/demo/scripts/a.mjs", false],
])("対象の判定: %s → %s", (path, expected) => {
  expect(isTarget(path)).toBe(expected);
});

/** 一時的な git リポジトリを作り、ファイルを追跡する。 */
function makeRepo(files: Record<string, string>): string {
  const root = makeTempDir("jsdoc-types-");
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

test("CLI: 対象の違反を、パスと行番号の付いた一覧で報告して exit 1", () => {
  const root = makeRepo({
    "skills/demo/scripts/bad.mjs": "const a = /** @type {string} */ (v);\n",
    "skills/demo/scripts/ok.mjs": "/** @type {string[]} */\nconst a = [];\n",
    // 走査の範囲（skills/・scripts/・.agents/skills/）にあるが、skills/ の外なので対象にしない。
    "scripts/out.mjs": "// @ts-ignore\n",
  });
  const r = runCli(root);
  expect(r.status).toBe(1);
  expect(r.out).toContain("skills/demo/scripts/bad.mjs:1: JSDoc の型の表明");
  expect(r.out).not.toContain("ok.mjs");
  expect(r.out).not.toContain("out.mjs");
});

test("CLI: 作業ツリーから消して index に残るファイルは読まずに通す", () => {
  const root = makeRepo({
    "skills/demo/scripts/ok.mjs": "export {};\n",
    "skills/demo/scripts/removed.mjs": "export {};\n",
  });
  rmSync(join(root, "skills/demo/scripts/removed.mjs"));
  const r = runCli(root);
  expect(r.status).toBe(0);
  expect(r.out).toContain("jsdoc-types: OK");
});

test("CLI: 違反が無ければ件数を出して exit 0", () => {
  const root = makeRepo({ "skills/demo/scripts/ok.mjs": "export {};\n" });
  const r = runCli(root);
  expect(r.status).toBe(0);
  expect(r.out).toContain("jsdoc-types: OK（1 件）");
});

test("CLI: 対象が 0 件なら、判定できないとして exit 2", () => {
  const root = makeRepo({ "docs/readme.md": "x\n" });
  const r = runCli(root);
  expect(r.status).toBe(2);
  expect(r.out).toContain("対象のファイルが 0 件");
});
