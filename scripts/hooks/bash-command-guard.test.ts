// Bash 呼び出しを PreToolUse で止めるチェック（pkill -f / killall -f）の回帰テスト。
//
// 状態空間の軸と、各セルに置いた入力:
//
// | 軸             | 値                                                                                   |
// | -------------- | ------------------------------------------------------------------------------------ |
// | 入力           | 正常な Hook JSON / command フィールド欠落 / 不正な JSON / 空 stdin                     |
// | payload の形   | tool_input.command / toolArgs.command / toolArgs が JSON 文字列 / input.command / 素の command |
// | コマンド       | pkill / killall / /usr/bin/pkill / pkill を名前に含む別のコマンド / pgrep / kill PID   |
// | 位置           | 先頭 / ; && \| の後 / 改行の後 / $( の中 / 制御構文・否定の `!` の後 / 代入・ラッパーの後 / 引用の中 |
// | -f             | -f / 束ねた -9f / --full / -f 無し（-x）/ 他のオプションの後の -f                     |
// | 文字クラス     | 1 文字のクラス（[d]）あり / 範囲のクラス（[0-9]）だけ / 無し / 別のコマンドにだけあり  |
//
// 誤検知しないことの確認（通さねばならない入力）を、止める入力と同じ数だけ置く。
// 止める入力だけのテストでは、「全部落とす実装」と区別が付かない。
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSharedTempDir } from "../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/hooks/bash-command-guard.sh");

const run = (payload: string) =>
  spawnSync("bash", [script], {
    timeout: CHILD_TIMEOUT_MS,
    input: payload,
    encoding: "utf8",
    cwd: repoRoot,
  });

const hook = (command: string) => JSON.stringify({ tool_name: "Bash", tool_input: { command } });

const guard = (command: string) => run(hook(command));

test.each([
  ["危険語を含まない通常のコマンド", "ls -la"],
  ["PID 指定の kill", 'kill "$PID"'],
  ["pgrep での確認", "pgrep -af dump-dom"],
  ["1 文字の文字クラスで自分を避けた pkill -f", "pkill -f '[d]ump-dom'"],
  ["二重引用符の中の 1 文字の文字クラス", 'pkill -f "node [s]erver.js"'],
  ["-f を使わない pkill", "pkill chrome"],
  ["f を含まないオプションの pkill", "pkill -x firefox"],
  ["pkill を名前に含む別のコマンド", "mypkill -f x"],
  ["- でつないだ名前の別のコマンド", "my-pkill -f x"],
  ["_ でつないだ名前の別のコマンド", "foo_pkill -f x"],
  ["拡張子の付いた名前の別のコマンド", "run.pkill -f x"],
  ["\\\\ で終わる行の後の別のコマンドの -f", "pkill -x a\\\\\nrm -f x"],
  ["pkill で終わる行の次の行の --full", 'echo "pkill chrome\n--full text"'],
  ["免除した区間の後の、-f を使わない pkill", "pkill -f '[d]x'; pkill y"],
  ["--full で始まる別のオプション", "pkill --fullscreen x"],
  // 受け入れた見逃し（正規表現を広げると、照合の時間と誤検知が増える）。
  ["行継続の後の -f（字下げあり）", "pkill \\\n  -f chrome"],
  ["行継続の後の -f（字下げなし）", "pkill \\\n-f chrome"],
  ["英字の配列の添字", 'pkill -f "${pats[i]}"'],
  ["pkill より前の代入の英字 1 文字のクラス", "x=[a] pkill -f node"],
])("通す: %s", (_name, command) => {
  const r = guard(command);
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

test.each([
  ["先頭の pkill -f", "pkill -f dump-dom"],
  ["killall -f", "killall -f chrome"],
  ["; の後", "sleep 1; pkill -f chrome"],
  ["&& の後", "true && pkill -f chrome"],
  ["改行の後", "echo ok\npkill -f node"],
  ["コマンド置換の中", "x=$(pkill -f a)"],
  ["sudo の後", "sudo pkill -f node"],
  ["束ねた -9f", "pkill -9f node"],
  ["--full", "pkill --full node"],
  ["他のオプションの後の -f", "pkill -u me -f node"],
  ["1 文字の文字クラスが別のコマンドにだけある", "pkill -f node && echo [x]"],
  ["免除した区間の後の pkill -f", "pkill -f '[d]x'; pkill -f y"],
  ["範囲の文字クラスだけ", 'pkill -f "chrome.*[0-9]+"'],
  ["[ そのものの 1 文字のクラス", "pkill -f 'a[[]'"],
  ["配列の添字（数字 1 文字）", 'pkill -f "${pats[0]}"'],
  ["記号 1 文字のクラス（免除しない）", 'pkill -f "[_]foo"'],
  ["] そのものの 1 文字のクラス", 'pkill -f "[]]x"'],
  ["while の条件", "while pkill -f foo; do sleep 1; done"],
  ["if の条件", "if pkill -f foo; then echo ok; fi"],
  ["! の後", "! pkill -f foo"],
  ["環境変数の代入の後", "VAR=1 pkill -f foo"],
  ["timeout の後", "timeout 5 pkill -f foo"],
  ["xargs の後", "echo x | xargs pkill -f foo"],
  ["nohup の後", "nohup pkill -f foo"],
  ["exec の後", "exec pkill -f foo"],
  ["command の後", "command pkill -f foo"],
  ["パスで書いた pkill", "/usr/bin/pkill -f foo"],
  ["オプション付きの sudo の後", "sudo -n pkill -f foo"],
  ["シェルに委譲した引数", 'bash -c "pkill -f foo"'],
  // 引用の中の文章でも止める（正規表現 1 本で判定すると決めたので、この誤検知は受け入れる）。
  ["commit message の中の文章", 'git commit -m "stop pkill -f node"'],
  ["-f/ を含む文章", 'git commit -m "pkill に -f/--full を付けない"'],
])("止める: %s", (_name, command) => {
  const r = guard(command);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

test("pkill -f を含まない大きな入力は、文字クラスが多くても置き換えずにすぐ通す", () => {
  const body = "a[i] = b[j];\n".repeat(32000);
  const started = Date.now();
  const r = guard(`pkill -x foo\ncat > f <<'EOF'\n${body}EOF`);
  expect(r.status).toBe(0);
  expect(Date.now() - started).toBeLessThan(3000);
});

test("免除した pkill -f の後に文字クラスの多い大きな本文が続いても、置き換えは区間だけに当ててすぐ通す", () => {
  const body = "a[i] = b[j];\n".repeat(32000);
  const started = Date.now();
  const r = guard(`pkill -f '[d]ump-dom'\ncat > f <<'EOF'\n${body}EOF`);
  expect(r.status).toBe(0);
  expect(Date.now() - started).toBeLessThan(3000);
});

test.each([
  [
    "免除した pkill -f の前に大きな本文がある",
    `cat > f <<'EOF'\n${"a[i] = b[j];\n".repeat(32000)}EOF\npkill -f '[d]ump-dom'`,
  ],
  ["区切りを含まない長い 1 行", `pkill -f '[d]x' ${"a[i]+".repeat(40000)}`],
  ["免除した pkill -f が多い", "pkill -f '[d]x'\n".repeat(5000)],
])("大きな入力も、照合の時間が長さに比例してすぐ通す: %s", (_name, command) => {
  const started = Date.now();
  const r = guard(command);
  expect(r.status).toBe(0);
  expect(Date.now() - started).toBeLessThan(3000);
});

test("制御文字（\\x01）が続く pkill -f も止める", () => {
  const r = guard("pkill -f node\u0001");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

test.each([
  ["リダイレクト", "pkill -f>/dev/null node"],
  ["空の引用", 'pkill -f"" node'],
])("-f の直後に記号が続く形も止める: %s", (_name, command) => {
  const r = guard(command);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

const shownOf = (stderr: string) =>
  stderr.replace(/^.*?を \[d\]ump-dom の形にする: (.*)\n$/s, "$1");

test.each([
  ["前に長い文字列がある", `${"x".repeat(1000)} pkill -f node`],
  ["後ろに長い文字列がある", `pkill -f node ${"y".repeat(1000)}`],
  [
    "止めた pkill の前に別の pkill の語がある",
    `git commit -m 'pkill docs ${"x".repeat(250)} pkill -f node'`,
  ],
])("止めたときの表示は、止めた pkill から 200 文字までにする: %s", (_name, command) => {
  const r = guard(command);
  expect(r.status).toBe(2);
  const shown = shownOf(r.stderr);
  expect(shown.startsWith("pkill -f")).toBe(true);
  expect(shown.length).toBeLessThanOrEqual(200);
});

// 段ごとに失敗する偽物を PATH の先頭に置く。指定した引数を持つ呼び出しだけを失敗させ、ほかは本物に渡す。
const realGrep = spawnSync("bash", ["-c", "command -v grep"], {
  encoding: "utf8",
  timeout: CHILD_TIMEOUT_MS,
}).stdout.trim();
const withFailing = (name: string, body: string, command: string) => {
  const bin = makeSharedTempDir(`bash-command-guard-broken-${name}-`);
  writeFileSync(join(bin, name), body);
  chmodSync(join(bin, name), 0o755);
  return spawnSync("bash", [script], {
    timeout: CHILD_TIMEOUT_MS,
    input: hook(command),
    encoding: "utf8",
    cwd: repoRoot,
    env: { ...process.env, PATH: [bin, process.env.PATH ?? ""].join(delimiter) },
  });
};

test.each([
  {
    stage: "区切りの tr",
    tool: "tr",
    body: "#!/bin/sh\nexit 2\n",
    reason: /split_segments の終了コード 2/,
  },
  {
    stage: "1 段目の grep",
    tool: "grep",
    body: `#!/bin/sh\ncase "$1" in -aE) exit 2 ;; esac\nexec '${realGrep}' "$@"\n`,
    reason: /grep の終了コード 2/,
  },
  {
    stage: "2 段目の grep",
    tool: "grep",
    body: `#!/bin/sh\ncase "$1" in -avE) exit 2 ;; esac\nexec '${realGrep}' "$@"\n`,
    reason: /grep の終了コード 2/,
  },
])(
  "$stage が出力なしで失敗したら、検査していないと stderr に残して通す",
  ({ tool, body, reason }) => {
    const r = withFailing(tool, body, "pkill -f node");
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/照合に失敗したため検査していない/);
    expect(r.stderr).toMatch(reason);
  },
);

test("grep が一致した行を出して失敗しても、その行で止める", () => {
  const body = `#!/bin/sh\n'${realGrep}' "$@"\nexit 2\n`;
  const r = withFailing("grep", body, "pkill -f node");
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});

test("行継続を多く含む大きな入力も、すぐ通す", () => {
  const started = Date.now();
  const r = guard("pkill -x foo \\\n".repeat(10000));
  expect(r.status).toBe(0);
  expect(Date.now() - started).toBeLessThan(3000);
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

test("不正な JSON は通すが、検査していないことを stderr に残す（警告なしに合格にしない）", () => {
  const r = run('{ "tool_input": { "command": "pkill -f x" ');
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(/検査していない/);
});

// --- payload の形（エージェントごとに違う） ---
//
// このチェックは 3 エージェント（Claude Code / Codex / Copilot）へ組み込んである。
// `.tool_input.command` だけを読むと、残り 2 つでは command が空になる。JSON 自体は読めるので、
// 警告も出ないまま全件素通りする（組み込み済みに見えて、1 つしか機能しない）。
// 検出されることの確認は、各形に同じ違反コマンドを載せて行う。
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
  // 未知の形（command がどのフィールドにも無い）。通すが、警告なしに合格にはしない。
  const r = run(JSON.stringify({ tool_name: "Bash", args: { script: OFFENDING } }));
  expect(r.status).toBe(0);
  expect(r.stderr).toMatch(/検査していない/);
});

// --- jq だけで取り出す処理（node が無い環境） ---
//
// 上の「payload の形」テストは node フォールバックが拾うため、jq の filter が落ちていても緑になる。
// 実際 `.toolArgs.command` は toolArgs が文字列のとき jq がエラー終了し（実測: jq 1.8.2 で rc=5）、
// node の無い環境では Codex の JSON 文字列形が検査されないまま通っていた。
// そこで node を PATH から外し、jq だけが居る環境でスクリプト全体を起動して、payload の形ごとに確かめる。
// jq の取り出しが失敗すると、node の後段も無いので「検査していない」の警告で exit 0 になり、exit 2 と区別できる。
const jqOnlyEnv = (() => {
  const jq = spawnSync("bash", ["-c", "command -v jq"], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  }).stdout.trim();
  const bin = makeSharedTempDir("bash-command-guard-jq-only-");
  // jq の実体（mise の shim のこともある）を絶対パスで呼ぶラッパーだけを置く。
  writeFileSync(join(bin, "jq"), `#!/bin/sh\nexec '${jq}' "$@"\n`);
  chmodSync(join(bin, "jq"), 0o755);
  const kept = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => entry !== "" && !existsSync(join(entry, "node")));
  return { jq, env: { ...process.env, PATH: [bin, ...kept].join(delimiter) } };
})();

test("jq だけの環境を作れる（node が無く jq が在る。作れなければ以降の検証は無意味）", () => {
  expect(jqOnlyEnv.jq, "jq が必要（この検証は jq を使う処理の回帰テスト）").not.toBe("");
  const probe = (name: string) =>
    spawnSync("bash", ["-c", `command -v ${name}`], {
      env: jqOnlyEnv.env,
      timeout: CHILD_TIMEOUT_MS,
    }).status;
  expect(probe("node")).not.toBe(0);
  expect(probe("jq")).toBe(0);
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
  const r = spawnSync("bash", [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: repoRoot,
    env: jqOnlyEnv.env,
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(r.stderr).not.toMatch(/検査していない/);
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/full command line/);
});
