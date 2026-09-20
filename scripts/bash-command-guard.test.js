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
import { readFileSync } from "node:fs";
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
  // 文字クラスによる回避は語頭とは限らない。位置で免除を決めると、ブロック時の指示に
  // 従った形（`[d]ump-dom` を含むパターン）が落ちる。
  ["正規表現の途中に置いた文字クラスは通す", "pkill -f 'node .*[d]ump-dom'"],
  ["語中に置いた文字クラスは通す", "pkill -f 'my-[s]erver'"],
  ["行頭アンカーの後の文字クラスは通す", "pkill -f '^[c]hrome'"],
  ["任意文字の後の文字クラスは通す", "pkill -f 'chrome.[d]ump'"],
  // `gh api` を部分一致で拾うと、引数の中にこのゲート自身の話題が入っただけで
  // 正当な呼び出しが止まる（このゲートを説明する Issue / PR を書く作業で必ず踏む）。
  [
    "引数の文章に gh api が現れる gh issue create は通す",
    "gh issue create --title 'gh api の --body-file について' --body-file /tmp/b.md",
  ],
  [
    "gh pr create も同じく引数の文章では止めない",
    "gh pr create --title 'gh api メモ' --body-file /tmp/b.md",
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

// `gh api` は先頭に限らない。制御構文の後・env 代入の後・コマンド置換の中でも実行される。
// 「セグメントの先頭」に限定すると、これらが素通りする（実測した退行）。
test.each([
  ["do の後", "for r in 1 2; do gh api repos/o/r/pulls/1 --body-file /tmp/b.md; done"],
  ["then の後", "then gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
  ["env 代入の後", "GH_TOKEN=x gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
  ["コマンド置換の中", "out=$(gh api repos/o/r/pulls/1 --body-file /tmp/b.md)"],
  ["サブシェルの中", "( gh api repos/o/r/pulls/1 --body-file /tmp/b.md )"],
  ["time の後", "time gh api repos/o/r/pulls/1 --body-file /tmp/b.md"],
])("コマンド位置の gh api を %s でも止める", (_name, command) => {
  const r = guard(command);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/unknown flag/);
});

test("行コメントの中の [] は文字クラスの免除に数えない", () => {
  const r = guard("pkill -f chrome # see [notes]");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

// 免除は「${...} 展開と行コメントを除いた部分に文字クラスがあるか」で決める。
// 取り除かずに見ると、配列添字を含むだけの素の -f 実行が素通りする（実測した偽陰性）。
test("配列添字の [] は文字クラスの免除に数えない", () => {
  const r = guard('pkill -f "${procs[0]}"');
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

test("変数展開と併用した文字クラスは免除する", () => {
  const r = guard('pkill -f "$dir/[d]ump-dom"');
  expect(r.status).toBe(0);
  expect(r.stderr).not.toMatch(/実行前に止めた/);
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

// --- payload の形（エージェントごとに違う） ---
//
// このゲートは 3 エージェント（Claude Code / Codex / Copilot）へ配線してある。
// `.tool_input.command` だけを読むと残り 2 つでは command が空になり、JSON 自体は読めるので
// 警告も出ないまま全件素通りする（配線済みに見えて 1 つしか効かない）。
// 陽性コントロールは各形に同じ違反コマンドを載せて取る。
const OFFENDING = "pkill -f dump-dom";

test.each([
  ["Claude Code: tool_input.command", { tool_name: "Bash", tool_input: { command: OFFENDING } }],
  ["Codex: toolArgs.command", { tool_name: "Bash", toolArgs: { command: OFFENDING } }],
  [
    "Codex: toolArgs が JSON 文字列",
    { tool_name: "Bash", toolArgs: JSON.stringify({ command: OFFENDING }) },
  ],
  ["Copilot: input.command", { tool_name: "Bash", input: { command: OFFENDING } }],
  ["素の command", { tool_name: "Bash", command: OFFENDING }],
])("payload の形 %s でも判定する", (_name, payload) => {
  const r = run(JSON.stringify(payload));
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

test("危険語はあるが command を取り出せない payload は、検査していないことを stderr に残す", () => {
  // 未知の形（command がどのフィールドにも無い）。通すが、黙って合格にはしない。
  const r = run(JSON.stringify({ tool_name: "Bash", args: { script: OFFENDING } }));
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(/検査していない/);
});

// --- jq 単独経路（node が無い環境） ---
//
// 上の「payload の形」テストは node フォールバックが拾うため、jq の filter が落ちていても緑になる。
// 実際 `.toolArgs.command` は toolArgs が文字列のとき jq がエラー終了し（実測: jq 1.8.2 で rc=5）、
// node の無い環境では Codex の JSON 文字列形が検査されないまま通っていた。
// そこでスクリプトから filter を取り出し、jq に直接当てて経路ごとに検証する。
const guardSource = readFileSync(script, "utf8");
const jqFilter = guardSource.match(/jq -r '([\s\S]*?)'\s*2>\/dev\/null/)?.[1];

test("スクリプトから jq filter を取り出せる（取り出せなければ以降の検証は無意味）", () => {
  expect(jqFilter).toBeTruthy();
});

test.each([
  ["tool_input.command", { tool_name: "Bash", tool_input: { command: OFFENDING } }],
  ["toolArgs.command", { tool_name: "Bash", toolArgs: { command: OFFENDING } }],
  [
    "toolArgs が JSON 文字列",
    { tool_name: "Bash", toolArgs: JSON.stringify({ command: OFFENDING }) },
  ],
  ["input.command", { tool_name: "Bash", input: { command: OFFENDING } }],
  ["素の command", { tool_name: "Bash", command: OFFENDING }],
])("jq 単独でも %s から command を取り出す", (_name, payload) => {
  const r = spawnSync("jq", ["-r", jqFilter], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  // jq が無い環境ではこの検証は成立しない。黙って緑にせず落とす。
  expect(r.error, "jq が必要（この検証は jq 経路の回帰テスト）").toBeUndefined();
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toBe(OFFENDING);
});
