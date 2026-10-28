// 文書とコメントに書いたバージョンと、宣言したバージョンの突き合わせの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸           | 値                                                                                     |
// | ------------ | -------------------------------------------------------------------------------------- |
// | 宣言の出所   | devDependencies（lockfile で解決）/ packageManager / mise ls の mise.toml の宣言         |
// |              | mise ls のほかの設定ファイルの宣言（グローバルの設定）/ mise.toml が無い                 |
// | 宣言の不備   | lockfile に無い依存 / X.Y.Z でない宣言 / importers の . が依存を持たない文書だけ         |
// |              | package.json と mise.toml の食い違い / 依存が null / packageManager が文字列でない       |
// |              | 依存と packageManager の食い違い                                                         |
// | mise ls      | object でない / 値が配列でない / source.path が無い（環境変数など）/ requested_version が無い |
// |              | リポジトリの中の別の設定（mise.<env>.toml など）の宣言 / 宣言したと解決したの違い        |
// |              | mise.toml の宣言が 1 件も無い / 起動できない・0 以外で終わる（例外をそのまま返す）       |
// |              | 1 つのツールに複数のバージョン                                                           |
// | 名前の書き方 | 空白 / v / @ / バッククォート / 大文字 / 呼び名（Playwright・Node.js）                   |
// |              | 呼び名と同じ名前の宣言（宣言を優先する）                                                 |
// | 名前の境界   | 長い名前（@types/node）/ 名前を含む別の語（mynode）/ 宣言の無い名前（gh）               |
// | バージョン   | X.Y.Z 一致 / X.Y.Z 不一致 / X.Y / X.Y.Z.W / - の後のプレリリースの語と、ほかの語        |
// | 直後の語     | 以上 / 〜で続く上限 / + / 空白を挟んだ + / +sha512 / 句読点 / 文末の .（どれも除かない）  |
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
  miseEnv,
  type MiseList,
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
// mise.toml の中身は読まない（宣言は mise ls の出力から読む）。在ることだけが mise を起動する条件になる。
const MISE = `[tools]\nnode = "26.12.1"\npython = "3.15.0"\n`;

function makeRepo(files: Record<string, string | null>, { allowed }: { allowed?: object } = {}) {
  const root = makeTempDir("version-mentions-");
  const all: Record<string, string | null> = {
    [TIERS_PATH]: readFileSync(join(REPO_ROOT, TIERS_PATH), "utf8"),
    "package.json": PACKAGE,
    "pnpm-lock.yaml": LOCK,
    "mise.toml": MISE,
    ...files,
  };
  for (const [p, t] of Object.entries(all)) if (t !== null) write(root, p, t);
  if (allowed) writeFileSync(join(root, ALLOWED_PATH), JSON.stringify(allowed));
  gitInit(root);
  return root;
}

/** mise ls --current --json の偽物。tools はリポジトリの mise.toml の宣言、global はグローバルの設定の宣言。 */
function fakeMise(
  tools: Record<string, string> = { node: "26.12.1", python: "3.15.0" },
  global: Record<string, string> = { "aws-cli": "2.38.4", node: "24.0.0" },
): MiseList {
  return (root) => {
    const out: Record<string, unknown[]> = {};
    const add = (name: string, version: string, path: string) =>
      (out[name] ??= []).push({
        version,
        requested_version: version,
        source: { type: "mise.toml", path },
      });
    const globalPath = join(makeTempDir("version-mentions-global-"), "config.toml");
    writeFileSync(globalPath, "");
    for (const [n, v] of Object.entries(global)) add(n, v, globalPath);
    for (const [n, v] of Object.entries(tools)) add(n, v, join(root, "mise.toml"));
    return JSON.stringify(out);
  };
}
const raw =
  (json: unknown): MiseList =>
  () =>
    JSON.stringify(json);

const DECLARED = new Map([
  ["@playwright/test", "1.64.1"],
  ["@types/node", "25.9.1"],
  ["pnpm", "12.13.0"],
  ["node", "26.12.1"],
  ["python", "3.15.0"],
]);
const mismatches = (file: string, text: string) =>
  findMismatches({ file, markdown: file.endsWith(".md") }, text, DECLARED).map((m) => m.text);

test("宣言は lockfile で解決したバージョン・packageManager・mise ls の mise.toml の宣言から読む", () => {
  // グローバルの設定の node 24.0.0 と aws-cli は、mise.toml の宣言ではないので読まない。
  expect(Object.fromEntries(declaredVersions(makeRepo({}), fakeMise()))).toEqual(
    Object.fromEntries(DECLARED),
  );
});

test("mise.toml が無ければ mise を起動しない", () => {
  const never: MiseList = () => {
    throw new Error("起動した");
  };
  expect(declaredVersions(makeRepo({ "mise.toml": null }), never).has("node")).toBe(false);
});

test.each([
  [
    "lockfile に無い依存",
    { "package.json": JSON.stringify({ devDependencies: { vitest: "^5" } }) },
  ],
  ["依存を持つ importers の . が無い", { "pnpm-lock.yaml": LOCK.split("---\n")[1] }],
  ["package.json の依存が null", { "package.json": JSON.stringify({ dependencies: null }) }],
  ["packageManager が文字列でない", { "package.json": JSON.stringify({ packageManager: null }) }],
  [
    "依存と packageManager の食い違い",
    {
      "package.json": JSON.stringify({
        devDependencies: { "@playwright/test": "^1.64.0" },
        packageManager: "@playwright/test@1.60.0",
      }),
    },
  ],
])("宣言を読めないときは例外にする: %s", (_name, files) => {
  expect(() => declaredVersions(makeRepo(files), fakeMise())).toThrow();
});

// 各行の 3 つ目は、その不備を判定した分岐のメッセージ。前の分岐や別の TypeError で落ちても通らないように確かめる。
test.each<[string, MiseList, string | RegExp]>([
  ["X.Y.Z でない宣言", fakeMise({ node: "26" }), "X.Y.Z でなく"],
  ["package.json と mise.toml の食い違い", fakeMise({ pnpm: "12.12.0" }), "mise.toml は"],
  ["mise.toml の宣言が 1 件も無い", fakeMise({}), "1 件も読めない"],
  ["出力が object でない", raw([]), "出力が object でない"],
  ["値が配列でない", raw({ node: {} }), "配列でない"],
  ["要素が object でない", raw({ node: [null] }), "要素が object でない"],
  [
    "source.path が無い（環境変数の出所）",
    raw({ node: [{ version: "26.12.1", source: { type: "environment" } }] }),
    "ファイルでなく",
  ],
  ["JSON でない", () => "not json", /JSON/],
  [
    "起動できない",
    () => {
      throw new Error("spawn mise ENOENT");
    },
    "ENOENT",
  ],
])("mise ls を読めないときは例外にする: %s", (_name, miseList, message) => {
  expect(() => declaredVersions(makeRepo({}), miseList)).toThrow(message);
});

test("mise.toml が 1 つのツールに複数のバージョンを宣言するときは、比べるバージョンを決められないとして例外にする", () => {
  const miseList: MiseList = (root) =>
    JSON.stringify({
      node: ["26.12.1", "24.0.0"].map((v) => ({
        requested_version: v,
        source: { path: join(root, "mise.toml") },
      })),
    });
  expect(() => declaredVersions(makeRepo({}), miseList)).toThrow("複数のバージョン");
});

test("mise.toml の宣言に requested_version が無いときは例外にする", () => {
  const miseList: MiseList = (root) =>
    JSON.stringify({
      node: [{ version: "26.12.1", source: { path: join(root, "mise.toml") } }],
    });
  expect(() => declaredVersions(makeRepo({}), miseList)).toThrow("requested_version が無い");
});

test("リポジトリの中の別の設定が mise.toml の宣言を上書きしたときは、比べられないとして例外にする", () => {
  const miseList: MiseList = (root) => {
    write(root, "mise.foo.toml", "");
    return JSON.stringify({
      node: [{ version: "24.0.0", source: { path: join(root, "mise.foo.toml") } }],
      python: [{ version: "3.15.0", source: { path: join(root, "mise.toml") } }],
    });
  };
  expect(() => declaredVersions(makeRepo({}), miseList)).toThrow("上書き");
});

test("mise.toml の宣言は宣言した値と比べ、X.Y.Z で固定しない宣言は比べられないとして例外にする", () => {
  const miseList =
    (requested: string): MiseList =>
    (root) =>
      JSON.stringify({
        node: [
          {
            version: "26.12.1",
            requested_version: requested,
            source: { path: join(root, "mise.toml") },
          },
        ],
      });
  expect(declaredVersions(makeRepo({}), miseList("26.12.1")).get("node")).toBe("26.12.1");
  expect(() => declaredVersions(makeRepo({}), miseList("26"))).toThrow("X.Y.Z でなく");
});

test("mise を起動するときは、mise.toml を上書きする環境変数を外し、上書きの設定を読ませない", () => {
  const env = miseEnv({
    PATH: "/bin",
    MISE_ENV: "foo",
    MISE_PROFILE: "bar",
    MISE_NODE_VERSION: "20.0.0",
    MISE_JOBS: "4",
  });
  expect(env).toEqual({
    PATH: "/bin",
    MISE_JOBS: "4",
    MISE_OVERRIDE_CONFIG_FILENAMES: "mise.toml",
    MISE_OVERRIDE_TOOL_VERSIONS_FILENAMES: "none",
  });
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
  ["プレリリースの語は接尾辞まで読む", "Node 24.0.0-rc.1 で確かめた。", ["Node 24.0.0-rc.1"]],
  ["宣言と同じ X.Y.Z のプレリリース", "Node 26.12.1-beta2 で確かめた。", ["Node 26.12.1-beta2"]],
  ["直後の以上", "Python 3.8.0 以上が要る。", ["Python 3.8.0"]],
  ["直後の以下", "Node 24.0.0 以下で起きる。", ["Node 24.0.0"]],
  ["直後のより古い", "Node 24.2.0 より古い版。", ["Node 24.2.0"]],
  ["〜で続く上限", "Python 3.12.0〜3.13.0 が要る。", ["Python 3.12.0"]],
  ["直後の +", "Playwright 1.60.0+ が要る。", ["Playwright 1.60.0"]],
])("宣言と食い違う X.Y.Z を検出する: %s", (_name, text, want) => {
  expect(mismatches("docs/a.md", text)).toEqual(want);
});

test.each([
  ["宣言と一致", "Playwright 1.64.1 と @types/node 25.9.1 で確かめた。"],
  ["X.Y だけ", "Node 24.2 より古い版。vitest 5 の出力。"],
  ["X.Y.Z.W", "Chrome 149.0.7827.155 と node 1.2.3.4。"],
  ["名前を含む別の語", "mynode 1.2.3 と node_modules 1.2.3。"],
  ["宣言と同じ X.Y.Z の後の - と語", "Node 26.12.1-linux-x64 のバイナリ。"],
  ["宣言の無い名前", "gh 2.93.0 で確かめた。"],
  ["例の行", "例: `pnpm@11.0.0` を入れる。"],
])("食い違いとして扱わない: %s", (_name, text) => {
  expect(mismatches("docs/a.md", text)).toEqual([]);
});

test("呼び名と同じ名前の宣言があれば、宣言のバージョンと比べる", () => {
  const declared = new Map([...DECLARED, ["playwright", "1.60.0"]]);
  const found = (text: string) =>
    findMismatches({ file: "docs/a.md", markdown: true }, text, declared).map((m) => m.text);
  expect(found("Playwright 1.60.0 で確かめた。")).toEqual([]);
  expect(found("Playwright 1.64.1 で確かめた。")).toEqual(["Playwright 1.64.1"]);
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
    checkVersionMentions(makeRepo(files, { allowed: allowed("pnpm 11.23.0") }), fakeMise())
      .failures,
  ).toEqual([]);
  expect(
    checkVersionMentions(makeRepo(files, { allowed: allowed("pnpm 11.0.0") }), fakeMise()).failures,
  ).toHaveLength(2);
});

test("規則は許可の一覧に書ける", () => {
  expect(KNOWN_RULES).toContain(RULE);
});

const run = (root: string) =>
  spawnSync(process.execPath, [script, root], { encoding: "utf8", timeout: CHILD_TIMEOUT_MS });

// CLI は本物の mise を起動するので、mise の信頼の設定が要らないよう mise.toml を置かないリポジトリで確かめる。
test("CLI: 違反なしは 0、違反ありは 1、宣言を読めないときは 2", () => {
  const ok = run(makeRepo({ "mise.toml": null, "docs/a.md": "Playwright 1.64.1 で確かめた。\n" }));
  expect([ok.status, ok.stdout]).toEqual([0, expect.stringContaining("OK")]);
  const ng = run(makeRepo({ "mise.toml": null, "docs/a.md": "Playwright 1.63.0 で確かめた。\n" }));
  expect([ng.status, ng.stderr]).toEqual([
    1,
    expect.stringContaining("docs/a.md:1: [version-mention] Playwright 1.63.0（宣言は 1.64.1）"),
  ]);
  const broken = run(
    makeRepo({ "mise.toml": null, "package.json": JSON.stringify({ packageManager: "pnpm" }) }),
  );
  expect([broken.status, broken.stderr]).toEqual([2, expect.stringContaining("チェックできない")]);
});

test("実リポジトリの文書とコメントに、宣言と食い違う記述が無い", () => {
  expect(checkVersionMentions(REPO_ROOT).failures).toEqual([]);
});
