// AGENTS.md のサイズのチェックの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸                | 値                                                                          |
// | ----------------- | --------------------------------------------------------------------------- |
// | サイズ            | target 以下 / target ちょうど / target と limit の間 / limit ちょうど / limit 超 |
// | shrinking         | false / true                                                                 |
// | --record          | なし（CI）/ あり（pre-commit）                                                |
// | 状態のファイル    | 在る / 無い / JSON でない / limit・target が不正 / shrinking が真偽値でない      |
// | AGENTS.md         | index に在る / 作業ツリーにだけ在る（index に無い）/ index と作業ツリーで違う    |
import { expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_PATH, checkAgentsMdSize, main } from "./check-agents-md-size.js";
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

/** `size` バイトの AGENTS.md を index に置き、状態を書いた一時リポジトリ。state が null なら状態を置かない。 */
function makeRepo(size, state = { shrinking: false }) {
  const root = makeTempDir("agents-md-size-");
  git(root, "init", "-q");
  write(root, "AGENTS.md", "x".repeat(size));
  git(root, "add", "AGENTS.md");
  if (state !== null) {
    write(root, STATE_PATH, JSON.stringify({ limit_bytes: LIMIT, target_bytes: TARGET, ...state }));
  }
  return root;
}

const shrinkingOf = (root) => JSON.parse(readFileSync(join(root, STATE_PATH), "utf8")).shrinking;
const stagedState = (root) => JSON.parse(git(root, "show", `:${STATE_PATH}`)).shrinking;

test.each([
  ["target 以下", TARGET - 1],
  ["target と limit の間", TARGET + 1],
  ["limit ちょうど", LIMIT],
])("陰性: 縮小中でなければ、%s は通す", (_, size) => {
  expect(checkAgentsMdSize(makeRepo(size)).ok).toBe(true);
});

test("陽性: 縮小中でなく limit を超えたら失敗し、--record がなければ状態を書き換えない", () => {
  const root = makeRepo(LIMIT + 1);
  const result = checkAgentsMdSize(root);
  expect(result).toMatchObject({ ok: false, size: LIMIT + 1, shrinking: true });
  expect(shrinkingOf(root)).toBe(false);
});

test("--record: limit を超えたら shrinking を true にして stage する", () => {
  const root = makeRepo(LIMIT + 1);
  expect(checkAgentsMdSize(root, { record: true }).ok).toBe(false);
  expect(shrinkingOf(root)).toBe(true);
  expect(stagedState(root)).toBe(true);
});

test("陽性: 縮小中は、limit 以下でも target を超えていれば失敗する", () => {
  const root = makeRepo(TARGET + 1, { shrinking: true });
  expect(checkAgentsMdSize(root, { record: true })).toMatchObject({ ok: false, shrinking: true });
  expect(shrinkingOf(root)).toBe(true);
});

test("--record: 縮小中に target 以下になったら通し、shrinking を false に戻して stage する", () => {
  for (const size of [TARGET, TARGET - 1]) {
    const root = makeRepo(size, { shrinking: true });
    expect(checkAgentsMdSize(root, { record: true })).toMatchObject({ ok: true, shrinking: false });
    expect(shrinkingOf(root)).toBe(false);
    expect(stagedState(root)).toBe(false);
  }
});

test("陽性: --record なし（CI）で縮小中のまま target 以下なら、記録を戻すよう求めて失敗する", () => {
  const root = makeRepo(TARGET - 1, { shrinking: true });
  const result = checkAgentsMdSize(root);
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("--record");
  expect(shrinkingOf(root)).toBe(true);
});

test("超えてから縮めるまでの流れ: 29 KiB 相当まで縮めただけでは通らず、24 KiB 相当で通る", () => {
  const root = makeRepo(LIMIT + 1);
  expect(checkAgentsMdSize(root, { record: true }).ok).toBe(false);
  write(root, "AGENTS.md", "x".repeat(LIMIT - 1));
  git(root, "add", "AGENTS.md");
  expect(checkAgentsMdSize(root, { record: true }).ok).toBe(false);
  write(root, "AGENTS.md", "x".repeat(TARGET));
  git(root, "add", "AGENTS.md");
  expect(checkAgentsMdSize(root, { record: true }).ok).toBe(true);
  expect(stagedState(root)).toBe(false);
});

test("サイズは作業ツリーではなく index の AGENTS.md で測る", () => {
  const root = makeRepo(TARGET);
  write(root, "AGENTS.md", "x".repeat(LIMIT + 1));
  expect(checkAgentsMdSize(root)).toMatchObject({ ok: true, size: TARGET });
});

test.each([
  ["無い", null, "が無い"],
  ["JSON でない", "{", "JSON"],
  [
    "target が limit 以上",
    JSON.stringify({ limit_bytes: 80, target_bytes: 80, shrinking: false }),
    "target_bytes",
  ],
  [
    "limit が整数でない",
    JSON.stringify({ limit_bytes: "30", target_bytes: 24, shrinking: false }),
    "limit_bytes",
  ],
  [
    "target が 0",
    JSON.stringify({ limit_bytes: 30, target_bytes: 0, shrinking: false }),
    "target_bytes",
  ],
  [
    "shrinking が真偽値でない",
    JSON.stringify({ limit_bytes: 30, target_bytes: 24, shrinking: "no" }),
    "shrinking",
  ],
])("状態のファイルが%sなら例外にする", (_, text, message) => {
  const root = makeRepo(1, null);
  if (text !== null) write(root, STATE_PATH, text);
  expect(() => checkAgentsMdSize(root)).toThrow(message);
});

test("AGENTS.md が index に無ければ例外にする（作業ツリーにだけあっても）", () => {
  const root = makeTempDir("agents-md-size-");
  git(root, "init", "-q");
  write(root, "AGENTS.md", "x");
  write(
    root,
    STATE_PATH,
    JSON.stringify({ limit_bytes: LIMIT, target_bytes: TARGET, shrinking: false }),
  );
  expect(() => checkAgentsMdSize(root)).toThrow("index に AGENTS.md が無い");
});

test("main: 通れば 0、違反は 1、判定できなければ 2 を返す", () => {
  expect(main([makeRepo(1)])).toBe(0);
  expect(main([makeRepo(LIMIT + 1)])).toBe(1);
  expect(main([makeRepo(1, null)])).toBe(2);
});

test("陽性コントロール（CLI）: 子プロセスとして起動しても、limit 超は exit 1、--record で状態が残る", () => {
  const root = makeRepo(LIMIT + 1);
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  expect(run(root).status).toBe(1);
  expect(shrinkingOf(root)).toBe(false);
  expect(run("--record", root).status).toBe(1);
  expect(shrinkingOf(root)).toBe(true);
});

test("実リポジトリ: 状態のファイルは読め、limit は Codex のデフォルトの上限（32 KiB）より小さい", () => {
  const state = JSON.parse(readFileSync(join(repoRoot, STATE_PATH), "utf8"));
  expect(state.limit_bytes).toBeLessThan(32 * 1024);
  expect(state.target_bytes).toBeLessThan(state.limit_bytes);
});
