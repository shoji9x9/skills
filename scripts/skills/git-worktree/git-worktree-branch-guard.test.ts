import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

// git-worktree-branch-guard.sh は「worktree の作成手段が branch を作る呼び出し方」だけを通知する。
// 通知のみでブロックしないため、取りこぼしは警告なしに起き、誤検知は通知の信頼を
// 落とす。どちらも出力を見ただけでは分からないので、検出側（通知が出る）と非検出側
// （出ない）の両方を検体で固定する。
//
// 「該当なし」を根拠にする側は、同じ検体が形を 1 つ変えるだけで検出側へ移ることを
// 併せて示す（例: `--detach` の有無、`add` と `list` の違い）。これで、検出できることを確かめる。
// 検査対象は配布する原本だけである。.agents/ 配下のコピーは skill-reinstall ルールで同期される。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "skills/git-worktree/scripts/git-worktree-branch-guard.sh");

function runGuard(payload: unknown) {
  const result = spawnSync("bash", [script], {
    timeout: CHILD_TIMEOUT_MS,
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return { status: result.status, stdout: (result.stdout ?? "").trim() };
}

function bash(command: string) {
  return { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } };
}

function enterWorktree(toolInput: Record<string, unknown>) {
  return { hook_event_name: "PreToolUse", tool_name: "EnterWorktree", tool_input: toolInput };
}

// 通知が出なければならない検体（branch を作る呼び出し方）。
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
  {
    name: "ラッパー越しの add（time）",
    payload: bash("time git worktree add -b feature/x /tmp/wt"),
  },
  {
    name: "ラッパーのオプション越しの add（time -p）",
    payload: bash("time -p git worktree add -b feature/x /tmp/wt"),
  },
  {
    name: "値を別トークンに取るラッパーオプション越しの add（nice -n 10）",
    payload: bash("nice -n 10 git worktree add -b feature/x /tmp/wt"),
  },
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
  // 次の 2 件は、commit-ish か --detach を外すと NOTIFIED の「commit-ish 省略の DWIM」と同じ入力になる。
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
  {
    name: "markdown 箇条書きとして現れる add（ラッパー無し）",
    payload: bash("cat > /tmp/m.txt <<EOF\n- git worktree add -b feature/x wt は使わない\nEOF"),
  },
  // `-d` と `-f` の束ね。detach なので branch は作られない（実測）。
  { name: "短オプションの束ねの -d", payload: bash("git worktree add -df /tmp/wt") },
  // `--[no-]track` は真偽値で値を取らない。値を取ると誤読すると path を読み飛ばして
  // operand を数え違え、既存 branch を渡す add まで誤って検出側と判定される。
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
  const parsed = parseJsonAs<{
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  }>(stdout);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(parsed.hookSpecificOutput.additionalContext).toContain("gh issue develop");
});

test.each(SILENT)("通知しない: $name", ({ payload }) => {
  const { status, stdout } = runGuard(payload);
  expect(status).toBe(0);
  expect(stdout).toBe("");
});

// 検出できることの確認: 「通知しない」側の検体は、branch を作る形へ 1 か所変えるだけで
// 検出側へ移る。移らなければ、その検体が通らないのは検出の処理が動いていないからだと分かる。
test("束ねから d を外すと同じ add が検出側へ移る", () => {
  expect(runGuard(bash("git worktree add -df /tmp/wt")).stdout).toBe("");
  expect(runGuard(bash("git worktree add -f /tmp/wt")).stdout).not.toBe("");
});

test("--track 付きでも commit-ish を外すと検出側へ移る", () => {
  expect(runGuard(bash("git worktree add --track /tmp/wt feature/x")).stdout).toBe("");
  expect(runGuard(bash("git worktree add --track /tmp/wt")).stdout).not.toBe("");
});

// 検出できることの確認: コマンド位置から外れているから通知しないのであって、検出の処理が
// 動いていないからではない。同じ語列を区切りの直後（＝コマンド位置）へ戻すと検出側へ移る。
test("コマンド位置へ戻すと同じ語列が検出側へ移る", () => {
  expect(runGuard(bash("printf %s まず git worktree add -b feature/x wt を避ける")).stdout).toBe(
    "",
  );
  expect(runGuard(bash("printf %s まず; git worktree add -b feature/x wt")).stdout).not.toBe("");
});

// 以下 2 本は**後退検知**であって Delta を測るものではない（PR #236 のレビュー指摘への対応）。
// どちらも修正前のバージョンでも同じ結果になることを実測した。引用が閉じないトークンは残り全部を
// 1 トークンとして飲むため、`unquote` の重複（`'abc` を `abcabc` と読む）が判定へ現れる
// 入力を作れなかった。判定に現れないだけで誤った読みではあるので修正は入れてある。
// この 2 本は、その読みが将来 verdict に反映されるようになったときに気付くための固定である。
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

// 検出できることの確認: ラッパーのオプションを外すと元から検出できていた形に戻る。つまり
// 検出できるようになったのはオプション読み飛ばしを足したからで、検出の処理全体が
// 緩くなったからではない。同時に、ラッパーの無い `- ` 始まりの行が
// 誤ってコマンド位置と判定されていないことも押さえる（PR #236 レビュー）。
test("ラッパーのオプションを読み飛ばしても箇条書きをコマンドとして扱わない", () => {
  expect(runGuard(bash("time -p git worktree add -b feature/x /tmp/wt")).stdout).not.toBe("");
  expect(runGuard(bash("time git worktree add -b feature/x /tmp/wt")).stdout).not.toBe("");
  expect(runGuard(bash("- git worktree add -b feature/x /tmp/wt")).stdout).toBe("");
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
  const parsed = parseJsonAs<{
    permissionDecision: string;
    permissionDecisionReason: string;
    hookSpecificOutput?: unknown;
  }>(stdout);
  expect(parsed.permissionDecision).toBe("ask");
  expect(parsed.permissionDecisionReason).toContain("gh issue develop");
  expect(parsed.hookSpecificOutput).toBeUndefined();
});

// 事前の絞り込みは、Hook の入力のうちツールの名前と入力（`tool_name`・`tool_input`・Copilot の `toolArgs`）だけを見る（Issue #678）。
// 入力の全体を見ると、`.claude/worktrees/<name>` の中のセッションでは、`cwd` の語ですべての呼び出しが jq / python3 まで進む。
// 出力はどちらも空なので、jq と python3 を、起動を記録してから実体を実行するスクリプトに差し替えて、起動したかで確かめる。
function runGuardWithTrace(input: string) {
  const dir = makeTempDir("worktree-guard-trace-");
  const trace = join(dir, "trace");
  for (const tool of ["jq", "python3"]) {
    const real = spawnSync("bash", ["-c", `command -v ${tool}`], {
      timeout: CHILD_TIMEOUT_MS,
      encoding: "utf8",
    }).stdout.trim();
    expect(real, `${tool} が PATH に無い`).not.toBe("");
    writeFileSync(join(dir, tool), `#!/bin/sh\necho "${tool}" >>"${trace}"\nexec "${real}" "$@"\n`);
    chmodSync(join(dir, tool), 0o755);
  }
  const result = spawnSync("bash", [script], {
    timeout: CHILD_TIMEOUT_MS,
    input,
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
  });
  const lines = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n") : [];
  return { status: result.status, stdout: (result.stdout ?? "").trim(), lines };
}

const wordyCwd = JSON.stringify("/home/u/repo/.claude/worktrees/678-x");
const wordyTranscript = JSON.stringify("/home/u/.claude/projects/repo--claude-worktrees-x/s.jsonl");

// jq / python3 まで進まないもの。語は cwd か transcript_path の値にだけある。
test.each([
  {
    name: "cwd だけに語がある",
    input: `{"session_id":"s","cwd":${wordyCwd},"tool_name":"Bash","tool_input":{"command":"ls -la"}}`,
  },
  {
    name: "transcript_path だけに語がある",
    input: `{"session_id":"s","transcript_path":${wordyTranscript},"tool_name":"Bash","tool_input":{"command":"ls -la"}}`,
  },
  {
    name: "cwd と transcript_path の両方に語がある",
    input: `{"transcript_path":${wordyTranscript},"cwd":${wordyCwd},"tool_name":"Bash","tool_input":{"command":"git status","description":"worktree の状態を見る"}}`,
  },
  {
    name: "Copilot の toolArgs（JSON の文字列）",
    input: `{"cwd":${wordyCwd},"toolName":"bash","toolArgs":${JSON.stringify(JSON.stringify({ command: "ls -la" }))}}`,
  },
])("事前の絞り込みで終える: $name", ({ input }) => {
  const { status, stdout, lines } = runGuardWithTrace(input);
  expect(status).toBe(0);
  expect(stdout).toBe("");
  expect(lines).toEqual([]);
});

// 次の段に進むもの（上と同じ cwd を持つ）。
test("コマンドに語があれば次の段に進み、branch を作らない形なら通知しない", () => {
  const { stdout, lines } = runGuardWithTrace(
    `{"cwd":${wordyCwd},"tool_name":"Bash","tool_input":{"command":"git worktree list"}}`,
  );
  expect(stdout).toBe("");
  expect(lines).toContain("jq");
});

test("EnterWorktree はツールの名前で次の段に進み、cwd に語があっても通知する", () => {
  const { stdout, lines } = runGuardWithTrace(
    `{"cwd":${wordyCwd},"tool_name":"EnterWorktree","tool_input":{"name":"feature/x"}}`,
  );
  expect(stdout).toContain("gh issue develop");
  expect(lines).toContain("jq");
});

// JSON はキーも `\u` で書ける。絞り込みはそのキーを見つけられないが、jq はコマンドとして読む。
test("\\u を含む入力は、入力の全体で判定する", () => {
  const { stdout } = runGuardWithTrace(
    `{"cwd":${wordyCwd},"tool_name":"Bash","tool_input":{"comm\\u0061nd":"git worktree add -b x /tmp/wt"}}`,
  );
  expect(stdout).toContain("gh issue develop");
});

test("対象のキーが無い入力は、入力の全体で判定する", () => {
  const { status, lines } = runGuardWithTrace(`{"cwd":${wordyCwd},"other":"x"}`);
  expect(status).toBe(0);
  expect(lines).toContain("jq");
});

// Copilot の preToolUse は、非 0 終了を拒否（deny）として扱う。通知目的のフックが
// tool 呼び出しを落とすことがあってはならないので、解析できない入力でも exit 0 で抜ける。
test.each([
  { name: "空入力", input: "" },
  { name: "JSON でない入力", input: "worktree add -b x" },
  { name: "オブジェクトでない JSON", input: '["worktree"]' },
  {
    name: "tool_input が文字列",
    input: '{"tool_name":"Bash","tool_input":"git worktree add -b x /tmp/wt"}',
  },
])("形式の不正な入力でもブロックしない: $name", ({ input }) => {
  const result = spawnSync("bash", [script], {
    timeout: CHILD_TIMEOUT_MS,
    input,
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
});
