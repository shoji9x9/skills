// 配布スキルの抑止コメントの検査（check-skill-lint-directives.ts）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸                       | 値                                                                          |
// | ------------------------ | --------------------------------------------------------------------------- |
// | 指示の種類               | oxlint-disable（-next-line・-line）/ eslint-disable / biome-ignore / @ts-expect-error / deno-lint-ignore / 対象外（textlint・shellcheck） |
// | コメントの形             | `//` / `/*` / `/**` / JSDoc の 2 行目以降の `*` / コードの後ろの `//`（空白あり・なし） |
// | コメント以外の出現       | 文章の途中の名前 / 文字列 / テンプレート / 正規表現（どれも `//` を含む形も）  |
// | 拡張子                   | .mjs / .ts / .md（対象外）                                                   |
// | 中身の出所               | 未追跡（作業ツリー）/ staged（作業ツリーから消した・作業ツリーで直した）/ どちらにも無い |
// | 指示の後ろ               | 行末 / 空白 / `:` / 受け付ける接尾辞 / 指示を前に含むだけの語（数えない） |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findDirectives, findViolations } from "./check-skill-lint-directives.ts";
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
    expect(findViolations(root, files)).toEqual([]);
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
    expect(findViolations(root, files)).toEqual([
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
    expect(findViolations(root, files)).toEqual([
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
    expect(() => findViolations(root, ["skills/demo/missing.mjs"])).toThrow(
      "index にも作業ツリーにも無い",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI: 違反が無ければ exit 0 にする", () => {
  const root = makeRepo({ "skills/demo/scripts/a.mjs": "export {};\n" });
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
  const root = makeRepo({ "skills/demo/scripts/a.mjs": "// eslint-disable-next-line\n" });
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
  const root = makeRepo({ "skills/demo/SKILL.md": "# demo\n" });
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
