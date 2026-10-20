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
import { findViolations, isTarget, normalizeArgs } from "./check-type-guard-brands.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

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
    const r = spawnSync("git", args, { timeout: CHILD_TIMEOUT_MS, cwd: root, encoding: "utf8" });
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

function runCli(cwd: string, args: string[] = []) {
  const r = spawnSync(process.execPath, [script, ...args], {
    timeout: CHILD_TIMEOUT_MS,
    cwd,
    encoding: "utf8",
  });
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

const BAD_MJS =
  '/**\n * @param {unknown} v\n * @returns {v is string}\n */\nexport function f(v) { return typeof v === "string" && v !== ""; }\n';

test("CLI: 引数で渡したファイルだけを検査し、渡していない違反は報告しない", () => {
  const root = makeRepo({
    "skills/demo/scripts/bad.mjs": BAD_MJS,
    "scripts/ok.ts": 'export const g = (v: unknown): v is string => typeof v === "string";\n',
  });
  const only = runCli(root, ["scripts/ok.ts"]);
  expect(only.status).toBe(0);
  expect(only.out).toContain("type-guard-brands: OK（1 件）");
  const bad = runCli(root, ["scripts/ok.ts", "skills/demo/scripts/bad.mjs"]);
  expect(bad.status).toBe(1);
  expect(bad.out).toContain("skills/demo/scripts/bad.mjs:5: f は string の値にも false");
});

test("CLI: 引数のファイルが import する別のファイルの型ガードを読む", () => {
  const root = makeRepo({
    "scripts/guard.ts":
      'export const isS = (x: unknown): x is string => typeof x === "string" && x !== "";\n',
    "scripts/use.ts":
      'import { isS } from "./guard.ts";\nconst isArray = Array.isArray;\nexport const f = (v: unknown): v is string[] => isArray(v) && v.every(isS);\n',
  });
  const r = runCli(root, ["scripts/use.ts"]);
  expect(r.status).toBe(1);
  expect(r.out).toContain("scripts/use.ts:3: f は string[]");
  expect(r.out).not.toContain("scripts/guard.ts");
});

test("CLI: 引数のファイルがすべて対象の外なら、検査するものが無いので exit 0", () => {
  const root = makeRepo({ "scripts/ok.ts": "export const a = 1;\n", "docs/a.md": "x\n" });
  const r = runCli(root, ["docs/a.md", "."]);
  expect(r.status).toBe(0);
  expect(r.out).toContain("渡された 2 件に対象のファイルが無い");
});

test("CLI: 渡されたファイルが無ければ、パスの誤りとして exit 2", () => {
  const root = makeRepo({ "scripts/ok.ts": "export const a = 1;\n" });
  const r = runCli(root, ["scripts/ok.ts", "scripts/gone.ts"]);
  expect(r.status).toBe(2);
  expect(r.out).toContain("渡されたファイルが無い: scripts/gone.ts");
});

test("CLI: リポジトリの外のファイルを渡されたら exit 2", () => {
  const root = makeRepo({ "scripts/ok.ts": "export const a = 1;\n" });
  const r = runCli(root, ["../outside.ts"]);
  expect(r.status).toBe(2);
  expect(r.out).toContain("外のファイルを渡された");
});

test.each([
  ["直下からの相対パス", "/r", ["scripts/a.ts"], ["scripts/a.ts"]],
  ["サブディレクトリからの相対パス", "/r/scripts", ["a.ts"], ["scripts/a.ts"]],
  ["絶対パス", "/x", ["/r/skills/b.mjs"], ["skills/b.mjs"]],
  ["リポジトリの外", "/r", ["../a.ts"], null],
  ["リポジトリの直下そのもの（対象の外として扱う）", "/r", ["."], [""]],
])("引数のパスをリポジトリの直下からのパスにする: %s", (_name, cwd, args, expected) => {
  expect(normalizeArgs(args, cwd, "/r")).toEqual(expected);
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

test.each([
  [
    "オーバーロードの宣言に書いた型述語",
    'function f(v: unknown): v is string;\nfunction f(v: unknown) { return typeof v === "string" && v !== ""; }\n',
  ],
  [
    "括弧で囲んだ注釈の関数の型",
    'const f: ((v: unknown) => v is string) = (v) => typeof v === "string" && v !== "";\n',
  ],
  [
    "条件式の枝の初期化子",
    'const f: (v: unknown) => v is string = c ? (v) => typeof v === "string" && v !== "" : g;\n',
  ],
  [
    "symbol",
    'function f(v: unknown): v is symbol { return typeof v === "symbol" && v.description !== undefined; }\n',
  ],
])("型述語の置き場所と種類を広げて検出する: %s", (_name, text) => {
  expect(ts(text)).toHaveLength(1);
});

test("絞る型に無い種類にも true を返す本体は、ブランド型ではなく判定を直すよう報告する", () => {
  expect(
    ts(
      'function f(v: unknown): v is string { return typeof v === "string" || typeof v === "number"; }\n',
    ),
  ).toEqual(["1: f は string に無い種類の値にも true を返す。判定か絞る型を直す"]);
});

test.each([
  [
    "クラスの欄",
    'class C {\n  g: (v: unknown) => v is string = (v) => typeof v === "string" && v !== "";\n}\n',
    "2: g は",
  ],
  [
    "代入",
    'const o = {};\n/** @type {(v: unknown) => v is string} */\no.g = (v) => typeof v === "string" && v !== "";\n',
    "3: o.g は",
  ],
])("報告に型ガードの名前を書く: %s", (name, text, prefix) => {
  // 代入の JSDoc の @type は、TypeScript が JavaScript でだけ読む。
  const out = name === "代入" ? mjs(text) : ts(text);
  expect(out).toHaveLength(1);
  expect(out[0].startsWith(prefix)).toBe(true);
});

test.each([
  ["every のコールバック", 'a.every((x): x is string => typeof x === "string" && x !== "");\n'],
  ["some のコールバック", 'a.some((x): x is string => typeof x === "string" && x !== "");\n'],
  ["独自の関数の引数", 'check(xs, (x): x is string => typeof x === "string" && x !== "");\n'],
  [
    ".ts の JSDoc の @returns（TypeScript は型ガードとして扱わない）",
    '/** @returns {v is string} */\nfunction f(v: unknown): boolean { return typeof v === "string" && v !== ""; }\n',
  ],
])("呼び出しの引数に渡した関数と、型述語の無い関数は検出しない: %s", (_name, text) => {
  expect(ts(text)).toEqual([]);
});

test.each([
  [
    "JSDoc の ?string",
    '/**\n * @param {unknown} v\n * @returns {v is ?string}\n */\nfunction f(v) { return v === null || (typeof v === "string" && v !== ""); }\n',
  ],
])("JSDoc の型の書き方を型チェッカーで読む: %s", (_name, text) => {
  expect(mjs(text)).toHaveLength(1);
});

test.each([
  [
    "印の無い交差 string & {}",
    'function f(v: unknown): v is string & {} { return typeof v === "string" && v !== ""; }\n',
  ],
  [
    "後ろのオーバーロードの型述語",
    'function f(v: unknown): v is "a";\nfunction f(v: unknown): v is string;\nfunction f(v: unknown) { return typeof v === "string" && v !== ""; }\n',
  ],
])("ブランドでない交差と、すべてのオーバーロードを検査する: %s", (_name, text) => {
  expect(ts(text)).toEqual([expect.stringContaining("ブランド型に絞っていない")]);
});

test("絞る型より狭い配列だけを受ける本体は、ブランド型の不足として報告する", () => {
  expect(
    ts(
      'function f(v: unknown): v is (string | number)[] { return isArray(v) && v.every((x) => typeof x === "string"); }\n',
    ),
  ).toEqual([expect.stringContaining("ブランド型に絞っていない")]);
});

test.each([
  [
    "文脈の型の引数名が実装と違う",
    'const f: (value: unknown) => value is string = (v) => typeof v === "string";\n',
  ],
  [
    "オーバーロードの引数名が実装と違う",
    'function f(a: unknown): a is string;\nfunction f(v: unknown) { return typeof v === "string"; }\n',
  ],
  [
    "引数の型から null を除く !==",
    "function f(v: string | null): v is string { return v !== null; }\n",
  ],
  [
    "引数の型から null と undefined を除く !=",
    "function f(v: string | null | undefined): v is string { return v != null; }\n",
  ],
  [
    "欄の名前が __ で始まらないブランド型",
    'function f(v: unknown): v is string & { readonly brand: true } { return typeof v === "string" && v !== ""; }\n',
  ],
])("判定が型と一致する型ガードを誤って検出しない: %s", (_name, text) => {
  expect(ts(text)).toEqual([]);
});

test.each([
  [
    "関数の宣言",
    'function isS(x: unknown): x is string { return typeof x === "string"; }\nconst f = (v: unknown): v is string[] => isArray(v) && v.every(isS);\n',
  ],
  [
    "アロー関数で初期化した変数",
    'const isS = (x: unknown): x is string => typeof x === "string";\nconst f = (v: unknown): v is string[] => isArray(v) && v.every(isS);\n',
  ],
  [
    "null も受ける要素の型ガード",
    'const isS = (x: unknown): x is string | null => x === null || typeof x === "string";\nfunction f(v: unknown): v is (string | null)[] { return isArray(v) && v.every(isS); }\n',
  ],
  [
    "括弧で包んだ名前",
    'const isS = (x: unknown): x is string => typeof x === "string";\nconst f = (v: unknown): v is string[] => isArray(v) && v.every((isS));\n',
  ],
])("every に名前で渡した型ガードの判定が型と一致すれば違反にしない: %s", (_name, text) => {
  expect(ts(text)).toEqual([]);
});

test.each([
  ["import", 'import { isS } from "./g.ts";\n'],
  ["別名の import", 'import { isStrDecl as isS } from "./g.ts";\n'],
])("every に名前で渡した型ガードを import の先までたどる: %s", (_name, head) => {
  const guard = (body: string) => ({
    "scripts/g.ts": `export const isS = (x: unknown): x is string => ${body};\nexport function isStrDecl(x: unknown): x is string { return ${body}; }\n`,
  });
  const text = `${head}const f = (v: unknown): v is string[] => isArray(v) && v.every(isS);\n`;
  expect(findViolations(text, "scripts/a.ts", guard('typeof x === "string"'))).toEqual([]);
  expect(findViolations(text, "scripts/a.ts", guard('typeof x === "string" && x !== ""'))).toEqual([
    expect.stringContaining("ブランド型に絞っていない"),
  ]);
});

test.each([
  [
    "追加の条件を持つ要素の型ガード",
    'const isS = (x: unknown): x is string => typeof x === "string" && x !== "";\nconst f = (v: unknown): v is string[] => isArray(v) && v.every(isS);\n',
    "ブランド型に絞っていない",
  ],
  [
    "ブランド型に絞る要素の型ガード",
    'type S = string & { readonly __s: true };\nconst isS = (x: unknown): x is S => typeof x === "string" && x !== "";\nconst f = (v: unknown): v is string[] => isArray(v) && v.every(isS);\n',
    "ブランド型に絞っていない",
  ],
  [
    "絞る型と違う種類の要素の型ガード",
    'const isN = (x: unknown): x is number => typeof x === "number";\nconst f = (v: unknown): v is string[] => isArray(v) && v.every(isN);\n',
    "に無い種類の値にも true を返す",
  ],
  [
    "宣言をたどれない引数の関数",
    "function f(isS: (x: unknown) => x is string, v: unknown): v is string[] { return isArray(v) && v.every(isS); }\n",
    "ブランド型に絞っていない",
  ],
  [
    "自分自身を渡す型ガード",
    "function f(v: unknown): v is string[] { return isArray(v) && v.every(f); }\n",
    "ブランド型に絞っていない",
  ],
  [
    "型述語の無い関数",
    'const isS = (x: unknown): boolean => typeof x === "string";\nconst f = (v: unknown): v is string[] => isArray(v) && v.every(isS);\n',
    "ブランド型に絞っていない",
  ],
  [
    "引数の型から null を除く否定の要素の型ガード（要素はどの種類でもありうる）",
    "const isS = (x: string | null): x is string => x !== null;\nconst f = (v: unknown): v is string[] => isArray(v) && v.every(isS);\n",
    "ブランド型に絞っていない",
  ],
  [
    "後から別の関数を代入できる let の変数",
    'let isS = (x: unknown): x is string => typeof x === "string";\nconst f = (v: unknown): v is string[] => isArray(v) && v.every(isS);\n',
    "ブランド型に絞っていない",
  ],
])(
  "every に名前で渡した型ガードの判定が型と一致しなければ違反にする: %s",
  (_name, text, message) => {
    // 追加の条件を持つ要素の型ガードは、それ自体も違反として報告される。ここでは配列の型ガード f の報告を見る。
    const lines = text.split("\n");
    const fLine = lines.findIndex((l) => /\bf\b.*v is string\[\]/.test(l)) + 1;
    expect(ts(text)).toContainEqual(
      expect.stringMatching(new RegExp(`^${fLine}: f は .*${message}`)),
    );
  },
);

test("== null は undefined にも true を返すので、v is null には判定を直すよう報告する", () => {
  expect(ts("const f = (v: unknown): v is null => v == null;\n")).toEqual([
    expect.stringContaining("に無い種類の値にも true を返す"),
  ]);
});
