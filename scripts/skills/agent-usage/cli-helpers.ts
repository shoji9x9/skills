// cli.test.ts のヘルパー。
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import { encodeProjectPath } from "../../../skills/agent-usage/scripts/lib/sources/discover.mjs";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const SCRIPTS = join(import.meta.dirname, "../../../skills/agent-usage/scripts");
export const CLI = join(SCRIPTS, "agent-usage.mjs");
export const GATE = join(SCRIPTS, "precommit-gate.sh");

/** リポジトリの設定のファイル。書く前にディレクトリを作る。 */
export function repoConfigOf(repo: string): string {
  const path = join(repo, ".config", "skills", "shoji9x9", "agent-usage.jsonc");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

/** 人ごとの設定のファイル（setup の XDG_CONFIG_HOME の下）。 */
export function userConfigOf(tmp: string): string {
  return join(tmp, "xdg", "skills", "shoji9x9", "agent-usage.jsonc");
}

/** CLI と Hook に渡す環境変数。手元の設定と認証を読まないように、置き場所を tmp の下に向ける。 */
function envOf(tmp: string) {
  return {
    ...process.env,
    // 人ごとの設定は一時ディレクトリに置く（手元の設定を読まない）。旧い置き場所の変数は消す
    XDG_CONFIG_HOME: join(tmp, "xdg"),
    AGENT_USAGE_CONFIG_DIR: undefined,
    AGENT_USAGE_CLAUDE_PROJECTS: join(tmp, "claude"),
    AGENT_USAGE_CODEX_SESSIONS: join(tmp, "codex"),
    AGENT_USAGE_NOW: "2026-10-01T12:00:00Z",
    // gh の認証は手元の設定に依らせない（token を持つホストは、テストが GH_ENTERPRISE_TOKEN で作る）
    GH_CONFIG_DIR: join(tmp, "gh"),
    GH_HOST: undefined,
    GH_TOKEN: undefined,
    GITHUB_TOKEN: undefined,
    GH_ENTERPRISE_TOKEN: undefined,
    GITHUB_ENTERPRISE_TOKEN: undefined,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
}

/** Claude Code のログ: 2 回の指示と、その応答 */
function claudeLogLines(repo: string) {
  const at = (m: number) => `2026-10-01T10:${String(m).padStart(2, "0")}:00.000Z`;
  return [
    {
      type: "user",
      timestamp: at(0),
      cwd: repo,
      gitBranch: "feature/5-x",
      origin: { kind: "human" },
      message: { content: "やって" },
    },
    {
      type: "assistant",
      timestamp: at(1),
      cwd: repo,
      message: {
        id: "m1",
        model: "claude-opus-5-5",
        usage: { input_tokens: 1000000, output_tokens: 1000 },
      },
    },
    { type: "system", subtype: "turn_duration", timestamp: at(2), cwd: repo },
    {
      type: "user",
      timestamp: at(10),
      cwd: repo,
      origin: { kind: "human" },
      message: { content: "次" },
    },
    {
      type: "assistant",
      timestamp: at(11),
      cwd: repo,
      message: {
        id: "m2",
        model: "claude-opus-5-5",
        usage: { input_tokens: 10, output_tokens: 10 },
      },
    },
    { type: "system", subtype: "turn_duration", timestamp: at(12), cwd: repo },
  ];
}

export function setup() {
  const tmp = makeTempDir("agent-usage-cli-");
  const repo = join(tmp, "repo");
  mkdirSync(repo);
  const env = envOf(tmp);
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, {
      timeout: CHILD_TIMEOUT_MS,
      cwd: repo,
      env,
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout;
  };
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
  const dir = join(tmp, "claude", encodeProjectPath(repo));
  mkdirSync(dir, { recursive: true });
  const lines = claudeLogLines(repo);
  writeFileSync(join(dir, "s1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
  const cliWith = (extra: NodeJS.ProcessEnv, ...args: string[]) =>
    spawnSync("node", [CLI, ...args], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: repo,
      env: { ...env, ...extra },
      encoding: "utf8",
    });
  const cli = (...args: string[]) => cliWith({}, ...args);
  const gateWith = (extra: NodeJS.ProcessEnv, command: string, cwd = repo) =>
    spawnSync("bash", [GATE, "claude-code"], {
      timeout: CHILD_TIMEOUT_MS,
      cwd,
      env: { ...env, ...extra },
      encoding: "utf8",
      input: JSON.stringify({ cwd, tool_input: { command } }),
    });
  const gate = (command: string, cwd = repo) => gateWith({}, command, cwd);
  return { tmp, repo, git, cli, cliWith, gate, gateWith, logDir: dir, logLines: lines };
}

/**
 * setup のログを、日付を date に、メッセージの ID を tag- 付きに替えて、別のセッション（s-tag）のログとして書く。
 */
export function writeLogCopy(
  logDir: string,
  logLines: ReturnType<typeof setup>["logLines"],
  { tag, date }: { tag: string; date: string },
) {
  const copy = copyLogLines(logLines, { tag, date });
  writeFileSync(join(logDir, `s-${tag}.jsonl`), copy.map((l) => JSON.stringify(l)).join("\n"));
}

/** setup のログの、日付を date に、メッセージの ID を tag- 付きに替えた行。 */
export function copyLogLines(
  logLines: ReturnType<typeof setup>["logLines"],
  { tag, date }: { tag: string; date: string },
) {
  return logLines.map((l) => ({
    ...l,
    timestamp: l.timestamp.replace("2026-10-01", date),
    ...(l.message && "id" in l.message
      ? { message: { ...l.message, id: `${tag}-${l.message.id}` } }
      : {}),
  }));
}

/** 記録のディレクトリ（records）、その下の人のディレクトリ（person は名前）、ブランチのファイルのディレクトリ（branches）。 */
export function recordDirs(repo: string) {
  const records = join(repo, ".agent-usage", "records");
  const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
  return { records, person, branches: join(records, person, "branches") };
}

/** setup の後、タイムゾーンを UTC にし、feature/5-x に移って 1 回 collect する。 */
export function collectedOnBranch() {
  const s = setup();
  expect(s.cli("setup", "--time-zone", "UTC").status).toBe(0);
  s.git("switch", "-q", "-c", "feature/5-x");
  expect(s.cli("collect").status).toBe(0);
  return { ...s, ...recordDirs(s.repo) };
}

/** report を作り、setup のログの日の usage.csv にある input_tokens を合計する。 */
export function reportedInputTokens({ repo, cli }: Pick<ReturnType<typeof setup>, "repo" | "cli">) {
  expect(cli("report").status).toBe(0);
  const usage = readFileSync(join(repo, ".agent-usage", "report", "20261001", "usage.csv"), "utf8");
  const [header, ...body] = usage.trim().split("\n");
  const col = (header ?? "").split(",").indexOf("input_tokens");
  return body.reduce((a, l) => a + Number(l.split(",")[col] ?? 0), 0);
}

/** setup のログをコピーして続けたセッションで、コピーの後に足した指示と、その応答 */
export function continuedLogLines(repo: string) {
  return [
    {
      type: "user",
      timestamp: "2026-10-01T10:20:00.000Z",
      cwd: repo,
      origin: { kind: "human" },
      message: { content: "続き" },
    },
    {
      type: "assistant",
      timestamp: "2026-10-01T10:21:00.000Z",
      cwd: repo,
      message: {
        id: "m3",
        model: "claude-opus-5-5",
        usage: { input_tokens: 3, output_tokens: 3 },
      },
    },
    {
      type: "system",
      subtype: "turn_duration",
      timestamp: "2026-10-01T10:22:00.000Z",
      cwd: repo,
    },
  ];
}
