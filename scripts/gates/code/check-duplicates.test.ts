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
// | ベースライン             | 在る / 無い                                                                  |
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
  configIgnores,
  isDeclaredCopy,
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
  write(root, CONFIG_PATH, JSON.stringify(config));
  expect(() => configIgnores(root)).toThrow(/ignore/);
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
  for (const [p, t] of Object.entries(files)) write(root, p, t);
  return root;
}

test("main: ベースラインが無ければ判定できないので exit 2（無いまま合格にしない）", () => {
  const root = makeRepo({ "a.ts": BODY, "b.ts": BODY });
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
