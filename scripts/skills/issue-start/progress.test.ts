// issue-start の `--progress` で使う進捗のファイルと statusline（progress.mjs）のテスト（Issue #338）。
//
// 期待値は references/progress.md の取り決めから決める。set は値の形が違えば書かずに exit 2 で止まり、
// statusline は入力が読めなくても読めた部分だけを出して exit 0 で終わる。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  cleanLabel,
  formatCost,
  formatProgress,
  formatLimit,
  levelColor,
  main,
  progressDir,
  shortenHome,
} from "../../../skills/issue-start/scripts/progress.mjs";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const SESSION = "8ea5a045-0442-4eb1-bfb6-9d836ca03cf7";
// 5 時間の使用量のリセットまでの残り時間を決めるための、固定した現在時刻（UNIX 時刻のミリ秒）。
const NOW_MS = 1_800_000_000_000;

type Run = { code: number; stdout: string; stderr: string };

function run(
  argv: string[],
  deps: { env: Record<string, string>; stdin?: string; branch?: string; who?: string },
): Run {
  let stdout = "";
  let stderr = "";
  const code = main(argv, {
    env: { NO_COLOR: "1", HOME: "/home/u", ...deps.env },
    stdin: () => deps.stdin ?? "",
    stdout: (s: string) => (stdout += s),
    stderr: (s: string) => (stderr += s),
    branchOf: () => deps.branch ?? "",
    who: () => deps.who ?? "",
    now: () => NOW_MS,
  });
  return { code, stdout, stderr };
}

function setArgs(done: string, total: string, label = "実装"): string[] {
  return ["set", "--done", done, "--total", total, "--label", label];
}

function claudeEnv(dir: string): Record<string, string> {
  return { ISSUE_START_PROGRESS_DIR: dir, CLAUDE_CODE_SESSION_ID: SESSION };
}

function readSaved(dir: string, session = SESSION): unknown {
  return JSON.parse(readFileSync(join(dir, `${session}.json`), "utf8"));
}

test("set は、Claude Code のセッションの ID の名前で進捗を書く", () => {
  const dir = makeTempDir("progress-");
  const r = run(setArgs("2", "5"), { env: claudeEnv(dir), branch: "feature/338-x" });
  expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(readSaved(dir)).toEqual({ done: 2, total: 5, label: "実装", branch: "feature/338-x" });
});

test("set は、Copilot CLI のセッションの ID も読み、--session があればそれを優先する", () => {
  const dir = makeTempDir("progress-");
  const env = { ISSUE_START_PROGRESS_DIR: dir, COPILOT_AGENT_SESSION_ID: "copilot-1" };
  expect(run(setArgs("0", "3"), { env }).code).toBe(0);
  expect(readSaved(dir, "copilot-1")).toMatchObject({ done: 0, total: 3 });
  expect(run([...setArgs("1", "3"), "--session", "given.1"], { env }).code).toBe(0);
  expect(readSaved(dir, "given.1")).toMatchObject({ done: 1 });
  expect(readSaved(dir, "copilot-1")).toMatchObject({ done: 0 });
});

test("set は、同じセッションの進捗を上書きし、全体の数を後から増やせる", () => {
  const dir = makeTempDir("progress-");
  run(setArgs("2", "5"), { env: claudeEnv(dir) });
  expect(run(setArgs("3", "8", "確認"), { env: claudeEnv(dir) }).code).toBe(0);
  expect(readSaved(dir)).toEqual({ done: 3, total: 8, label: "確認", branch: "" });
});

test.each([
  ["done が total を超える", setArgs("6", "5"), "--done"],
  ["total が 0", setArgs("0", "0"), "--total"],
  ["done が整数でない", setArgs("1.5", "5"), "--done"],
  ["done が負の数", setArgs("-1", "5"), "--done"],
  ["label が空白だけ", setArgs("1", "5", "   "), "--label"],
  ["label が制御文字だけ", setArgs("1", "5", "\u001b\u0007"), "--label"],
  ["未知の引数", [...setArgs("1", "5"), "--percent", "20"], "不明な引数"],
])("set は、%s ときに書かずに exit 2 で止まる", (_name, argv, message) => {
  const dir = makeTempDir("progress-");
  const r = run(argv, { env: claudeEnv(dir) });
  expect(r.code).toBe(2);
  expect(r.stderr).toContain(message);
  expect(existsSync(join(dir, `${SESSION}.json`))).toBe(false);
});

test.each([
  ["無い", {}, "セッションの ID が無い"],
  ["パスの区切りを含む", { CLAUDE_CODE_SESSION_ID: "../evil" }, "使えない文字"],
  ["`.` で始まる", { CLAUDE_CODE_SESSION_ID: ".hidden" }, "使えない文字"],
])("set は、セッションの ID が %s ときに exit 2 で止まる", (_name, session, message) => {
  const dir = makeTempDir("progress-");
  const r = run(setArgs("1", "5"), { env: { ISSUE_START_PROGRESS_DIR: dir, ...session } });
  expect(r.code).toBe(2);
  expect(r.stderr).toContain(message);
});

test("進捗の置き場所は、ISSUE_START_PROGRESS_DIR、XDG_STATE_HOME、HOME の順に決める", () => {
  expect(progressDir({ ISSUE_START_PROGRESS_DIR: "/p", XDG_STATE_HOME: "/s", HOME: "/h" })).toBe(
    "/p",
  );
  expect(progressDir({ XDG_STATE_HOME: "/s", HOME: "/h" })).toBe("/s/issue-start/progress");
  expect(progressDir({ HOME: "/h" })).toBe("/h/.local/state/issue-start/progress");
});

test.each([
  [0, 5, "[░░░░░░░░░░] 0% 調査"],
  [2, 5, "[████░░░░░░] 40% 調査"],
  [1, 3, "[███░░░░░░░] 33% 調査"],
  [5, 5, "[██████████] 100% 調査"],
  // done / total を先に割ると 28.999… になる組（浮動小数点の誤差で 1 少なく出ないこと）。
  [29, 100, "[██░░░░░░░░] 29% 調査"],
  [57, 100, "[█████░░░░░] 57% 調査"],
])("進捗の表示は、%i / %i を切り捨てた割合とバーにする", (done, total, expected) => {
  expect(formatProgress({ done, total, label: "調査" })).toBe(expected);
});

test("手順の名前は、制御文字を空白にし、40 文字を超える部分を切り詰める", () => {
  expect(cleanLabel("a\u001b[31mb\u009bc")).toBe("a [31mb c");
  expect(cleanLabel("あ".repeat(40))).toBe("あ".repeat(40));
  expect(cleanLabel("あ".repeat(41))).toBe(`${"あ".repeat(39)}…`);
});

test("手順の名前の長さは、見た目の 1 文字（書記素）で数え、絵文字の途中で切らない", () => {
  const family = "👨‍👩‍👧";
  expect(cleanLabel(family.repeat(40))).toBe(family.repeat(40));
  expect(cleanLabel(family.repeat(41))).toBe(`${family.repeat(39)}…`);
});

test.each([
  ["Claude Code の USD", { total_cost_usd: 1.234 }, "$1.23"],
  ["Copilot CLI の premium requests", { total_premium_requests: 12 }, "12 premium"],
  ["両方あれば USD", { total_cost_usd: 0, total_premium_requests: 3 }, "$0.00"],
  ["数でない", { total_cost_usd: "1" }, undefined],
  ["無い", undefined, undefined],
])("費用の表示: %s", (_name, cost, expected) => {
  expect(formatCost(cost)).toBe(expected);
});

function claudeInput(session = SESSION): string {
  return JSON.stringify({
    session_id: session,
    cwd: "/home/u/projects/app",
    model: { display_name: "Opus" },
    effort: { level: "high" },
    context_window: { used_percentage: 41.6 },
    rate_limits: {
      five_hour: { used_percentage: 30, resets_at: NOW_MS / 1000 + 130 * 60 },
      seven_day: { used_percentage: 12, resets_at: NOW_MS / 1000 + (2 * 24 + 3) * 3600 + 59 },
    },
    cost: { total_cost_usd: 1.5 },
  });
}

const CLAUDE_LOCATION = "u@host:~/projects/app (feature/338-x)";
const CLAUDE_SESSION = "Opus effort:high | ctx:42% | $1.50";
const CLAUDE_LIMITS = "5h:30%(reset 2h10m) | 7d:12%(reset 2d3h)";

test("statusline は、場所を 1 行目に、セッションの値と進捗を 2 行目に、利用枠を 3 行目に出す", () => {
  const dir = makeTempDir("progress-");
  run(setArgs("2", "5"), { env: claudeEnv(dir), branch: "feature/338-x" });
  const r = run(["statusline"], {
    env: claudeEnv(dir),
    stdin: claudeInput(),
    branch: "feature/338-x",
    who: "u@host",
  });
  expect(r).toEqual({
    code: 0,
    stdout: [CLAUDE_LOCATION, `${CLAUDE_SESSION} | [████░░░░░░] 40% 実装`, CLAUDE_LIMITS, ""].join(
      "\n",
    ),
    stderr: "",
  });
});

test("statusline は、NO_COLOR が無ければ、項目の色と使用率の状態の色を付け、費用と進捗には色を付けない", () => {
  const dir = makeTempDir("progress-");
  run(setArgs("2", "5"), { env: claudeEnv(dir), branch: "main" });
  let stdout = "";
  main(["statusline"], {
    env: { ISSUE_START_PROGRESS_DIR: dir, HOME: "/home/u" },
    stdin: () =>
      JSON.stringify({
        session_id: SESSION,
        cwd: "/home/u",
        model: { display_name: "Opus" },
        effort: { level: "high" },
        context_window: { used_percentage: 50 },
        rate_limits: {
          five_hour: { used_percentage: 49, resets_at: NOW_MS / 1000 + 60 * 60 },
          seven_day: { used_percentage: 80 },
        },
        cost: { total_cost_usd: 1 },
      }),
    stdout: (s: string) => (stdout += s),
    branchOf: () => "main",
    who: () => "u@host",
    now: () => NOW_MS,
  });
  const e = "\u001b";
  const sep = ` ${e}[90m|${e}[0m `;
  expect(stdout).toBe(
    `${e}[90mu@host${e}[0m:${e}[1;34m~${e}[0m ${e}[1;35m(main)${e}[0m\n` +
      `${e}[1;36mOpus${e}[0m ${e}[36meffort:high${e}[0m${sep}${e}[33mctx:50%${e}[0m${sep}$1.00${sep}` +
      `[████░░░░░░] 40% 実装\n` +
      `${e}[32m5h:49%${e}[0m${e}[90m(reset 1h0m)${e}[0m${sep}${e}[31m7d:80%${e}[0m\n`,
  );
});

test("statusline は、Copilot CLI の入力では premium requests の数とコンテキストの使用率を出す", () => {
  const dir = makeTempDir("progress-");
  const stdin = JSON.stringify({
    session_id: "c-1",
    context_window: { current_context_used_percentage: 12 },
    cost: { total_premium_requests: 4 },
  });
  const r = run(["statusline"], { env: { ISSUE_START_PROGRESS_DIR: dir }, stdin });
  expect(r.stdout).toBe("ctx:12% | 4 premium\n");
});

test("statusline は、記録した branch と今の branch が違えば進捗を出さず、費用の後ろに区切りを残さない", () => {
  const dir = makeTempDir("progress-");
  run(setArgs("5", "5"), { env: claudeEnv(dir), branch: "feature/337-old" });
  const r = run(["statusline"], {
    env: claudeEnv(dir),
    stdin: claudeInput(),
    branch: "feature/338-x",
    who: "u@host",
  });
  expect(r.stdout).toBe([CLAUDE_LOCATION, CLAUDE_SESSION, CLAUDE_LIMITS, ""].join("\n"));
  expect(r.stdout).not.toContain("$1.50 |");
});

test("statusline は、branch を記録していない進捗のファイルを出さない", () => {
  const dir = makeTempDir("progress-");
  writeFileSync(join(dir, `${SESSION}.json`), JSON.stringify({ done: 1, total: 2, label: "x" }));
  const stdin = JSON.stringify({ session_id: SESSION, cost: { total_cost_usd: 1 } });
  expect(run(["statusline"], { env: claudeEnv(dir), stdin }).stdout).toBe("$1.00\n");
});

test("set は、作業ディレクトリの branch を記録し、git が無ければ空にする", () => {
  const dir = makeTempDir("progress-");
  const repo = makeTempDir("progress-repo-");
  const init = spawnSync("git", ["init", "--quiet", "-b", "feature/338-x", repo], {
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(init.status).toBe(0);
  const plain = makeTempDir("progress-plain-");
  const set = (cwd: string) =>
    main(setArgs("1", "2"), { env: claudeEnv(dir), cwd, stderr: () => undefined });
  expect(set(repo)).toBe(0);
  expect(readSaved(dir)).toMatchObject({ branch: "feature/338-x" });
  expect(set(plain)).toBe(0);
  expect(readSaved(dir)).toMatchObject({ branch: "" });
});

test("statusline は、別のセッションの進捗を出さない", () => {
  const dir = makeTempDir("progress-");
  run(setArgs("2", "5"), { env: claudeEnv(dir), branch: "feature/338-x" });
  const r = run(["statusline"], {
    env: claudeEnv(dir),
    stdin: claudeInput("other-session"),
    branch: "feature/338-x",
    who: "u@host",
  });
  expect(r.stdout).toBe([CLAUDE_LOCATION, CLAUDE_SESSION, CLAUDE_LIMITS, ""].join("\n"));
});

test.each([
  ["done が total を超える", { done: 6, total: 5, label: "x", branch: "" }],
  ["total が 0", { done: 0, total: 0, label: "x", branch: "" }],
  ["label が文字列でない", { done: 1, total: 5, label: 1, branch: "" }],
  ["branch が文字列でない", { done: 1, total: 5, label: "x", branch: null }],
  ["配列", [1, 2]],
])("statusline は、形の違う進捗のファイル（%s）を出さない", (_name, saved) => {
  const dir = makeTempDir("progress-");
  writeFileSync(join(dir, `${SESSION}.json`), JSON.stringify(saved));
  const stdin = JSON.stringify({ session_id: SESSION, model: { display_name: "Opus" } });
  expect(run(["statusline"], { env: claudeEnv(dir), stdin })).toMatchObject({
    code: 0,
    stdout: "Opus\n",
  });
});

test("statusline は、形の合う進捗のファイルを、branch が同じ（どちらも空）なら出す", () => {
  const dir = makeTempDir("progress-");
  const saved = { done: 1, total: 5, label: "x", branch: "" };
  writeFileSync(join(dir, `${SESSION}.json`), JSON.stringify(saved));
  const stdin = JSON.stringify({ session_id: SESSION, model: { display_name: "Opus" } });
  expect(run(["statusline"], { env: claudeEnv(dir), stdin }).stdout).toBe(
    "Opus | [██░░░░░░░░] 20% x\n",
  );
});

test("statusline は、JSON でない進捗のファイルと、パスの区切りを含むセッションの ID を読まない", () => {
  const dir = makeTempDir("progress-");
  writeFileSync(join(dir, `${SESSION}.json`), "{");
  mkdirSync(join(dir, "sub"));
  writeFileSync(
    join(dir, "sub", "x.json"),
    JSON.stringify({ done: 0, total: 1, label: "x", branch: "" }),
  );
  const own = JSON.stringify({ session_id: SESSION, model: { display_name: "Opus" } });
  expect(run(["statusline"], { env: claudeEnv(dir), stdin: own }).stdout).toBe("Opus\n");
  const traversal = JSON.stringify({ session_id: "sub/x" });
  expect(run(["statusline"], { env: claudeEnv(dir), stdin: traversal }).stdout).toBe("\n");
});

test("statusline は、stdin が JSON でなくても空の行を出して exit 0 で終わる", () => {
  const dir = makeTempDir("progress-");
  expect(run(["statusline"], { env: claudeEnv(dir), stdin: "not json" })).toEqual({
    code: 0,
    stdout: "\n",
    stderr: "",
  });
  expect(run(["statusline"], { env: claudeEnv(dir), stdin: "null" }).stdout).toBe("\n");
});

test("statusline は、cwd が無ければ branch を探さず、user@host だけを 1 行目に出す", () => {
  const dir = makeTempDir("progress-");
  let called = false;
  let stdout = "";
  main(["statusline"], {
    env: { ...claudeEnv(dir), NO_COLOR: "1" },
    stdin: () => JSON.stringify({ model: { display_name: "Opus" } }),
    stdout: (s: string) => (stdout += s),
    branchOf: () => {
      called = true;
      return "main";
    },
    who: () => "u@host",
  });
  expect({ called, stdout }).toEqual({ called: false, stdout: "u@host\nOpus\n" });
});

test.each([
  { name: "ホームそのもの", cwd: "/home/u", home: "/home/u", expected: "~" },
  { name: "ホームの下", cwd: "/home/u/a/b", home: "/home/u", expected: "~/a/b" },
  {
    name: "名前が前方で一致するだけの別のディレクトリ",
    cwd: "/home/user2/a",
    home: "/home/u",
    expected: "/home/user2/a",
  },
  { name: "ホームが / のとき", cwd: "/a", home: "/", expected: "/a" },
  { name: "ホームが空のとき", cwd: "/a", home: "", expected: "/a" },
])("ディレクトリの表示: $name", ({ cwd, home, expected }) => {
  expect(shortenHome(cwd, home)).toBe(expected);
});

test("statusline は、利用枠が無いプランでは 3 行目を出さず、片方の枠だけなら、その枠だけを出す", () => {
  const dir = makeTempDir("progress-");
  const line = (input: object) =>
    run(["statusline"], { env: { ISSUE_START_PROGRESS_DIR: dir }, stdin: JSON.stringify(input) })
      .stdout;
  expect(line({ model: { display_name: "Opus" } })).toBe("Opus\n");
  expect(line({ model: { display_name: "Opus" }, rate_limits: {} })).toBe("Opus\n");
  expect(line({ rate_limits: { seven_day: { used_percentage: 5 } } })).toBe("7d:5%\n");
});

test.each([
  [
    "残りが 1 日以上",
    { used_percentage: 30, resets_at: NOW_MS / 1000 + 24 * 3600 },
    "5h:30%(reset 1d0h)",
  ],
  [
    "残りが 1 時間以上",
    { used_percentage: 30.4, resets_at: NOW_MS / 1000 + 61 * 60 },
    "5h:30%(reset 1h1m)",
  ],
  [
    "残りが 1 時間未満",
    { used_percentage: 30, resets_at: NOW_MS / 1000 + 59 * 60 + 30 },
    "5h:30%(reset 59m)",
  ],
  ["リセットの時刻を過ぎた", { used_percentage: 30, resets_at: NOW_MS / 1000 - 60 }, "5h:30%"],
  ["リセットの時刻が無い", { used_percentage: 30 }, "5h:30%"],
  ["リセットの時刻が数でない", { used_percentage: 30, resets_at: "soon" }, "5h:30%"],
  ["使用率が無い", { resets_at: NOW_MS / 1000 + 60 }, ""],
  ["オブジェクトでない", "x", ""],
])("利用枠の表示: %s", (_name, window, expected) => {
  expect(formatLimit("5h", window, { nowMs: NOW_MS, color: false })).toBe(expected);
});

test.each([
  [0, "32"],
  [49, "32"],
  [50, "33"],
  [79, "33"],
  [80, "31"],
  [100, "31"],
  [120, "31"],
])("使用率 %i% の状態の色は SGR %s（50% 未満は緑、80% 未満は黄、それ以上は赤）", (percent, sgr) => {
  expect(levelColor(percent)).toBe(sgr);
});

test("使用率の状態の色は、表示する四捨五入した値で決める", () => {
  const e = "\u001b";
  const window = { used_percentage: 49.5 };
  expect(formatLimit("5h", window, { nowMs: NOW_MS, color: true })).toBe(`${e}[33m5h:50%${e}[0m`);
});

test("statusline は、git で作業ディレクトリの branch を読み、リポジトリでなければ branch を出さない", () => {
  const repo = makeTempDir("progress-repo-");
  const init = spawnSync("git", ["init", "--quiet", "-b", "feature/338-x", repo], {
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(init.status).toBe(0);
  const plain = makeTempDir("progress-plain-");
  const line = (cwd: string) => {
    let stdout = "";
    main(["statusline"], {
      env: { ISSUE_START_PROGRESS_DIR: plain, NO_COLOR: "1", HOME: "/nonexistent-home" },
      stdin: () => JSON.stringify({ cwd }),
      stdout: (s: string) => (stdout += s),
      who: () => "",
    });
    return stdout;
  };
  expect(line(repo)).toBe(`${repo} (feature/338-x)\n`);
  expect(line(plain)).toBe(`${plain}\n`);
});

test("statusline は、依存を渡さなければ、この環境の user@host と現在時刻を使う", () => {
  const dir = makeTempDir("progress-");
  let stdout = "";
  main(["statusline"], {
    env: { ISSUE_START_PROGRESS_DIR: dir, NO_COLOR: "1" },
    stdin: () => "{}",
    stdout: (s: string) => (stdout += s),
  });
  expect(stdout).toMatch(/^[^@\n]+@[^@\n.]+\n$/u);
});

test("set は、進捗のファイルを書けなければ、exit 1 で理由を出して止まる", () => {
  const dir = makeTempDir("progress-");
  const blocker = join(dir, "file");
  writeFileSync(blocker, "");
  const r = run(setArgs("1", "3"), { env: claudeEnv(join(blocker, "sub")) });
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("進捗のファイルを書けない");
});

test.each([
  ["コマンドが無い", []],
  ["未知のコマンド", ["clear"]],
  ["statusline に引数がある", ["statusline", "--x"]],
])("main は、%s ときに exit 2 で止まる", (_name, argv) => {
  const r = run(argv, { env: {} });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/^usage: /m);
});
