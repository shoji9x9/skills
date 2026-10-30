// cli.test.ts のヘルパー。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import { encodeProjectPath } from "../../../skills/agent-usage/scripts/lib/sources/discover.mjs";
import { parseCsv } from "../../../skills/agent-usage/scripts/lib/csv.mjs";
import { spawnAsync } from "../../lib/spawn-async.ts";
import { makeTempDirFactory } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const SCRIPTS = join(import.meta.dirname, "../../../skills/agent-usage/scripts");
export const CLI = join(SCRIPTS, "agent-usage.mjs");
export const GATE = join(SCRIPTS, "precommit-gate.sh");

// テストは並べて実行する（`describe.concurrent`。Issue #684）ので、一時ディレクトリは makeTempDirFactory で作る。
// この関数を import したファイルの afterAll で、まとめて消す。
const newTempDir = makeTempDirFactory("agent-usage-cli-");

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

/** setup が返すもの。 */
export type Setup = Awaited<ReturnType<typeof setup>>;

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

/**
 * 使い捨てのリポジトリ（1 commit）と Claude Code のログを作り、CLI・Hook・git を起動する関数を返す。
 * 子プロセスは spawnAsync で起動する。テストを並べたときに、待っている間に別のテストが進む。
 */
export async function setup() {
  const tmp = newTempDir("t-");
  const repo = join(tmp, "repo");
  mkdirSync(repo);
  const env = envOf(tmp);
  const git = async (...args: string[]) => {
    const r = await spawnAsync("git", args, { timeout: CHILD_TIMEOUT_MS, cwd: repo, env });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout;
  };
  await git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  await git("add", "a.txt");
  await git("commit", "-q", "-m", "init");
  const dir = join(tmp, "claude", encodeProjectPath(repo));
  mkdirSync(dir, { recursive: true });
  const lines = claudeLogLines(repo);
  writeFileSync(join(dir, "s1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
  const cliWith = (extra: NodeJS.ProcessEnv, ...args: string[]) =>
    spawnAsync("node", [CLI, ...args], {
      timeout: CHILD_TIMEOUT_MS,
      cwd: repo,
      env: { ...env, ...extra },
    });
  const cli = (...args: string[]) => cliWith({}, ...args);
  const gateWith = (extra: NodeJS.ProcessEnv, command: string, cwd = repo) =>
    spawnAsync("bash", [GATE, "claude-code"], {
      timeout: CHILD_TIMEOUT_MS,
      cwd,
      env: { ...env, ...extra },
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
  logLines: Setup["logLines"],
  { tag, date }: { tag: string; date: string },
) {
  const copy = copyLogLines(logLines, { tag, date });
  writeFileSync(join(logDir, `s-${tag}.jsonl`), copy.map((l) => JSON.stringify(l)).join("\n"));
}

/** setup のログの、日付を date に、メッセージの ID を tag- 付きに替えた行。 */
export function copyLogLines(
  logLines: Setup["logLines"],
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

/** 記録を置くディレクトリ（records）、その下にある人ごとのディレクトリの名前（person）、ブランチごとのファイルを置くディレクトリ（branches）。 */
export function recordDirs(repo: string) {
  const records = join(repo, ".agent-usage", "records");
  expect(existsSync(records), "記録のディレクトリ（.agent-usage/records）が無い").toBe(true);
  const people = readdirSync(records).filter((d) => d.startsWith("p-"));
  // 0 件なら原因の分からない ENOENT で、2 件以上なら readdir の並び順で選んだ人の記録を読んで、呼び出し元が進んでしまう
  expect(people, "records の下に人ごとのディレクトリ（p-）が 1 つだけでない").toHaveLength(1);
  const person = people[0] ?? "";
  return { records, person, branches: join(records, person, "branches") };
}

/** setup の後、タイムゾーンを UTC にし、feature/5-x に移る。origin を渡すと、移る前に origin として足す。 */
export async function onFeatureBranch(origin?: string) {
  const s = await setup();
  expect((await s.cli("setup", "--time-zone", "UTC")).status).toBe(0);
  if (origin !== undefined) await s.git("remote", "add", "origin", origin);
  await s.git("switch", "-q", "-c", "feature/5-x");
  return s;
}

/** setup の後、タイムゾーンを UTC にし、feature/5-x に移って 1 回 collect する。 */
export async function collectedOnBranch() {
  const s = await onFeatureBranch();
  expect((await s.cli("collect")).status).toBe(0);
  return { ...s, ...recordDirs(s.repo) };
}

/**
 * report を作り、setup が書いたログと同じ日付の usage.csv から、input_tokens を合計する。
 * 合計が正の数でなければ失敗する。0 や NaN を返すと、二重に数えていないかを 0 と 0 で比べて通してしまう。
 */
export async function reportedInputTokens({ repo, cli }: Pick<Setup, "repo" | "cli">) {
  expect((await cli("report")).status).toBe(0);
  const usage = readFileSync(join(repo, ".agent-usage", "report", "20261001", "usage.csv"), "utf8");
  const total = parseCsv(usage).reduce((a, row) => a + Number(row.input_tokens), 0);
  expect(Number.isFinite(total) && total > 0, `input_tokens の合計: ${total}`).toBe(true);
  return total;
}

/** setup のセッション（s1）のサブエージェントのログ（`s1/subagents/<file>`）に、応答 1 件を書き、そのディレクトリを返す。 */
export function writeSubagentLog(
  { repo, logDir }: Pick<Setup, "repo" | "logDir">,
  file: string,
  message: { id: string; model: string; input: number; timestamp: string },
) {
  const sub = join(logDir, "s1", "subagents");
  mkdirSync(sub, { recursive: true });
  const line = {
    type: "assistant",
    timestamp: message.timestamp,
    cwd: repo,
    message: {
      id: message.id,
      model: message.model,
      usage: { input_tokens: message.input, output_tokens: 0 },
    },
  };
  writeFileSync(join(sub, file), JSON.stringify(line));
  return sub;
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
