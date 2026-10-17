// 配布スキルの抑止コメントと、isArray を持つファイルの検査（check-skill-lint-directives.ts）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸                       | 値                                                                          |
// | ------------------------ | --------------------------------------------------------------------------- |
// | 指示の種類               | oxlint-disable（-next-line・-line）/ eslint-disable / biome-ignore / @ts-expect-error / deno-lint-ignore / 対象外（textlint・shellcheck） |
// | コメントの形             | `//` / `/*` / `/**` / JSDoc の 2 行目以降の `*` / コードの後ろの `//`（空白あり・なし） |
// | コメント以外の出現       | 文章の途中の名前 / 文字列 / テンプレート / 正規表現（どれも `//` を含む形も）  |
// | 拡張子                   | .mjs / .ts / .md（対象外）                                                   |
// | Array.isArray の書き方   | `.isArray` / 改行を挟んだ `.isArray` / `?.isArray` / `["isArray"]` / 分割代入（文字列のキー・2 回の束縛）/ 代入の分割 / コメント・文字列の中（数えない）。判定は oxlint の同じ規則 |
// | Array.isArray の位置     | 型ガードの中の 1 回 / 型ガードの中の 2 回目 / 型ガードの外 / 文字列の `//` の後ろ |
// | 型ガードの関数宣言       | 1 つ / 無い / 2 つ                                                           |
// | 中身の出所               | 未追跡（作業ツリー）/ staged（作業ツリーから消した・作業ツリーで直した）/ どちらにも無い |
// | 指示の後ろ               | 行末 / 空白 / `:` / 受け付ける接尾辞 / 指示を前に含むだけの語（数えない） |
// | 一覧のファイル           | 作業ツリーと staged が同じ / 食い違う                                       |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRegistryStaged,
  findDirectives,
  findOutsideGuard,
  findViolations,
  HOLDERS_REGISTRY,
} from "./check-skill-lint-directives.ts";
import { IS_ARRAY_HOLDERS } from "../../lib/is-array-holders.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-skill-lint-directives.ts");

test.each([
  [
    "// の -next-line",
    "// oxlint-disable-next-line no-restricted-properties -- 理由",
    "oxlint-disable",
  ],
  ["コードの後ろの //", "export const x = 1; // oxlint-disable-line no-console", "oxlint-disable"],
  [
    "空白の無いコードの後ろの //",
    "export const x = 1;// oxlint-disable-line no-console",
    "oxlint-disable",
  ],
  ["/* */", "/* eslint-disable no-console */", "eslint-disable"],
  ["/** */", "/** eslint-disable-next-line */", "eslint-disable"],
  ["JSDoc の行頭の *", "/**\n * eslint-disable no-console\n */", "eslint-disable"],
  ["biome-ignore", "// biome-ignore lint/style: 理由", "biome-ignore"],
  ["@ts-expect-error", "  // @ts-expect-error 型が合わない", "@ts-expect-error"],
  ["deno-lint-ignore", "// deno-lint-ignore no-explicit-any", "deno-lint-ignore"],
  ["biome-ignore-all", "// biome-ignore-all lint: 理由", "biome-ignore"],
  ["deno-lint-ignore-file", "// deno-lint-ignore-file", "deno-lint-ignore"],
  ["閉じの */ の直前", "/* eslint-disable*/", "eslint-disable"],
])("抑止の指示（%s）を違反にする", (_label, comment, directive) => {
  const found = findDirectives(`export const a = 1;\n${comment}\n`);
  expect(found).toHaveLength(1);
  expect(found[0]).toMatch(new RegExp(`^\\d+: ${directive}$`));
});

test("JSDoc の 2 行目以降の指示は、その行の番号で報告する", () => {
  expect(findDirectives("/**\n * 説明\n * eslint-disable no-console\n */\n")).toEqual([
    "3: eslint-disable",
  ]);
});

test.each([
  ["// textlint-disable"],
  ["# shellcheck disable=SC2016\n"],
  ["// ツールへの指示（eslint-disable・@ts-expect-error など）は除かない"],
  ['const s = "eslint-disable";'],
  ['const s = "// eslint-disable";'],
  ["const s = `/* oxlint-disable */`;"],
  ["const re = /\\/\\/ eslint-disable/;"],
  ["const re = /^(eslint|oxlint-)/;"],
  ["// eslint-disablement の話"],
  ["// oxlint-disabled のとき"],
  ["// @ts-expect-erroring"],
  ["// biome-ignored"],
  ["// deno-lint-ignores"],
  ["// eslint-disable-foo"],
  ["// biome-ignore-file"],
])("指示として読まれない %s は違反にしない", (line) => {
  expect(findDirectives(`${line}\n`)).toEqual([]);
});

const GUARD = [
  "// 説明に `Array.isArray` と書く",
  "/** `Array.isArray` より狭く絞る */",
  "// is-array-js:begin",
  "/**",
  " * `Array.isArray` の代わりに使う。",
  " */",
  "function isArray(value) {",
  "  return Array.isArray(value);",
  "}",
  "// is-array-js:end",
  'export const ok = [isArray([]), "Array.isArray(x)", "https://x"];',
];

test("型ガードの中の 1 回と、コメント・文字列の中の名前は違反にしない", () => {
  expect(findOutsideGuard(GUARD.join("\n"))).toEqual([]);
});

test.each([
  ["プロパティの参照", "export const ng = Array.isArray([]);"],
  ["改行を挟んだ参照", "export const ng = Array\n  .isArray([]);"],
  ["オプショナルチェーン", "export const ng = Array?.isArray([]);"],
  ["要素の参照", 'export const ng = Array["isArray"]([]);'],
  ["分割代入", "const { isArray: builtin } = Array;"],
  ["文字列の // の後ろ", 'export const ng = ["https://x", Array.isArray([])];'],
  ["空白の無い行コメントの前", "export const ng = Array.isArray([]);// 説明"],
  ["文字列のキーの分割代入", 'const { ["isArray"]: builtin } = Array;'],
  ["代入の分割", "let f;\n({ isArray: f } = Array);"],
])("型ガードの外の Array.isArray（%s）を違反にする", (_label, line) => {
  const found = findOutsideGuard([...GUARD, line].join("\n"));
  expect(found).toHaveLength(1);
  expect(found[0]).toMatch(/^1[23]: 型ガード isArray の外で Array.isArray を使っている$/);
});

test("同じ分割代入で 2 回束縛した Array.isArray を、2 件の違反にする", () => {
  const line = "const { isArray: first, isArray: second } = Array;";
  expect(findOutsideGuard([...GUARD, line].join("\n"))).toEqual([
    "12: 型ガード isArray の外で Array.isArray を使っている",
    "12: 型ガード isArray の外で Array.isArray を使っている",
  ]);
});

test("空白の無い行コメントの中の Array.isArray は違反にしない", () => {
  expect(findOutsideGuard([...GUARD, "export const x = 1;// Array.isArray(v)"].join("\n"))).toEqual(
    [],
  );
});

test("型ガードと同じ行の、関数の後ろの Array.isArray を外として数える", () => {
  const text =
    "// 日本語のコメント\nfunction isArray(value) { return value; } Array.isArray([]);\n";
  expect(findOutsideGuard(text)).toEqual([
    "2: 型ガード isArray の外で Array.isArray を使っている",
    "2: 型ガード isArray の中の Array.isArray が 1 回だけでない（0 回）",
  ]);
});

test("型ガードと同じ行の、関数の前の Array.isArray を外として数える", () => {
  const text =
    "// 日本語のコメント\nexport const a = Array.isArray([]); function isArray(value) { return Array.isArray(value); }\n";
  expect(findOutsideGuard(text)).toEqual(["2: 型ガード isArray の外で Array.isArray を使っている"]);
});

test("型ガードの中の 2 回目の Array.isArray を違反にする", () => {
  const text = GUARD.join("\n").replace(
    "  return Array.isArray(value);",
    "  Array.isArray([]);\n  return Array.isArray(value);",
  );
  expect(findOutsideGuard(text)).toEqual([
    "7: 型ガード isArray の中の Array.isArray が 1 回だけでない（2 回）",
  ]);
});

test.each([
  ["無い", GUARD.join("\n").replace("function isArray(value)", "function other(value)"), 0],
  ["2 つ", `${GUARD.join("\n")}\nfunction isArray(v) { return v; }`, 2],
])("関数宣言 isArray が 1 つだけでない（%s）ものを違反にする", (_label, text, n) => {
  expect(findOutsideGuard(text)).toEqual([`関数宣言 isArray が 1 つだけ無い（${n} 件）`]);
});

function git(root: string, ...args: string[]) {
  const res = spawnSync("git", args, { timeout: CHILD_TIMEOUT_MS, cwd: root, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
}

function makeRepo(files: Record<string, string>): string {
  const root = makeTempDir("skill-lint-directives-");
  git(root, "init", "-q");
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

const NOTE = "（このリポジトリの設定を前提にした抑止。設定の overrides で外す）";

test("配布スキルで禁じた拡張子（.jsx・.tsx・.js）は見ない（check-js-extensions が禁じる）", () => {
  const root = makeRepo({
    "skills/demo/assets/a.jsx": "export const a = <div>// eslint-disable</div>;\n",
    "skills/demo/assets/b.tsx": "// eslint-disable\n",
    "skills/demo/scripts/c.js": "// eslint-disable\n",
  });
  try {
    const files = [
      "skills/demo/assets/a.jsx",
      "skills/demo/assets/b.tsx",
      "skills/demo/scripts/c.js",
    ];
    expect(findViolations(root, files, [])).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("配布スキルの .mjs と .ts の指示を検出し、.md は見ない", () => {
  const root = makeRepo({
    "skills/demo/scripts/a.mjs": "// oxlint-disable-next-line no-console\n",
    "skills/demo/assets/b.template.ts": "// @ts-expect-error x\n",
    "skills/demo/references/c.md": "// eslint-disable\n",
  });
  try {
    const files = [
      "skills/demo/scripts/a.mjs",
      "skills/demo/assets/b.template.ts",
      "skills/demo/references/c.md",
    ];
    expect(findViolations(root, files, [])).toEqual([
      `skills/demo/scripts/a.mjs:1: oxlint-disable${NOTE}`,
      `skills/demo/assets/b.template.ts:1: @ts-expect-error${NOTE}`,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("staged の中身を読む（作業ツリーから消したファイル・作業ツリーで直したファイル）", () => {
  const root = makeRepo({
    "skills/demo/scripts/gone.mjs": "// eslint-disable\n",
    "skills/demo/scripts/fixed.mjs": "// eslint-disable\n",
  });
  try {
    git(root, "add", "skills");
    rmSync(join(root, "skills/demo/scripts/gone.mjs"));
    writeFileSync(join(root, "skills/demo/scripts/fixed.mjs"), "export {};\n");
    const files = ["skills/demo/scripts/fixed.mjs", "skills/demo/scripts/gone.mjs"];
    expect(findViolations(root, files, [])).toEqual([
      `skills/demo/scripts/fixed.mjs:1: eslint-disable${NOTE}`,
      `skills/demo/scripts/gone.mjs:1: eslint-disable${NOTE}`,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("index にも作業ツリーにも無い走査対象は、判定できないので例外にする", () => {
  const root = makeRepo({ "skills/demo/a.mjs": "export {};\n" });
  try {
    expect(() => findViolations(root, ["skills/demo/missing.mjs"], [])).toThrow(
      "index にも作業ツリーにも無い",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("一覧のファイルの作業ツリーと staged が食い違えば例外にし、そろっていれば通す", () => {
  const root = makeRepo({ [HOLDERS_REGISTRY]: "export const A = 1;\n" });
  try {
    git(root, "add", HOLDERS_REGISTRY);
    expect(() => assertRegistryStaged(root)).not.toThrow();
    writeFileSync(join(root, HOLDERS_REGISTRY), "export const A = 2;\n");
    expect(() => assertRegistryStaged(root)).toThrow("作業ツリーと staged の中身が違う");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("一覧のファイルが index に無ければ（未追跡・index から外した）例外にする", () => {
  const root = makeRepo({ [HOLDERS_REGISTRY]: "export const A = 1;\n" });
  try {
    expect(() => assertRegistryStaged(root)).toThrow("index に無い");
    git(root, "add", HOLDERS_REGISTRY);
    git(root, "rm", "--cached", "-q", HOLDERS_REGISTRY);
    expect(() => assertRegistryStaged(root)).toThrow("index に無い");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("一覧に挙げたファイルが作業ツリーにだけあり、index に無ければ違反にする", () => {
  const holder = "skills/demo/scripts/lib/is-array.mjs";
  const guard =
    "function isArray(value) {\n  return Array.isArray(value);\n}\nexport { isArray };\n";
  const root = makeRepo({ [holder]: guard });
  try {
    expect(findViolations(root, [], [holder])).toEqual([
      `${holder}: 一覧に挙げたファイルが index に無い（stage する）`,
    ]);
    git(root, "add", holder);
    expect(findViolations(root, [], [holder])).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("一覧のファイルが無ければ違反にする", () => {
  const root = makeRepo({ "skills/demo/a.mjs": "export {};\n" });
  try {
    expect(findViolations(root, [], ["skills/demo/scripts/lib/is-array.mjs"])).toEqual([
      "skills/demo/scripts/lib/is-array.mjs: scripts/lib/is-array-holders.ts に挙げたファイルが無い",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// CLI は実物の IS_ARRAY_HOLDERS を読むので、一時リポジトリにも型ガードのファイルを置く。
// 置かないと「一覧のファイルが無い」でも exit 1 になり、終了コードで指示の検出を確かめられない。
// 一覧のファイル自身も index に置く（無いと exit 2 になる）。
const HOLDER_FILES = Object.fromEntries(IS_ARRAY_HOLDERS.map((p) => [p, `${GUARD.join("\n")}\n`]));

function makeCliRepo(files: Record<string, string>): string {
  const root = makeRepo({ ...HOLDER_FILES, [HOLDERS_REGISTRY]: "export {};\n", ...files });
  git(root, "add", HOLDERS_REGISTRY, ...Object.keys(HOLDER_FILES));
  return root;
}

test("CLI: 違反が無ければ exit 0 にする", () => {
  const root = makeCliRepo({ "skills/demo/scripts/a.mjs": "export {};\n" });
  try {
    const res = spawnSync(process.execPath, [script], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: root,
      encoding: "utf8",
    });
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: 未追跡のファイルの指示を検出して exit 1 にする", () => {
  const root = makeCliRepo({ "skills/demo/scripts/a.mjs": "// eslint-disable-next-line\n" });
  try {
    const res = spawnSync(process.execPath, [script], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: root,
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("skills/demo/scripts/a.mjs:1: eslint-disable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: skills/ の JavaScript・TypeScript が 0 件なら exit 2 にする", () => {
  // 型ガードのファイルも skills/ の下にあるので置かず、一覧のファイルだけを index に置く。
  const root = makeRepo({ [HOLDERS_REGISTRY]: "export {};\n", "skills/demo/SKILL.md": "# demo\n" });
  git(root, "add", HOLDERS_REGISTRY);
  try {
    const res = spawnSync(process.execPath, [script], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: root,
      encoding: "utf8",
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("0 件");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("実リポジトリ: 違反が無い", () => {
  const res = spawnSync(process.execPath, [script], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  expect(res.stderr).toBe("");
  expect(res.status).toBe(0);
});
