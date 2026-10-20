// 配布スキルの `.mjs` の JSDoc の検査（check-jsdoc-types.ts）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                          |
// | -------------- | --------------------------------------------------------------------------- |
// | JSDoc の @type | 表明（1 行・複数行・入れ子の波括弧・const）/ 宣言の注釈 / @satisfies       |
// | 型の書き方     | `any` / `*` / `?` / Function / 型引数の無い Object / 入れ子の any / Object.<K, V> / Array<T> / unknown |
// | 型引数の数     | デフォルトが any の型（型チェッカーで解決する）で 0・1・2・すべて / 型引数 2 つの型（IteratorResult）で 1・2 |
// | 型の名前の解決 | lib の型 / 同じ名前の自作の型（@typedef・@template 付き）/ 修飾した名前（globalThis.Generator） |
// | Program        | tsconfig.skills.json が在る / 無い / 対象が include の外                    |
// | ts コメント    | @ts-ignore（行）/ @ts-expect-error（ブロック）/ @ts-nocheck / 文字列の中    |
// | 置き場所       | skills/<name>/scripts・assets / その他のディレクトリ / .mjs でない          |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findEscapes, isTarget } from "./check-jsdoc-types.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

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
  ["型引数の無い Generator", "/** @param {Generator} g */\nfunction f(g) {}\n", "Generator（3"],
  [
    "型引数が 1 つの Generator",
    "/** @returns {Generator<string>} */\nfunction* f() {}\n",
    "Generator（3",
  ],
  [
    "型引数が 2 つの Generator",
    "/** @returns {Generator<string, void>} */\nfunction* f() {}\n",
    "Generator（3",
  ],
  [
    "型引数が 1 つの Iterator",
    "/** @param {Iterator<string>} i */\nfunction f(i) {}\n",
    "Iterator（3",
  ],
  [
    "型引数が 1 つの Iterable",
    "/** @param {Iterable<string>} i */\nfunction f(i) {}\n",
    "Iterable（3",
  ],
  [
    "型引数が 1 つの AsyncIterator",
    "/** @param {AsyncIterator<string>} i */\nfunction f(i) {}\n",
    "AsyncIterator（3",
  ],
  [
    "型引数が 1 つの IterableIterator",
    "/** @param {IterableIterator<string>} i */\nfunction f(i) {}\n",
    "IterableIterator（3",
  ],
  [
    "型引数が 1 つの AsyncIterableIterator",
    "/** @param {AsyncIterableIterator<string>} i */\nfunction f(i) {}\n",
    "AsyncIterableIterator（3",
  ],
  [
    "型引数の無い AsyncGenerator",
    "/** @param {AsyncGenerator} g */\nfunction f(g) {}\n",
    "AsyncGenerator（3",
  ],
  // 型引数が 2 つの型（IteratorResult<T, TReturn = any>）は、型ごとの数で判定する。
  [
    "型引数が 1 つの IteratorResult",
    "/** @param {IteratorResult<string>} r */\nfunction f(r) {}\n",
    "IteratorResult（2",
  ],
  // DOM の型も lib から求める。
  [
    "型引数の無い ReadableStream",
    "/** @param {ReadableStream} s */\nfunction f(s) {}\n",
    "ReadableStream（1",
  ],
  // 修飾した名前も、解決すれば lib の Generator である。
  [
    "修飾した名前の Generator",
    "/** @param {globalThis.Generator<string>} g */\nfunction f(g) {}\n",
    "globalThis.Generator（3",
  ],
  // 継承と実装を宣言するタグの型も、省いた型引数に any が入る。
  [
    "@extends の型引数の無い ReadableStream",
    "/** @extends {ReadableStream} */\nclass S extends ReadableStream {}\n",
    "ReadableStream（1",
  ],
  [
    "@augments の型引数の無い ReadableStream",
    "/** @augments {ReadableStream} */\nclass S extends ReadableStream {}\n",
    "ReadableStream（1",
  ],
  [
    "@implements の型引数が 1 つの AsyncIterator",
    "/** @implements {AsyncIterator<string>} */\nclass I {\n  async next() {\n    return { done: true, value: undefined };\n  }\n}\n",
    "AsyncIterator（3",
  ],
])("JSDoc の型の any 相当を検出する: %s", (_name, text, kind) => {
  const v = find(text);
  expect(v).toHaveLength(1);
  expect(v[0]).toMatch(/^1: JSDoc の型に /);
  expect(v[0]).toContain(kind);
});

test.each([
  ["unknown", "/** @param {unknown} v */\nfunction f(v) {}\n"],
  ["Object.<K, V>", "/** @type {Object.<string, number>} */\nconst a = {};\n"],
  ["Record", "/** @type {Record<string, unknown>} */\nconst a = {};\n"],
  ["object", "/** @param {object} v */\nfunction f(v) {}\n"],
  // 型引数の無い Array は、tsc が TS2314 で失敗にするので、このチェックでは数えない。
  ["型引数の無い Array", "/** @param {Array} a */\nfunction f(a) {}\n"],
  ["Array<T>", "/** @param {Array<string>} a */\nfunction f(a) {}\n"],
  [
    "型引数が 2 つの IteratorResult",
    "/** @param {IteratorResult<string, void>} r */\nfunction f(r) {}\n",
  ],
  [
    "型引数が 3 つの Iterator",
    "/** @param {Iterator<string, void, unknown>} i */\nfunction f(i) {}\n",
  ],
  [
    "型引数が 3 つの Iterable",
    "/** @param {Iterable<Node, unknown, unknown>} i */\nfunction f(i) {}\n",
  ],
  ["Generator<T, R, N>", "/** @param {Generator<number, void, unknown>} g */\nfunction f(g) {}\n"],
  ["Array.<T>", "/** @param {Array.<string>} a */\nfunction f(a) {}\n"],
  ["T[]", "/** @param {string[]} a */\nfunction f(a) {}\n"],
  ["Promise<T>", "/** @returns {Promise<void>} */\nfunction f() {}\n"],
  // 名前ではなく、解決した宣言の型引数で判定する。同じ名前の自作の型は、lib の型として扱わない。
  [
    "自作の Iterator（@typedef）",
    "/** @typedef {{ a: string }} Iterator */\n/** @param {Iterator} i */\nfunction f(i) {}\n",
  ],
  [
    "型引数 1 つの自作の Generator",
    "/**\n * @template T\n * @typedef {{ v: T }} Generator\n */\n/** @param {Generator<string>} g */\nfunction f(g) {}\n",
  ],
  [
    "@extends で型引数を書いた ReadableStream",
    "/** @extends {ReadableStream<string>} */\nclass S extends ReadableStream {}\n",
  ],
  [
    "修飾した名前で型引数をすべて書いた Generator",
    "/** @param {globalThis.Generator<string, void, unknown>} g */\nfunction f(g) {}\n",
  ],
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
  ["skills/demo/assets/lib/a.mjs", true],
  ["skills/demo/references/a.mjs", true],
  ["skills/demo/hooks/a.mjs", true],
  ["skills/a.mjs", false],
  ["skills/demo/scripts/a.ts", false],
  ["scripts/gates/a.mjs", false],
  [".agents/skills/demo/scripts/a.mjs", false],
])("対象の判定: %s → %s", (path, expected) => {
  expect(isTarget(path)).toBe(expected);
});

// CLI が型を解決するのに読む設定。include と言語の設定は実リポジトリの tsconfig.skills.json に揃え、
// 型の宣言（types）と paths は読まない（一時リポジトリには node_modules が無い）。
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    allowJs: true,
    checkJs: true,
    strict: true,
    noEmit: true,
    target: "es2024",
    lib: ["es2024", "dom"],
    module: "nodenext",
    moduleResolution: "nodenext",
    types: [],
  },
  include: ["skills/*/**/*.mjs"],
});

/** 一時的な git リポジトリを作り、ファイルを追跡する。tsconfig.skills.json は、null を渡さなければ置く。 */
function makeRepo(files: Record<string, string>, tsconfig: string | null = TSCONFIG): string {
  const root = makeTempDir("jsdoc-types-");
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { timeout: CHILD_TIMEOUT_MS, cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q");
  if (tsconfig !== null) writeFileSync(join(root, "tsconfig.skills.json"), tsconfig);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git("add", "--", ...Object.keys(files));
  return root;
}

function runCli(cwd: string) {
  const r = spawnSync(process.execPath, [script], {
    timeout: CHILD_TIMEOUT_MS,
    cwd,
    encoding: "utf8",
  });
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

test("CLI: 型の名前を、実リポジトリと同じく tsconfig.skills.json の Program で解決する", () => {
  const root = makeRepo({
    "skills/demo/scripts/gen.mjs": "/** @returns {Generator<string>} */\nexport function* f() {}\n",
    "skills/demo/scripts/own.mjs":
      "/** @typedef {{ a: string }} Iterator */\n/** @param {Iterator} i */\nexport function g(i) {}\n",
  });
  const r = runCli(root);
  expect(r.status).toBe(1);
  expect(r.out).toContain(
    "skills/demo/scripts/gen.mjs:1: JSDoc の型に 型引数の足りない Generator（3 つ書く）",
  );
  expect(r.out).not.toContain("own.mjs");
});

test('CLI: import した型（import("x").T）も、デフォルトが any の型引数を省けば検出する', () => {
  const root = makeRepo({
    "skills/demo/scripts/lib.d.mts":
      "export interface Stream<R = any> { r: R }\nexport declare class Box<T = any> { t: T }\n",
    // typeof は値（クラスそのもの）の型で、型引数で具体化しないので検出しない。
    "skills/demo/scripts/ctor.mjs":
      '/** @param {typeof import("./lib.mjs").Box} C */\nexport function h(C) {}\n',
    "skills/demo/scripts/bare.mjs":
      '/** @param {import("./lib.mjs").Stream} s */\nexport function f(s) {}\n',
    "skills/demo/scripts/full.mjs":
      '/** @param {import("./lib.mjs").Stream<string>} s */\nexport function g(s) {}\n',
  });
  const r = runCli(root);
  expect(r.status).toBe(1);
  expect(r.out).toContain(
    "skills/demo/scripts/bare.mjs:1: JSDoc の型に 型引数の足りない Stream（1 つ書く）",
  );
  expect(r.out).not.toContain("full.mjs");
  expect(r.out).not.toContain("ctor.mjs");
});

test("CLI: tsconfig.skills.json が無ければ、型を解決できないとして exit 2", () => {
  const root = makeRepo({ "skills/demo/scripts/ok.mjs": "export {};\n" }, null);
  const r = runCli(root);
  expect(r.status).toBe(2);
  expect(r.out).toContain("tsconfig.skills.json が無い");
});

test("CLI: 対象が tsconfig.skills.json の include の外なら、判定できないとして exit 2", () => {
  const root = makeRepo(
    { "skills/demo/scripts/a.mjs": "export {};\n", "skills/demo/scripts/b.mjs": "export {};\n" },
    JSON.stringify({
      compilerOptions: { allowJs: true, noEmit: true },
      include: ["skills/demo/scripts/a.mjs"],
    }),
  );
  const r = runCli(root);
  expect(r.status).toBe(2);
  expect(r.out).toContain("tsconfig.skills.json の対象に無い");
});

test("自作の @typedef の型引数も、デフォルトが any に解決されるなら書く数を求める", () => {
  // デフォルトに any を直接書くと、その any を上の判定が検出する。別名を挟むと、解決しないと分からない。
  const v = find(
    "/** @typedef {any} Loose */\n/**\n * @template [T=Loose]\n * @typedef {{ x: T }} Box\n */\n/** @param {Box} b */\nfunction f(b) {}\n",
  );
  expect(v).toContain("6: JSDoc の型に 型引数の足りない Box（1 つ書く） を書かない");
});
