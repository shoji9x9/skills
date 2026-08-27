import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// git-worktree-branch-guard.sh は「worktree の作成手段が branch を作る経路」だけを通知する。
// 通知のみでブロックしないため、取りこぼし（fail open）は静かに起き、誤検知は通知の信頼を
// 落とす。どちらも出力を見ただけでは分からないので、検出側（通知が出る）と非検出側
// （出ない）の両方を検体で固定する。
//
// 「該当なし」を根拠にする側は、同じ検体が形を 1 つ変えるだけで検出側に化けることを
// 併せて示す（例: `--detach` の有無、`add` と `list` の違い）。これが陽性コントロール。
// 検査対象は配布正本のみ。.agents/ 配下のコピーは skill-reinstall ルールで同期される。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "skills/git-worktree/scripts/git-worktree-branch-guard.sh");

function runGuard(payload) {
  const result = spawnSync("bash", [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return { status: result.status, stdout: (result.stdout ?? "").trim() };
}

function bash(command) {
  return { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } };
}

function enterWorktree(toolInput) {
  return { hook_event_name: "PreToolUse", tool_name: "EnterWorktree", tool_input: toolInput };
}

// 通知が出なければならない検体（branch を作る経路）。
const NOTIFIED = [
  { name: "EnterWorktree の name 指定", payload: enterWorktree({ name: "feature/91-x" }) },
  { name: "EnterWorktree の引数なし（名前が自動生成される）", payload: enterWorktree({}) },
  { name: "git worktree add -b", payload: bash("git worktree add -b feature/x /tmp/wt") },
  { name: "git worktree add -B", payload: bash("git worktree add -B feature/x /tmp/wt") },
  { name: "-b と名前の連結形", payload: bash("git worktree add -bfeature/x /tmp/wt") },
  { name: "git worktree add --orphan", payload: bash("git worktree add --orphan /tmp/wt") },
  // commit-ish も --detach も無い形は git が path の basename から branch を作る（実測）。
  { name: "commit-ish 省略の DWIM", payload: bash("git worktree add /tmp/wt") },
  { name: "区切りの後ろの add", payload: bash("cd /tmp && git worktree add -b feature/x wt") },
  {
    name: "git のグローバルオプション越し",
    payload: bash("git -C /tmp/repo worktree add /tmp/wt"),
  },
  { name: "パス指定の git", payload: bash("/usr/bin/git worktree add -b feature/x /tmp/wt") },
  // 1 コマンド行に add が複数あるとき、先頭が branch を作らない形でも打ち切らない。
  {
    name: "branch を作らない add の後ろに続く add",
    payload: bash("git worktree add /tmp/wt HEAD; git worktree add -b feature/x /tmp/wt2"),
  },
  // 短オプションの束ね。`-b` は値を取るため束ねの末尾に来る（実測: git は -fb <名前> を受ける）。
  {
    name: "短オプションの束ねに -b を含む",
    payload: bash("git worktree add -fb feature/x /tmp/wt"),
  },
  // --lock の --reason だけが値を別引数に取る。値を読み飛ばしても operand は path 1 個。
  {
    name: "--lock --reason 付きの DWIM",
    payload: bash('git worktree add --lock --reason "why" /tmp/wt'),
  },
];

// 通知を出してはならない検体（branch を作らない・そもそも対象外）。
const SILENT = [
  {
    name: "EnterWorktree の path 指定（既存 worktree に入るだけ）",
    payload: enterWorktree({ path: ".claude/worktrees/x" }),
  },
  { name: "既存 branch を渡す add", payload: bash("git worktree add /tmp/wt feature/x") },
  { name: "--detach 付きの add", payload: bash("git worktree add --detach /tmp/wt") },
  { name: "worktree list", payload: bash("git worktree list --porcelain") },
  { name: "worktree remove", payload: bash("git worktree remove /tmp/wt") },
  { name: "文字列として現れるだけの add", payload: bash('echo "git worktree add -b x /tmp/wt"') },
  { name: "worktree と無関係な commit", payload: bash("git commit -m 'worktree の話'") },
  {
    name: "コミットメッセージ本文に文字列として現れる add（heredoc）",
    payload: bash(
      "cat > /tmp/msg.txt <<'EOF'\nfeat: hook を足す\n\n- worktree の作成手段（git worktree add -b）に branch を作らせない\nEOF",
    ),
  },
  {
    name: "コマンド位置にない git（説明文の途中）",
    payload: bash("printf %s まず git worktree add -b feature/x wt を避ける"),
  },
  // `-d` と `-f` の束ね。detach なので branch は作られない（実測）。
  { name: "短オプションの束ねの -d", payload: bash("git worktree add -df /tmp/wt") },
  // `--[no-]track` は真偽値で値を取らない。値を取ると誤読すると path を読み飛ばして
  // operand を数え違え、既存 branch を渡す add まで検出側へ化ける。
  {
    name: "--track 付きの既存 branch add",
    payload: bash("git worktree add --track /tmp/wt feature/x"),
  },
  {
    name: "先頭の add が commit-ish 付き",
    payload: bash("git worktree list; git worktree add /tmp/wt HEAD"),
  },
];

test.each(NOTIFIED)("通知する: $name", ({ payload }) => {
  const { status, stdout } = runGuard(payload);
  expect(status).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(parsed.hookSpecificOutput.additionalContext).toContain("gh issue develop");
});

test.each(SILENT)("通知しない: $name", ({ payload }) => {
  const { status, stdout } = runGuard(payload);
  expect(status).toBe(0);
  expect(stdout).toBe("");
});

// 陽性コントロール: 「通知しない」側の検体は、branch を作る形へ 1 か所変えるだけで
// 検出側へ移る。移らなければ、その検体が通らないのは検出器が動いていないからだと分かる。
test("--detach を外すと同じ add が検出側へ移る", () => {
  expect(runGuard(bash("git worktree add --detach /tmp/wt")).stdout).toBe("");
  expect(runGuard(bash("git worktree add /tmp/wt")).stdout).not.toBe("");
});

test("commit-ish を外すと同じ add が検出側へ移る", () => {
  expect(runGuard(bash("git worktree add /tmp/wt feature/x")).stdout).toBe("");
  expect(runGuard(bash("git worktree add /tmp/wt")).stdout).not.toBe("");
});

test("束ねから d を外すと同じ add が検出側へ移る", () => {
  expect(runGuard(bash("git worktree add -df /tmp/wt")).stdout).toBe("");
  expect(runGuard(bash("git worktree add -f /tmp/wt")).stdout).not.toBe("");
});

test("--track 付きでも commit-ish を外すと検出側へ移る", () => {
  expect(runGuard(bash("git worktree add --track /tmp/wt feature/x")).stdout).toBe("");
  expect(runGuard(bash("git worktree add --track /tmp/wt")).stdout).not.toBe("");
});

// 陽性コントロール: コマンド位置から外れているから通知しないのであって、検出器が
// 死んでいるからではない。同じ語列を区切りの直後（＝コマンド位置）へ戻すと検出側へ移る。
test("コマンド位置へ戻すと同じ語列が検出側へ移る", () => {
  expect(runGuard(bash("printf %s まず git worktree add -b feature/x wt を避ける")).stdout).toBe(
    "",
  );
  expect(runGuard(bash("printf %s まず; git worktree add -b feature/x wt")).stdout).not.toBe("");
});

// 以下 2 本は**後退検知**であって Delta を測るものではない（PR #236 のレビュー指摘への対応）。
// どちらも修正前の版でも同じ結果になることを実測した——引用が閉じないトークンは残り全部を
// 1 トークンとして飲むため、`unquote` の重複（`'abc` を `abcabc` と読む）が判定へ現れる
// 経路を構成できなかった。判定に現れないだけで誤った読みではあるので修正は入れてあり、
// この 2 本はその読みが将来 verdict に効くようになったときに気付くための固定。
test("閉じないシングルクォートを含んでも判定が入力と対応する", () => {
  // 引用が閉じていない `-b` 付きの add。branch を作る形として検出されること。
  expect(runGuard(bash("git worktree add -b 'feature/x /tmp/wt")).stdout).not.toBe("");
  // 引用が閉じていない既存 branch 指定。branch を作らない形のままであること。
  expect(runGuard(bash("git worktree add /tmp/wt 'feature/x")).stdout).toBe("");
});

// パス名展開が判定を書き換えないこと。glob メタ文字を含むパスでも cwd の中身に依存しない。
// （代入 RHS はパス名展開の対象外で、配列要素の非引用展開だけが対象になることを実測した）
test("glob メタ文字を含むパスでも判定が cwd に依存しない", () => {
  expect(runGuard(bash("git worktree add -b feature/x '/tmp/wt[1]'")).stdout).not.toBe("");
  expect(runGuard(bash("git worktree add '/tmp/wt*' feature/x")).stdout).toBe("");
});

// Copilot の preToolUse 出力は permission 決定専用で additionalContext を持たないため、
// 通知は permissionDecision: "ask" + reason で出す。
// <https://docs.github.com/en/copilot/reference/hooks-reference>
test("Copilot の camelCase payload には ask で通知する", () => {
  const { status, stdout } = runGuard({
    sessionId: "s1",
    cwd: "/repo",
    toolName: "bash",
    toolArgs: { command: "git worktree add -b feature/x /tmp/wt" },
  });
  expect(status).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.permissionDecision).toBe("ask");
  expect(parsed.permissionDecisionReason).toContain("gh issue develop");
  expect(parsed.hookSpecificOutput).toBeUndefined();
});

// Copilot の preToolUse は非 0 終了を fail-closed（deny）として扱う。通知目的のフックが
// tool 呼び出しを落とすことがあってはならないので、解析できない入力でも exit 0 で抜ける。
test.each([
  { name: "空入力", input: "" },
  { name: "JSON でない入力", input: "worktree add -b x" },
  { name: "オブジェクトでない JSON", input: '["worktree"]' },
  {
    name: "tool_input が文字列",
    input: '{"tool_name":"Bash","tool_input":"git worktree add -b x /tmp/wt"}',
  },
])("壊れた入力でもブロックしない: $name", ({ input }) => {
  const result = spawnSync("bash", [script], { input, encoding: "utf8" });
  expect(result.status).toBe(0);
});
