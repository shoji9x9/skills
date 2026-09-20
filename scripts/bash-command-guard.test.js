// Bash 呼び出しの PreToolUse ゲートの回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸           | 値                                                                                  |
// | ------------ | ------------------------------------------------------------------------------------ |
// | 入力         | 正常な Hook JSON / command フィールド欠落 / 壊れた JSON / 空 stdin                     |
// | gh の口      | gh api（--body-file は無い） / gh pr create / gh issue create（--body-file は正当）     |
// | プロセス終了 | pkill -f（素） / pkill -f '[d]...'（自分に一致しない） / pkill（-f 無し） / killall -f / kill PID / pgrep -af |
// | 区切り       | && / \|\| / ; / \| / 改行（セグメントごとに判定する）                                  |
// | 危険語なし   | 通常のコマンド（hot path で即 exit 0）                                                 |
//
// 陰性コントロール（通さねばならない入力）がゲートと同数以上あることが要点——
// 陽性だけのゲートは「全部落とす実装」と区別が付かない。
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/bash-command-guard.sh");

const run = (payload) =>
  spawnSync("bash", [script], { input: payload, encoding: "utf8", cwd: repoRoot });

const hook = (command) => JSON.stringify({ tool_name: "Bash", tool_input: { command } });

const guard = (command) => run(hook(command));

// --- 陰性コントロール（通す） ---

const PASSING = [
  ["gh pr の --body-file は正当", "gh pr create --body-file /tmp/body.md"],
  ["gh issue の --body-file は正当", "gh issue create --title t --body-file /tmp/body.md"],
  [
    "gh api でも --body-file を使っていなければ通す",
    "gh api repos/o/r/pulls/1/comments -F body=@/tmp/b.md",
  ],
  ["PID 指定の kill は通す", 'kill "$PID"'],
  ["pgrep での確認は通す", "pgrep -af dump-dom"],
  ["文字クラスで自分を避けた pkill は通す", "pkill -f '[d]ump-dom'"],
  ["-f を使わない pkill は通す", "pkill chrome"],
  [
    "危険語を含まない通常のコマンドは通す",
    "git status --short && node scripts/check-rule-symlinks.js",
  ],
];

for (const [name, command] of PASSING) {
  test(`陰性コントロール: ${name}`, () => {
    const r = guard(command);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/実行前に止めた/);
  });
}

// --- 陽性コントロール（止める） ---

test("gh api の --body-file を止める", () => {
  const r = guard("gh api repos/o/r/pulls/1/comments/2/replies --body-file /tmp/b.md");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/gh api に --body-file は無い/);
});

test("素のパターンで撃つ pkill -f を止める", () => {
  const r = guard("pkill -f dump-dom");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

test("killall -f も同じ扱いで止める", () => {
  const r = guard("killall -f node");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

test("同じ呼び出しの正当な --body-file は巻き込まず、gh api のセグメントだけを指摘する", () => {
  const r = guard("gh pr create --body-file a.md && gh api x --body-file b.md");
  expect(r.status).toBe(2);
  const lines = r.stderr.split("\n").filter((l) => l.trim().startsWith("-"));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("gh api x --body-file b.md");
  expect(lines[0]).not.toContain("gh pr create");
});

test.each([
  ["セミコロン", "echo start; gh api x --body-file b.md"],
  ["パイプ", "cat b.md | gh api x --body-file b.md"],
  ["OR", "false || gh api x --body-file b.md"],
  ["改行", "echo start\ngh api x --body-file b.md"],
])("区切り %s のセグメントでも判定する", (_name, command) => {
  expect(guard(command).status).toBe(2);
});

test("2 クラスが同時にあれば両方報告する", () => {
  const r = guard("gh api x --body-file b.md && pkill -f dump-dom");
  expect(r.status).toBe(2);
  const lines = r.stderr.split("\n").filter((l) => l.trim().startsWith("-"));
  expect(lines).toHaveLength(2);
});

// --- 入力の退化形 ---

test("command フィールドが無い Hook JSON は通す", () => {
  const r = run(JSON.stringify({ tool_name: "Bash", tool_input: {} }));
  expect(r.status).toBe(0);
});

test("空 stdin は通す", () => {
  const r = run("");
  expect(r.status).toBe(0);
});

test("壊れた JSON は通すが、検査していないことを stderr に残す（黙って合格にしない）", () => {
  const r = run('{ "tool_input": { "command": "pkill -f x" ');
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(/検査していない/);
});
