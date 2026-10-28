// 重複したコードの検査（check-duplicates.ts）の回帰テスト。
//
// jscpd の判定（どこが重複か）はツールに任せ、このスクリプトが決める部分を確かめる。
// 決める部分は、レポートの読み方、意図したコピー（identical-copies.json の組）を外す条件、ベースラインと終了コードである。
// main は実物の jscpd を一時ディレクトリに当てる（jscpd はこのリポジトリから起動し、一時ディレクトリを絶対パスで走査する）。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                       | 値                                                                          |
// | ------------------------ | --------------------------------------------------------------------------- |
// | レポート                 | 正しい形 / object でない / duplicates が配列でない / sources が無いか負 / isNew が真偽値でない / format が空か無い / lines が 1 以上の整数でない / 断片の名前が空 / 行が整数でない |
// | 重複の 2 つのファイル    | 同じファイル / 同じ組（ファイル全体） / 片方だけが組 / 組に無い              |
// | 範囲を持つ組             | 両方が範囲と重なる / 片方が範囲と重ならない / 範囲の境界の行で重なる / 印が崩れている |
// | 設定の ignore            | 文字列の配列 / 無い / 空文字を含む                                           |
// | 引数                     | なし / --update-baseline / 知らない引数                                      |
// | ベースライン             | 在る / 無い（全体・テストどうしのそれぞれ）                                  |
// | 重複の場所               | テスト以外どうし / テストとテスト以外 / テストどうし（TEST_MIN_TOKENS 未満・以上） |
// | テストのコード           | 在る / 無い（2 回目の走査が 0 件）                                            |
// | 控えた組                 | 在る / 無い / 形が違う（組が 0 件・1 ファイルの組・空文字）。重複の 2 つのファイルが、控えた組にあり今の組に無い / 今も組にある / 控えた組に無い |
// | 重複の形式               | TypeScript / シェル / Markdown（形式はこのリポジトリの .jscpd.json から読む）    |
// | 走査の結果               | 新しい重複 / ベースラインの重複だけ / 登録済みのコピーの重複だけ / 走査したファイルが 0 件 |
import { expect, test } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  BASELINE_PATH,
  CONFIG_PATH,
  type Clone,
  DECLARED_PATH,
  TEST_BASELINE_PATH,
  configIgnores,
  isDeclaredCopy,
  isTestCode,
  isUndeclaredCopy,
  loadDeclared,
  main,
  parseReport,
  regionReader,
} from "./check-duplicates.ts";
import { DECLARATION_PATH } from "../packaging/copies/check-identical-copies.ts";
import { isRecord } from "../../lib/guards.ts";
import { write } from "../../lib/testing/repo-file.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const fragment = (name: string, start = 1, end = 10) => ({ name, start, end });
type Span = [number, number];
/** a の断片と b の断片の重複。spans は [a の行, b の行]（省略すると両方 1〜10 行）。 */
const clone = (
  a: string,
  b: string,
  [at, bt]: [Span, Span] = [
    [1, 10],
    [1, 10],
  ],
): Clone => ({
  format: "typescript",
  lines: at[1] - at[0] + 1,
  isNew: true,
  first: fragment(a, ...at),
  second: fragment(b, ...bt),
});
const report = (duplicates: unknown[], sources: unknown = 2) => ({
  duplicates,
  statistics: { total: { sources } },
});
const raw = (isNew: unknown = true) => ({
  format: "typescript",
  lines: 10,
  isNew,
  firstFile: { name: "a.ts", start: 1, end: 10 },
  secondFile: { name: "b.ts", start: 3, end: 12 },
});

// ---- parseReport ----

test("parseReport: 重複と走査したファイルの数を読む", () => {
  expect(parseReport(report([raw()], 5))).toEqual({
    sources: 5,
    clones: [
      {
        format: "typescript",
        lines: 10,
        isNew: true,
        first: { name: "a.ts", start: 1, end: 10 },
        second: { name: "b.ts", start: 3, end: 12 },
      },
    ],
  });
});

test.each([
  ["object でない", []],
  ["duplicates が配列でない", { duplicates: {}, statistics: { total: { sources: 1 } } }],
  ["sources が無い", { duplicates: [], statistics: { total: {} } }],
  ["sources が負", { duplicates: [], statistics: { total: { sources: -1 } } }],
  ["statistics が無い", { duplicates: [] }],
  ["isNew が真偽値でない", report([raw("yes")])],
  ["断片の名前が空", report([{ ...raw(), firstFile: { name: "", start: 1, end: 2 } }])],
  ["行が整数でない", report([{ ...raw(), secondFile: { name: "b.ts", start: "1", end: 2 } }])],
  ["断片が object でない", report([{ ...raw(), firstFile: null }])],
  ["start が 0", report([{ ...raw(), firstFile: { name: "a.ts", start: 0, end: 2 } }])],
  ["end が start より前", report([{ ...raw(), secondFile: { name: "b.ts", start: 5, end: 4 } }])],
  ["format が無い", report([{ ...raw(), format: undefined }])],
  ["format が空", report([{ ...raw(), format: "" }])],
  ["lines が無い", report([{ ...raw(), lines: undefined }])],
  ["lines が整数でない", report([{ ...raw(), lines: 1.5 }])],
  ["lines が 0", report([{ ...raw(), lines: 0 }])],
])("parseReport: %s なら例外にする（読めないレポートを 0 件として扱わない）", (_, value) => {
  expect(() => parseReport(value)).toThrow();
});

// ---- isDeclaredCopy ----

const fileGroup = { files: ["a.mjs", "b.mjs", "c.mjs"], reason: "姉妹スキルが同じ処理を持つ" };
const regionGroup = { files: ["x.ts", "y.ts"], reason: "雛形に同じ関数を持つ", region: "is-array" };
const ranges: Record<string, { start: number; end: number }> = {
  "x.ts": { start: 10, end: 20 },
  "y.ts": { start: 30, end: 40 },
};
const rangeOf = (file: string) => ranges[file];

test.each([
  ["ファイル全体の組の 2 つのファイル", clone("a.mjs", "c.mjs"), true],
  ["片方だけが組のファイル", clone("a.mjs", "z.mjs"), false],
  ["どちらも組に無い", clone("p.mjs", "q.mjs"), false],
  [
    "同じファイルの中",
    clone("a.mjs", "a.mjs", [
      [1, 10],
      [20, 30],
    ]),
    false,
  ],
  [
    "範囲の組で両方が範囲の中",
    clone("x.ts", "y.ts", [
      [12, 18],
      [32, 38],
    ]),
    true,
  ],
  [
    "範囲の組で断片が範囲の外へ広がる（印の行と直前のコメント）",
    clone("x.ts", "y.ts", [
      [5, 20],
      [25, 40],
    ]),
    true,
  ],
  [
    "範囲の組で境界の行だけが重なる",
    clone("x.ts", "y.ts", [
      [1, 10],
      [40, 50],
    ]),
    true,
  ],
  [
    "範囲の組で片方が範囲と重ならない",
    clone("x.ts", "y.ts", [
      [12, 18],
      [41, 50],
    ]),
    false,
  ],
  [
    "範囲の組で両方が範囲と重ならない",
    clone("x.ts", "y.ts", [
      [21, 30],
      [1, 29],
    ]),
    false,
  ],
])("isDeclaredCopy: %s → %s", (_, c, expected) => {
  expect(isDeclaredCopy(c, [fileGroup, regionGroup], rangeOf)).toBe(expected);
});

// ---- isUndeclaredCopy ----

const declared = [
  ["a.mjs", "c.mjs"],
  ["x.ts", "y.ts"],
];

test.each([
  {
    name: "控えた組から外した 2 つのファイル",
    c: clone("a.mjs", "c.mjs"),
    groups: [],
    expected: true,
  },
  { name: "今も同じ組にある", c: clone("a.mjs", "c.mjs"), groups: [fileGroup], expected: false },
  {
    name: "範囲を持つ組に移した",
    c: clone("x.ts", "y.ts"),
    groups: [regionGroup],
    expected: false,
  },
  { name: "控えた組に無い", c: clone("p.mjs", "q.mjs"), groups: [], expected: false },
  { name: "控えた組に片方だけ", c: clone("a.mjs", "q.mjs"), groups: [], expected: false },
  {
    name: "同じファイルの中",
    c: clone("a.mjs", "a.mjs", [
      [1, 10],
      [20, 30],
    ]),
    groups: [],
    expected: false,
  },
])("isUndeclaredCopy: $name → $expected", ({ c, groups, expected }) => {
  expect(isUndeclaredCopy(c, declared, groups)).toBe(expected);
});

// ---- loadDeclared ----

test.each([
  ["groups が無い", {}],
  ["組が配列でない", { groups: ["a.mjs"] }],
  ["ファイルが空文字", { groups: [["a.mjs", ""]] }],
  ["組が 0 件", { groups: [] }],
  ["1 ファイルだけの組", { groups: [["a.mjs", "c.mjs"], ["b.mjs"]] }],
])("loadDeclared: %s なら例外にする", (_, value) => {
  const root = makeTempDir("duplicates-declared-");
  write(root, DECLARED_PATH, JSON.stringify(value));
  expect(() => loadDeclared(root)).toThrow(/groups/);
});

// ---- regionReader ----

test("regionReader: 印の行の間を 1 始まりの行番号で返す", () => {
  const root = makeTempDir("duplicates-region-");
  write(root, "x.ts", ["a", "// r:begin", "b", "c", "// r:end", "d", ""].join("\n"));
  expect(regionReader(root)("x.ts", "r")).toEqual({ start: 3, end: 4 });
});

test("regionReader: 印が崩れていれば例外にする", () => {
  const root = makeTempDir("duplicates-region-");
  write(root, "x.ts", ["// r:begin", "b", ""].join("\n"));
  expect(() => regionReader(root)("x.ts", "r")).toThrow(/x\.ts/);
});

// ---- configIgnores ----

test.each([
  ["ignore が無い", {}],
  ["空文字を含む", { ignore: ["a/**", ""] }],
  ["文字列でない要素を含む", { ignore: [1] }],
])("configIgnores: %s なら例外にする", (_, config) => {
  const root = makeTempDir("duplicates-config-");
  write(root, CONFIG_PATH, JSON.stringify({ format: ["typescript"], ...config }));
  expect(() => configIgnores(root)).toThrow(/ignore/);
});

test.each([
  ["format が無い", { ignore: [] }, /format/],
  ["format が知らない形式を含む", { format: ["typescript", "tsx"], ignore: [] }, /tsx/],
  ["minTokens が 0", { format: ["typescript"], ignore: [], minTokens: 0 }, /minTokens/],
])("configIgnores: %s なら例外にする", (_, config, message) => {
  const root = makeTempDir("duplicates-config-");
  write(root, CONFIG_PATH, JSON.stringify(config));
  expect(() => configIgnores(root)).toThrow(message);
});

// ---- main（実物の jscpd） ----

// 50 トークン・5 行を超える、同じ内容の関数。
const BODY = [
  "export function total(items: { price: number; count: number }[]): number {",
  "  let sum = 0;",
  "  for (const item of items) {",
  "    if (item.count > 0) sum += item.price * item.count;",
  "    else if (item.count < 0) throw new Error(`count must be positive: ${item.count}`);",
  "  }",
  "  return Math.round(sum * 100) / 100;",
  "}",
  "",
].join("\n");

// BODY と重ならない、閾値を超える大きさのファイル（小さいファイルは jscpd が走査の件数に数えない）。
const OTHER = [
  "export function label(user: { first: string; last: string; age: number }): string {",
  '  const name = [user.first, user.last].filter((part) => part.length > 0).join(" ");',
  "  if (user.age < 0) throw new RangeError(`age must not be negative: ${user.age}`);",
  "  return user.age >= 20 ? `${name} (adult)` : `${name} (minor, ${user.age})`;",
  "}",
  "",
].join("\n");

/** このリポジトリの jscpd の形式（.jscpd.json の format）。形式を外したときに、その形式の重複を検出しなくなることをテストで見つける。 */
const repoConfig: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", CONFIG_PATH), "utf8"),
);
const REPO_FORMATS = isRecord(repoConfig) ? repoConfig.format : undefined;

// 50 トークン・5 行を超える、同じ内容のシェルと Markdown。
const SH_BODY = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'for file in "$@"; do',
  '  if [ ! -f "$file" ]; then echo "missing: $file" >&2; exit 2; fi',
  '  lines=$(wc -l < "$file")',
  '  if [ "$lines" -gt 100 ]; then echo "too long: $file ($lines lines)" >&2; exit 1; fi',
  "done",
  "",
].join("\n");
const MD_BODY = [
  "# 手順",
  "",
  "1. 依存を入れる前に、リポジトリの中で `mise trust` を実行して、設定を信頼する。",
  "2. `pnpm install --frozen-lockfile` で、lockfile のとおりに依存を入れる。",
  "3. `pnpm run lint:js` と `pnpm run typecheck` を実行し、どちらも成功することを確かめる。",
  "4. 失敗したら、出力の最初のエラーから直し、もう一度 2 つのコマンドを実行する。",
  "",
].join("\n");

// テストのコードに置く、BODY・OTHER と重ならないファイル。2 回目の走査が 0 件にならないよう、TEST_MIN_TOKENS を超える大きさにする
// （閾値より小さいファイルは jscpd が走査の件数に数えない）。
const TEST_FILE = [
  'import { expect, test } from "vitest";',
  'test("parses the header", () => {',
  '  const header = { name: "demo", version: [1, 2, 3], tags: ["alpha", "beta"] };',
  '  expect(Object.keys(header).sort()).toEqual(["name", "tags", "version"]);',
  "  expect(header.version.reduce((a, b) => a + b, 0)).toBe(6);",
  '  expect(header.tags.map((tag) => tag.toUpperCase()).join("|")).toBe("ALPHA|BETA");',
  '  expect(JSON.stringify({ ...header, tags: [] })).not.toContain("alpha");',
  '  expect(header.name.padStart(8, "*").length).toBeGreaterThan(header.name.length);',
  "});",
  "",
].join("\n");
// BODY と OTHER をつないだ、TEST_MIN_TOKENS を超える大きさの重複。
const LONG_BODY = BODY + OTHER.replaceAll("label", "labelOf");

/** jscpd の設定（形式はこのリポジトリと同じ）と、identical-copies の宣言（groups）を持つ一時リポジトリ。 */
// identical-copies.json は組を 1 件以上求めるので、デフォルトは走査に関係しないファイルの組にする。
const UNRELATED = [{ files: ["p.mjs", "q.mjs"], reason: "走査に関係しない組" }];

function makeRepo(files: Record<string, string>, groups: unknown[] = UNRELATED) {
  const root = makeTempDir("duplicates-");
  write(
    root,
    CONFIG_PATH,
    JSON.stringify({ format: REPO_FORMATS, ignore: ["**/node_modules/**"] }),
  );
  write(root, DECLARATION_PATH, JSON.stringify({ groups }));
  for (const [p, t] of Object.entries({ "scripts/t.test.ts": TEST_FILE, ...files }))
    write(root, p, t);
  return root;
}

test("main: ベースラインが無ければ判定できないので exit 2（無いまま合格にしない）", () => {
  const root = makeRepo({ "a.ts": BODY, "b.ts": BODY });
  expect(main([], root)).toBe(2);
});

test("main: テストどうしのベースラインが無ければ判定できないので exit 2", () => {
  const root = makeRepo({ "a.ts": OTHER });
  expect(main(["--update-baseline"], root)).toBe(0);
  rmSync(join(root, TEST_BASELINE_PATH));
  expect(main([], root)).toBe(2);
});

test("main: 控えた組が無ければ判定できないので exit 2", () => {
  const root = makeRepo({ "a.ts": OTHER });
  expect(main(["--update-baseline"], root)).toBe(0);
  rmSync(join(root, DECLARED_PATH));
  expect(main([], root)).toBe(2);
});

test("main: 知らない引数は exit 2", () => {
  const root = makeRepo({ "a.ts": BODY });
  expect(main(["--fix"], root)).toBe(2);
});

test("main: ベースラインに無い重複を失敗にし、ベースラインに載せた後は通す", () => {
  const root = makeRepo({ "a.ts": OTHER });
  expect(main(["--update-baseline"], root)).toBe(0);
  expect(existsSync(join(root, BASELINE_PATH))).toBe(true);
  write(root, "b.ts", BODY);
  write(root, "c.ts", BODY);
  expect(main([], root)).toBe(1);
  expect(main(["--update-baseline"], root)).toBe(0);
  expect(main([], root)).toBe(0);
});

/** 重複を置くファイル（1 つなら同じファイルの中に 2 回置く）・内容・期待する終了コード。 */
type Placement = { files: string[]; body?: string; code: number };

test.each<[string, Placement]>([
  [
    "テストとテスト以外の間の短い重複は失敗にする",
    { files: ["scripts/x.test.ts", "b.ts"], code: 1 },
  ],
  [
    "テストどうしの短い重複は数えない",
    { files: ["scripts/x.test.ts", "scripts/skills/y/y.test.ts"], code: 0 },
  ],
  [
    "scripts/ の外の .test.ts はテストのコードとして扱わず、短い重複も失敗にする",
    { files: ["other/scripts/x.test.ts", "other/scripts/y.test.ts"], code: 1 },
  ],
  ["1 つのテストのファイルの中の短い重複も数えない", { files: ["scripts/x.test.ts"], code: 0 }],
  [
    "テストのヘルパーどうしの短い重複も数えない",
    { files: ["scripts/skills/y/h-helpers.ts", "scripts/lib/testing/h.ts"], code: 0 },
  ],
  [
    "テストのヘルパーどうしでも、閾値を超える重複は失敗にする",
    {
      files: ["scripts/skills/y/h-helpers.ts", "scripts/lib/testing/h.ts"],
      body: LONG_BODY,
      code: 1,
    },
  ],
  [
    "テストどうしでも、閾値を超える重複は失敗にする",
    { files: ["scripts/x.test.ts", "scripts/y.test.ts"], body: LONG_BODY, code: 1 },
  ],
  [
    "テストの 1 つのファイルの中の閾値を超える重複も失敗にする",
    { files: ["scripts/x.test.ts"], body: LONG_BODY, code: 1 },
  ],
])("main: %s", (_, { files, body = BODY, code }) => {
  const root = makeRepo({ "a.ts": OTHER });
  expect(main(["--update-baseline"], root)).toBe(0);
  if (files.length === 1)
    write(root, files[0], `${body}\n// ---\n${body.replaceAll("total", "sum")}`);
  else files.forEach((p) => write(root, p, body));
  expect(main([], root)).toBe(code);
});

test.each([
  ["全体の閾値以下", { minTokens: 100 }],
  ["整数でない", { minTokens: "60" }],
])("main: .jscpd.json の minTokens が、テストどうしの閾値に対して%sなら exit 2", (_, extra) => {
  const root = makeRepo({ "a.ts": OTHER });
  write(
    root,
    CONFIG_PATH,
    JSON.stringify({ format: REPO_FORMATS, ignore: ["**/node_modules/**"], ...extra }),
  );
  expect(main(["--update-baseline"], root)).toBe(2);
});

test("main: テストのディレクトリにコードの形式でないファイルしか無ければ、判定できないので exit 2", () => {
  const root = makeRepo({
    "a.ts": OTHER,
    "other/scripts/t.test.ts": TEST_FILE,
    "scripts/skills/x/data.json": "{}",
  });
  rmSync(join(root, "scripts/t.test.ts"));
  expect(main(["--update-baseline"], root)).toBe(2);
});

test("main: テストのファイルがすべて閾値より小さく 2 回目の走査が 0 件でも、判定できるので通す", () => {
  const root = makeRepo({ "a.ts": OTHER, "scripts/t.test.ts": 'test("x", () => {});\n' });
  expect(main(["--update-baseline"], root)).toBe(0);
  expect(main([], root)).toBe(0);
});

test("main: scripts/ の外の .test.ts だけがあり、テストのコードが無ければ、判定できないので exit 2", () => {
  const root = makeRepo({ "a.ts": OTHER, "other/scripts/t.test.ts": TEST_FILE });
  rmSync(join(root, "scripts/t.test.ts"));
  expect(main(["--update-baseline"], root)).toBe(2);
});

test("main: テストのコードが無く 2 回目の走査が 0 件なら、判定できないので exit 2 にし、ベースラインを書かない", () => {
  const root = makeRepo({ "a.ts": OTHER });
  rmSync(join(root, "scripts/t.test.ts"));
  expect(main(["--update-baseline"], root)).toBe(2);
  expect(existsSync(join(root, BASELINE_PATH))).toBe(false);
  expect(existsSync(join(root, TEST_BASELINE_PATH))).toBe(false);
});

test.each([
  ["scripts/gates/code/check-duplicates.test.ts", true],
  ["scripts/skills/kaizen/kaizen-archive-helpers.ts", true],
  ["scripts/skills/parity-diff/fixtures/a/b.md", true],
  ["scripts/lib/testing/test-tmpdir.ts", true],
  ["scripts/skills/x/fixtures/.agents/a.md", true],
  ["scripts/.hidden/a.test.ts", true],
  ["scripts/gates/code/check-duplicates.ts", false],
  ["scripts/lib/guards.ts", false],
  ["skills/kaizen/scripts/kaizen-archive.sh", false],
  ["skills/x/y.test.ts", false],
  [".scripts/skills/c.ts", false],
  ["scripts/.lib/testing/x.ts", false],
])("isTestCode: %s → %s", (file, expected) => {
  expect(isTestCode(file)).toBe(expected);
});

const SISTERS = [{ files: ["b.ts", "c.ts"], reason: "姉妹スキルが同じ処理を持つ" }];

test.each([
  ["シェル", "sh", SH_BODY],
  ["Markdown", "md", MD_BODY],
])("main: %s の重複も、ベースラインに無ければ失敗にする", (_, ext, body) => {
  const root = makeRepo({ "a.ts": OTHER });
  expect(main(["--update-baseline"], root)).toBe(0);
  write(root, `b.${ext}`, body);
  write(root, `c.${ext}`, body);
  expect(main([], root)).toBe(1);
});

test("main: identical-copies.json に登録したコピーどうしの重複は、ベースラインに無くても通す", () => {
  const root = makeRepo({ "a.ts": OTHER }, SISTERS);
  expect(main(["--update-baseline"], root)).toBe(0);
  write(root, "b.ts", BODY);
  write(root, "c.ts", BODY);
  expect(main([], root)).toBe(0);
});

test("main: 登録済みのコピーをベースラインに載せた後で組を宣言から外すと、失敗にする", () => {
  const root = makeRepo({ "a.ts": OTHER, "b.ts": BODY, "c.ts": BODY }, SISTERS);
  const runs = () => [main(["--update-baseline"], root), main([], root)];
  expect(runs()).toEqual([0, 0]);
  write(root, DECLARATION_PATH, JSON.stringify({ groups: UNRELATED }));
  expect(main([], root)).toBe(1);
  // 残すと決めてベースラインを作り直すと、控えた組からも外れて通る。
  expect(runs()).toEqual([0, 0]);
});

test("main: 走査したファイルが 0 件なら判定できないので exit 2", () => {
  const root = makeRepo({ "a.md": "# a\n" });
  rmSync(join(root, "scripts/t.test.ts"));
  expect(main(["--update-baseline"], root)).toBe(2);
});

test("main: 宣言が不正なら、ベースラインを書き換えずに exit 2", () => {
  const root = makeRepo({ "a.ts": OTHER });
  expect(main(["--update-baseline"], root)).toBe(0);
  const before = readFileSync(join(root, BASELINE_PATH), "utf8");
  write(root, "b.ts", BODY);
  write(root, "c.ts", BODY);
  write(root, DECLARATION_PATH, JSON.stringify({ groups: [] }));
  expect(main(["--update-baseline"], root)).toBe(2);
  expect(readFileSync(join(root, BASELINE_PATH), "utf8")).toBe(before);
});

test("main: 設定を読めなければ exit 2", () => {
  const root = makeRepo({ "a.ts": BODY });
  write(root, CONFIG_PATH, "{");
  write(root, BASELINE_PATH, JSON.stringify({ version: 1, fingerprints: {} }));
  write(root, DECLARED_PATH, JSON.stringify({ groups: [["p.mjs", "q.mjs"]] }));
  expect(main([], root)).toBe(2);
});
