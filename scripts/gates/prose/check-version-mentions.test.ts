// 文書とコメントに書いたバージョンと、宣言したバージョンの突き合わせの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸           | 値                                                                                     |
// | ------------ | -------------------------------------------------------------------------------------- |
// | 宣言の出所   | devDependencies（lockfile で解決）/ packageManager / mise.toml の [tools] / [tools] の外 |
// | 宣言の不備   | lockfile に無い依存 / X.Y.Z でない宣言 / importers の . が依存を持たない文書だけ         |
// |              | [tools] の読めない行（表の値・[tools.<名前>]）/ package.json と mise.toml の食い違い     |
// | 宣言の書き方 | [tools] の後のコメント / 二重引用符と一重引用符で囲んだ名前と値 / 依存が null          |
// | 名前の書き方 | 空白 / v / @ / バッククォート / 大文字 / 呼び名（Playwright・Node.js）                   |
// | 名前の境界   | 長い名前（@types/node）/ 名前を含む別の語（mynode）/ 宣言の無い名前（gh）               |
// | バージョン   | X.Y.Z 一致 / X.Y.Z 不一致 / X.Y / X.Y.Z.W                                               |
// | 直後の語     | 以上 / 以下 / より古い / + / 空白を挟んだ + / +sha512 / 〜・- で続く上限 / 句読点 / 文末の . |
// | 場所         | Markdown の本文 / コードフェンス / 例の行 / コメント / 文字列 / コメントを持たない拡張子 |
// | 許可         | 使われる許可 / 使われない許可                                                            |
// | CLI          | 違反なし / 違反あり / 宣言を読めない                                                     |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkVersionMentions,
  declaredVersions,
  findMismatches,
  RULE,
} from "./check-version-mentions.ts";
import { ALLOWED_PATH, KNOWN_RULES } from "../../lib/doc-scan.ts";
import { TIERS_PATH } from "../docs/doc-tiers.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { gitInit, REPO_ROOT, write } from "../../lib/testing/repo-file.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const script = join(REPO_ROOT, "scripts/gates/prose/check-version-mentions.ts");

const PACKAGE = JSON.stringify({
  devDependencies: { "@playwright/test": "^1.64.0", "@types/node": "^25.0.0" },
  packageManager: "pnpm@12.13.0",
});
// pnpm 自身の依存を書いた文書と、プロジェクトの依存を書いた文書の 2 つ（pnpm の lockfile と同じ形）。
const LOCK = `---
lockfileVersion: '9.0'
importers:
  .:
    configDependencies: {}
    packageManagerDependencies:
      pnpm:
        specifier: 12.13.0
        version: 12.13.0
---
lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      '@playwright/test':
        specifier: ^1.64.0
        version: 1.64.1
      '@types/node':
        specifier: ^25.0.0
        version: 25.9.1(peer@1.0.0)
`;
const MISE = `[settings]\nlockfile = true\n[tools]\nnode = "26.12.1"\npython = "3.15.0"\n`;

function makeRepo(files: Record<string, string>, { allowed }: { allowed?: object } = {}) {
  const root = makeTempDir("version-mentions-");
  const all: Record<string, string> = {
    [TIERS_PATH]: readFileSync(join(REPO_ROOT, TIERS_PATH), "utf8"),
    "package.json": PACKAGE,
    "pnpm-lock.yaml": LOCK,
    "mise.toml": MISE,
    ...files,
  };
  for (const [p, t] of Object.entries(all)) write(root, p, t);
  if (allowed) writeFileSync(join(root, ALLOWED_PATH), JSON.stringify(allowed));
  gitInit(root);
  return root;
}

const DECLARED = new Map([
  ["@playwright/test", "1.64.1"],
  ["@types/node", "25.9.1"],
  ["pnpm", "12.13.0"],
  ["node", "26.12.1"],
  ["python", "3.15.0"],
]);
const mismatches = (file: string, text: string) =>
  findMismatches({ file, markdown: file.endsWith(".md") }, text, DECLARED).map((m) => m.text);

test("宣言は lockfile で解決したバージョン・packageManager・mise の [tools] から読む", () => {
  const root = makeRepo({ "mise.toml": `${MISE}[env]\nshfmt = "1.0.0"\n` });
  expect(Object.fromEntries(declaredVersions(root))).toEqual(Object.fromEntries(DECLARED));
});

test.each([
  [
    "lockfile に無い依存",
    { "package.json": JSON.stringify({ devDependencies: { vitest: "^5" } }) },
  ],
  ["X.Y.Z でない宣言", { "mise.toml": `[tools]\nnode = "26"\n` }],
  ["依存を持つ importers の . が無い", { "pnpm-lock.yaml": LOCK.split("---\n")[1] }],
  ["[tools] の表の値", { "mise.toml": `[tools]\nnode = { version = "26.12.1" }\n` }],
  ["[tools.<名前>] の表", { "mise.toml": `[tools.node]\nversion = "26.12.1"\n` }],
  ["package.json と mise.toml の食い違い", { "mise.toml": `[tools]\npnpm = "12.12.0"\n` }],
  ["package.json の依存が null", { "package.json": JSON.stringify({ dependencies: null }) }],
])("宣言を読めないときは例外にする: %s", (_name, files) => {
  expect(() => declaredVersions(makeRepo(files))).toThrow();
});

test("[tools] の後のコメントと、引用符で囲んだ名前も読む", () => {
  const mise = `[tools] # 版を固定する\n"node" = "26.12.1"\npython = "3.15.0" # 注記\n'shfmt' = '3.14.1'\n`;
  const declared = declaredVersions(makeRepo({ "mise.toml": mise }));
  expect([declared.get("node"), declared.get("python"), declared.get("shfmt")]).toEqual([
    "26.12.1",
    "3.15.0",
    "3.14.1",
  ]);
});

test.each([
  ["空白", "Playwright 1.63.0 で確かめた。", ["Playwright 1.63.0"]],
  ["v", "Node v24.17.0 で確かめた。", ["Node v24.17.0"]],
  ["@", "pnpm@12.10.1 で確かめた。", ["pnpm@12.10.1"]],
  ["バッククォートの名前", "`@playwright/test` 1.63.0 の実測。", ["@playwright/test 1.63.0"]],
  ["大文字", "PYTHON 3.14.0 で確かめた。", ["PYTHON 3.14.0"]],
  ["呼び名 Node.js", "Node.js 24.0.0 で確かめた。", ["Node.js 24.0.0"]],
  ["長い名前は長い方で読む", "@types/node 25.0.0 の型。", ["@types/node 25.0.0"]],
  ["句読点の前", "（Playwright 1.63.0）", ["Playwright 1.63.0"]],
  ["文末の .", "Tested with Playwright 1.63.0.", ["Playwright 1.63.0"]],
  ["空白を挟んだ +", "Node 24.0.0 + pnpm 11.0.0 で確かめた。", ["Node 24.0.0", "pnpm 11.0.0"]],
  ["packageManager のハッシュ", "`pnpm@11.0.0+sha512.abc` を書く。", ["pnpm@11.0.0"]],
])("宣言と食い違う X.Y.Z を検出する: %s", (_name, text, want) => {
  expect(mismatches("docs/a.md", text)).toEqual(want);
});

test.each([
  ["宣言と一致", "Playwright 1.64.1 と @types/node 25.9.1 で確かめた。"],
  ["X.Y だけ", "Node 24.2 より古い版。vitest 5 の出力。"],
  ["X.Y.Z.W", "Chrome 149.0.7827.155 と node 1.2.3.4。"],
  ["以上", "Python 3.8.0 以上が要る。"],
  ["より古い", "Node 24.2.0 より古い版。"],
  ["〜で続く上限", "Python 3.12.0〜3.13.0 が要る。"],
  ["- で続く上限", "Python 3.12.0-3.13.0 が要る。"],
  ["以下", "Node 24.0.0 以下で起きる。"],
  ["+", "Playwright 1.60.0+ が要る。"],
  ["名前を含む別の語", "mynode 1.2.3 と node_modules 1.2.3。"],
  ["宣言の無い名前", "gh 2.93.0 で確かめた。"],
  ["例の行", "例: `pnpm@11.0.0` を入れる。"],
])("食い違いとして扱わない: %s", (_name, text) => {
  expect(mismatches("docs/a.md", text)).toEqual([]);
});

test("Markdown はコードフェンスの外だけを読む", () => {
  const text = "Playwright 1.63.0 の本文。\n\n```text\nPlaywright 1.60.0\n```\n";
  expect(mismatches("docs/a.md", text)).toEqual(["Playwright 1.63.0"]);
});

test("コードはコメントの文章だけを読み、文字列とコメントを持たない拡張子は読まない", () => {
  const code = '// Playwright 1.63.0 で実測した。\nconst v = "Playwright 1.62.0 の文字列";\n';
  expect(mismatches("scripts/a.ts", code)).toEqual(["Playwright 1.63.0"]);
  expect(mismatches("data/a.json", '{"note": "Playwright 1.63.0 で実測した"}')).toEqual([]);
});

test("違反の行番号は元のファイルの行を指す", () => {
  const code = "const a = 1;\n\n// Playwright 1.63.0 で実測した。\n";
  expect(
    findMismatches({ file: "scripts/a.ts", markdown: false }, code, DECLARED).map((m) => m.line),
  ).toEqual([3]);
});

test("許可した記述は通し、使われていない許可は失敗にする", () => {
  const allowed = (text: string) => ({
    allowed: [{ file: "docs/a.md", rule: RULE, text, reason: "古いバージョンの記録" }],
  });
  const files = { "docs/a.md": "pnpm 11.23.0 で確かめた。\n" };
  expect(
    checkVersionMentions(makeRepo(files, { allowed: allowed("pnpm 11.23.0") })).failures,
  ).toEqual([]);
  expect(
    checkVersionMentions(makeRepo(files, { allowed: allowed("pnpm 11.0.0") })).failures,
  ).toHaveLength(2);
});

test("規則は許可の一覧に書ける", () => {
  expect(KNOWN_RULES).toContain(RULE);
});

const run = (root: string) =>
  spawnSync(process.execPath, [script, root], { encoding: "utf8", timeout: CHILD_TIMEOUT_MS });

test("CLI: 違反なしは 0、違反ありは 1、宣言を読めないときは 2", () => {
  const ok = run(makeRepo({ "docs/a.md": "Playwright 1.64.1 で確かめた。\n" }));
  expect([ok.status, ok.stdout]).toEqual([0, expect.stringContaining("OK")]);
  const ng = run(makeRepo({ "docs/a.md": "Playwright 1.63.0 で確かめた。\n" }));
  expect([ng.status, ng.stderr]).toEqual([
    1,
    expect.stringContaining("docs/a.md:1: [version-mention] Playwright 1.63.0（宣言は 1.64.1）"),
  ]);
  const broken = run(makeRepo({ "mise.toml": `[tools]\nnode = "lts"\n` }));
  expect([broken.status, broken.stderr]).toEqual([2, expect.stringContaining("チェックできない")]);
});

test("実リポジトリの文書とコメントに、宣言と食い違う記述が無い", () => {
  expect(checkVersionMentions(REPO_ROOT).failures).toEqual([]);
});
