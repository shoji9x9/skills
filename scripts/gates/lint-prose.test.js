// 文章チェック（lint-prose）の回帰テスト。
//
// textlint の設定と単語帳は実リポジトリのものを使い（configRoot の既定値）、対象のファイルと保留の一覧は
// 一時ディレクトリの git リポジトリに置く。実リポジトリの文章の中身には前提を置かない（書き換えの途中で変わる）。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                 | 値                                                                          |
// | ------------------ | --------------------------------------------------------------------------- |
// | 単語帳のエントリ   | 全エントリの example（検出される）/ 残すと決めた語・技術用語（検出されない）    |
// | 文章の位置         | 本文 / インラインコード / コードブロック / frontmatter                         |
// | ファイルの場所     | 対象 / .agents/rules / private skill / スキルのコピー / .claude/ / .kaizen/ と archive / tests/ / シンボリックリンク / .md 以外 |
// | 保留の一覧         | 在る / 無い / JSON でない / reason が空 / files が配列でない / 重複            |
// | 保留したファイル   | 指摘あり / 指摘 0 件 / ファイルが無い                                         |
// | 実行のしかた       | 全体（引数なし）/ ファイル指定（lefthook）/ 対象 0 件                          |
import { beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PENDING_PATH, lintProse, loadPending, main } from "./lint-prose.js";
import { makeSharedTempDir, makeTempDir } from "../lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/gates/lint-prose.js");
const words = JSON.parse(readFileSync(join(repoRoot, ".textlint/words.json"), "utf8"));

const CLEAN = "# 手順\n\nこの手順でファイルを確認する。\n";
const DIRTY = "# 手順\n\n一覧はこのファイルが正本である。\n";

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** `files` を置いて git に登録し、`pending` を保留の一覧として書いた一時リポジトリ。 */
function makeRepo(files, pending = []) {
  const root = makeTempDir("lint-prose-");
  spawnSync("git", ["init", "-q"], { cwd: root });
  for (const [p, t] of Object.entries(files)) write(root, p, t);
  if (pending !== null) {
    write(root, PENDING_PATH, JSON.stringify({ reason: "書き換え前", files: pending }));
  }
  spawnSync("git", ["add", "-A"], { cwd: root });
  return root;
}

// ---- 単語帳（陽性コントロール）----

describe("単語帳: 各エントリの example が、そのエントリの message で検出される", () => {
  // textlint の起動は重いので、全エントリの example を 1 つのリポジトリに別ファイルで置き、1 回だけ走らせる。
  const root = makeSharedTempDir("lint-prose-words-");
  const fileOf = (i) => `entry-${String(i).padStart(3, "0")}.md`;
  let violations;
  beforeAll(async () => {
    spawnSync("git", ["init", "-q"], { cwd: root });
    words.entries.forEach((e, i) => write(root, fileOf(i), `# 例\n\n${e.example}\n`));
    write(root, PENDING_PATH, JSON.stringify({ reason: "書き換え前", files: [] }));
    spawnSync("git", ["add", "-A"], { cwd: root });
    ({ violations } = await lintProse({ root }));
  }, 120_000);
  test.each(words.entries.map((e, i) => [e.example, e.message, i]))("%s", (_, message, i) => {
    const own = violations.filter((v) => v.startsWith(`${fileOf(i)}:`));
    expect(own.some((v) => v.includes(message))).toBe(true);
  });
});

// ---- 単語帳（陰性コントロール）----

test.each([
  ["残すと決めた語", "部品を照合し、検査の結果を突き合わせて実測する。"],
  ["DB の照合順序", "文字コードと照合順序を確かめる。"],
  ["文字化け", "どの文字が文字化けしたかを残す。"],
  ["テストが落ちる", "この入力ではテストが落ちる。"],
  ["引数", "軸から引数を設計する。"],
])("陰性: %s は検出しない", async (_, sentence) => {
  const root = makeRepo({ "doc.md": `# 例\n\n${sentence}\n` });
  expect((await lintProse({ root })).violations).toEqual([]);
});

test("陰性: インラインコード・コードブロック・frontmatter の中の語は検出しない", async () => {
  const text =
    "---\ndescription: 一覧は正本である\n---\n\n# 例\n\n`正本` という語を使う。\n\n```text\n正本\n```\n";
  const root = makeRepo({ "doc.md": text });
  expect((await lintProse({ root })).violations).toEqual([]);
});

test("textlint-disable で囲んだ箇所だけを除外し、囲みの外は検出する", async () => {
  const text =
    "# 例\n\n<!-- textlint-disable -->\n\n一覧は正本である。\n\n<!-- textlint-enable -->\n\n仕様は正本にある。\n";
  const root = makeRepo({ "doc.md": text });
  const { violations } = await lintProse({ root });
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^doc\.md:9:/);
});

// ---- 対象の範囲 ----

test("陽性: 対象の Markdown の指摘をファイル・行・列付きで報告する", async () => {
  const root = makeRepo({ "docs/a.md": DIRTY });
  const { checked, violations } = await lintProse({ root });
  expect(checked).toBe(1);
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatch(/^docs\/a\.md:3:\d+ 「正本」は使わない/);
});

test("陰性: スキルのコピー・エージェント用のリンク・過去の記録・テスト結果・シンボリックリンク・.md 以外は見ない", async () => {
  const root = makeRepo({
    "a.md": CLEAN,
    ".agents/skills/pub/SKILL.md": DIRTY,
    ".claude/x.md": DIRTY,
    ".kaizen/archive/x.md": DIRTY,
    "tests/x/result.md": DIRTY,
    "notes.txt": DIRTY,
  });
  symlinkSync(join(root, "tests/x/result.md"), join(root, "link.md"));
  spawnSync("git", ["add", "-A"], { cwd: root });
  const result = await lintProse({ root });
  expect(result).toEqual({ checked: 1, pending: 0, violations: [], stale: [] });
});

test("陽性: rule の実体・private skill の実体・有効な学びは見る", async () => {
  const root = makeRepo({
    ".agents/rules/x.md": DIRTY,
    ".agents/skills/priv/.private-skill": "",
    ".agents/skills/priv/SKILL.md": DIRTY,
    ".agents/skills/priv/references/r.md": DIRTY,
    ".kaizen/learning.md": DIRTY,
  });
  const files = (await lintProse({ root })).violations.map((v) => v.split(":")[0]).sort();
  expect(files).toEqual([
    ".agents/rules/x.md",
    ".agents/skills/priv/SKILL.md",
    ".agents/skills/priv/references/r.md",
    ".kaizen/learning.md",
  ]);
});

test("陽性: ignore されていない未追跡のファイルも見る", async () => {
  const root = makeRepo({ "a.md": CLEAN });
  write(root, "new.md", DIRTY);
  expect((await lintProse({ root })).violations).toHaveLength(1);
});

test("ファイル指定: 渡したもののうち対象だけを見る（保留していないファイルの指摘は報告する）", async () => {
  const root = makeRepo({ "a.md": DIRTY, "b.md": DIRTY, "tests/x/c.md": DIRTY });
  const result = await lintProse({ root, files: ["a.md", "tests/x/c.md"] });
  expect(result.checked).toBe(1);
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]).toMatch(/^a\.md:/);
});

test("ファイル指定: 対象が 0 件でも失敗にしない（lefthook は .md 以外の staged も渡しうる）", async () => {
  const root = makeRepo({ "a.md": DIRTY });
  expect(await lintProse({ root, files: ["notes.txt"] })).toEqual({
    checked: 0,
    pending: 0,
    violations: [],
    stale: [],
  });
});

test("全体: 対象が 0 件なら例外にする（何も見ていない実行を合格として扱わない）", async () => {
  const root = makeRepo({ "notes.txt": "x" });
  await expect(lintProse({ root })).rejects.toThrow("0 件");
});

// ---- 保留の一覧 ----

test("陰性: 保留したファイルの指摘は数えない", async () => {
  const root = makeRepo({ "a.md": DIRTY, "b.md": CLEAN }, ["a.md"]);
  expect(await lintProse({ root })).toEqual({ checked: 2, pending: 1, violations: [], stale: [] });
});

test("陽性: 保留したファイルの指摘が 0 件になったら、一覧から外すよう求める", async () => {
  const root = makeRepo({ "a.md": CLEAN }, ["a.md"]);
  const { stale } = await lintProse({ root });
  expect(stale).toEqual([`a.md: 指摘が 0 件になった。${PENDING_PATH} から外す`]);
});

test("陽性: 保留したファイルが無ければ、一覧から外すよう求める（全体を見るときだけ）", async () => {
  const root = makeRepo({ "a.md": CLEAN }, ["gone.md"]);
  expect((await lintProse({ root })).stale).toEqual([
    `gone.md: ファイルが無い。${PENDING_PATH} から外す`,
  ]);
  expect((await lintProse({ root, files: ["a.md"] })).stale).toEqual([]);
});

test.each([
  ["無い", null, "が無い"],
  ["JSON でない", "{", "JSON"],
  ["reason が空", JSON.stringify({ reason: " ", files: [] }), "reason"],
  ["files が配列でない", JSON.stringify({ reason: "r", files: "a.md" }), "files"],
  ["files に空文字", JSON.stringify({ reason: "r", files: [""] }), "files"],
  ["files が重複", JSON.stringify({ reason: "r", files: ["a.md", "a.md"] }), "重複"],
])("保留の一覧が%sなら例外にする", (_, text, message) => {
  const root = makeRepo({ "a.md": CLEAN }, null);
  if (text !== null) write(root, PENDING_PATH, text);
  expect(() => loadPending(root)).toThrow(message);
});

// ---- CLI ----

test("main: 指摘があれば 1、無ければ 0、一覧が読めなければ 2 を返す", async () => {
  const cwd = process.cwd();
  try {
    process.chdir(makeRepo({ "a.md": DIRTY }));
    expect(await main([])).toBe(1);
    process.chdir(makeRepo({ "a.md": CLEAN }));
    expect(await main([])).toBe(0);
    process.chdir(makeRepo({ "a.md": CLEAN }, null));
    expect(await main([])).toBe(2);
  } finally {
    process.chdir(cwd);
  }
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、指摘は exit 1、無ければ exit 0", () => {
  const run = (root) => spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  const dirty = run(makeRepo({ "a.md": DIRTY }));
  expect(dirty.status).toBe(1);
  expect(dirty.stderr).toContain("「正本」は使わない");
  expect(run(makeRepo({ "a.md": CLEAN })).status).toBe(0);
}, 60_000);
