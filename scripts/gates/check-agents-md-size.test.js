// AGENTS.md のサイズのチェックの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                       | 値                                                                    |
// | ------------------------ | --------------------------------------------------------------------- |
// | 測る版のサイズ           | target 以下 / target ちょうど / target と limit の間 / limit ちょうど / limit 超 |
// | 範囲の履歴               | limit 超の commit なし / あり / AGENTS.md が無い commit を含む / 範囲が空  |
// | モード                   | pre-commit（index を測る）/ CI（HEAD を測る）                            |
// | base                     | 解決できる / 解決できない                                               |
// | 設定のファイル           | 在る / 無い / JSON でない / limit・target が不正                          |
// | AGENTS.md                | 在る / 測る版に無い                                                    |
import { expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_PATH, checkAgentsMdSize, main } from "./check-agents-md-size.js";
import { makeTempDir } from "../lib/test-tmpdir.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/gates/check-agents-md-size.js");
const LIMIT = 100;
const TARGET = 80;

function write(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

/** AGENTS.md を size バイトにして stage する。commit なら commit もする。 */
function put(root, size, { commit = true } = {}) {
  write(root, "AGENTS.md", "x".repeat(size));
  git(root, "add", "AGENTS.md");
  if (commit) git(root, "commit", "-q", "-m", `size ${size}`);
}

/** main ブランチ（AGENTS.md は baseSize）から feature ブランチを切った一時リポジトリ。 */
function makeRepo(baseSize = 10, config = { limit_bytes: LIMIT, target_bytes: TARGET }) {
  const root = makeTempDir("agents-md-size-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  if (config !== null) write(root, CONFIG_PATH, JSON.stringify(config));
  put(root, baseSize);
  git(root, "switch", "-q", "-c", "feature");
  return root;
}

const pre = (root) => checkAgentsMdSize(root, { base: "main", preCommit: true });
const ci = (root) => checkAgentsMdSize(root, { base: "main" });

test.each([
  ["target 以下", TARGET - 1],
  ["target と limit の間", TARGET + 1],
  ["limit ちょうど", LIMIT],
])("陰性: ブランチで limit を超えていなければ、%s は通す（pre-commit・CI とも）", (_, size) => {
  const root = makeRepo();
  put(root, size, { commit: false });
  expect(pre(root).ok).toBe(true);
  git(root, "commit", "-q", "-m", "c");
  expect(ci(root).ok).toBe(true);
});

test("pre-commit: 初めて limit を超えた commit は、警告して通す（履歴に残すため）", () => {
  const root = makeRepo();
  put(root, LIMIT + 1, { commit: false });
  const result = pre(root);
  expect(result).toMatchObject({ ok: true, exceeded: true });
  expect(result.warning).toContain(`${TARGET} バイト以下`);
});

test("陽性: ブランチで limit を超えた後は、limit 以下でも target を超えていれば失敗する（pre-commit・CI とも）", () => {
  const root = makeRepo();
  put(root, LIMIT + 1);
  put(root, LIMIT - 1, { commit: false });
  expect(pre(root)).toMatchObject({ ok: false, exceeded: true });
  git(root, "commit", "-q", "-m", "c");
  expect(ci(root)).toMatchObject({ ok: false, exceeded: true });
});

test("陰性: ブランチで limit を超えた後でも、target 以下まで縮めれば通す（pre-commit・CI とも）", () => {
  for (const size of [TARGET, TARGET - 1]) {
    const root = makeRepo();
    put(root, LIMIT + 1);
    put(root, size, { commit: false });
    expect(pre(root).ok).toBe(true);
    git(root, "commit", "-q", "-m", "c");
    expect(ci(root).ok).toBe(true);
  }
});

test("陽性: CI は、初めて limit を超えた commit が HEAD でも失敗する", () => {
  const root = makeRepo();
  put(root, LIMIT + 1);
  expect(ci(root)).toMatchObject({ ok: false });
});

test("陽性: 作業ツリーの状態を消しても、超えた事実は履歴に残る（restore・別の clone でも効く）", () => {
  const root = makeRepo();
  put(root, LIMIT + 1);
  put(root, LIMIT - 1, { commit: false });
  git(root, "restore", "--staged", "AGENTS.md");
  git(root, "restore", "AGENTS.md");
  put(root, LIMIT - 1, { commit: false });
  expect(pre(root).ok).toBe(false);
});

test("陰性: base 側（分岐点より前）の limit 超は数えない", () => {
  const root = makeRepo(LIMIT + 1);
  put(root, TARGET + 1, { commit: false });
  expect(pre(root).ok).toBe(true);
});

test("陰性: 範囲に AGENTS.md が無い commit があっても、そこは超えていない扱いにする", () => {
  const root = makeRepo();
  git(root, "rm", "-q", "AGENTS.md");
  git(root, "commit", "-q", "-m", "rm");
  put(root, TARGET + 1, { commit: false });
  expect(pre(root).ok).toBe(true);
});

test("陰性: 範囲が空（base と HEAD が同じ）なら limit だけで判定する", () => {
  const root = makeRepo(TARGET + 1);
  expect(checkAgentsMdSize(root, { base: "HEAD" }).ok).toBe(true);
});

test("サイズは作業ツリーではなく、pre-commit は index、CI は HEAD の AGENTS.md で測る", () => {
  const root = makeRepo();
  put(root, TARGET - 1, { commit: false });
  write(root, "AGENTS.md", "x".repeat(LIMIT + 1));
  expect(pre(root)).toMatchObject({ ok: true, size: TARGET - 1 });
  expect(ci(root)).toMatchObject({ ok: true, size: 10 });
});

test("base を解決できなければ例外にする", () => {
  const root = makeRepo();
  expect(() => checkAgentsMdSize(root, { base: "no-such-ref" })).toThrow("分岐点");
});

test("測る版に AGENTS.md が無ければ例外にする", () => {
  const root = makeRepo();
  git(root, "rm", "-q", "--cached", "AGENTS.md");
  expect(() => pre(root)).toThrow("index に AGENTS.md が無い");
});

test.each([
  ["無い", null, "が無い"],
  ["JSON でない", "{", "JSON"],
  ["target が limit 以上", JSON.stringify({ limit_bytes: 80, target_bytes: 80 }), "target_bytes"],
  ["limit が整数でない", JSON.stringify({ limit_bytes: "30", target_bytes: 24 }), "limit_bytes"],
  ["target が 0", JSON.stringify({ limit_bytes: 30, target_bytes: 0 }), "target_bytes"],
])("設定のファイルが%sなら例外にする", (_, text, message) => {
  const root = makeRepo(10, null);
  if (text !== null) write(root, CONFIG_PATH, text);
  expect(() => ci(root)).toThrow(message);
});

test("main: 通れば 0、違反は 1、判定できなければ 2 を返す", () => {
  const ok = makeRepo();
  expect(main([ok, "--base", "main"])).toBe(0);
  const ng = makeRepo();
  put(ng, LIMIT + 1);
  expect(main([ng, "--base", "main"])).toBe(1);
  expect(main([makeRepo(), "--base", "no-such-ref"])).toBe(2);
  expect(main([makeRepo()])).toBe(2);
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、超えた後に縮めきらなければ exit 1、縮めれば exit 0", () => {
  const root = makeRepo();
  put(root, LIMIT + 1);
  const run = () =>
    spawnSync(process.execPath, [script, "--pre-commit", "--base", "main"], {
      cwd: root,
      encoding: "utf8",
    });
  put(root, LIMIT - 1, { commit: false });
  expect(run().status).toBe(1);
  put(root, TARGET, { commit: false });
  expect(run().status).toBe(0);
});

test("実リポジトリ: limit は Codex のデフォルトの上限（32 KiB）より小さく、target は limit より小さい", () => {
  const config = JSON.parse(readFileSync(join(repoRoot, CONFIG_PATH), "utf8"));
  expect(config.limit_bytes).toBeLessThan(32 * 1024);
  expect(config.target_bytes).toBeLessThan(config.limit_bytes);
});
