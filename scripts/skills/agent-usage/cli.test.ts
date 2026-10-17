// agent-usage のコマンド（agent-usage.mjs）とコミット前の Hook（precommit-gate.sh）を、使い捨てのリポジトリで通しで確かめる。
// GitHub には問い合わせない（使い捨てのリポジトリは origin を持たないので、collect は GitHub を取得しない）。
//
// 入力の軸（Hook）:
//   コマンド       git commit を含まない／含む（`git -C x commit`・行の継続を含む）。
//   リポジトリ     .agent-usage/ が無い／ある。
//   ブランチ       デフォルトブランチ（origin/HEAD が無ければ main・master）／それ以外。
//   判断           未決定（止める）／記録しない（通す）／記録する（collect して stage し、通す）。
//   defaultDecision 無い／リポジトリの設定だけ／人の設定だけ／両方（人が優先）／読めない値（止める）。

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { commitCwd, isGitCommit } from "../../../skills/agent-usage/scripts/lib/gate.mjs";
import { parseCsv, toCsv } from "../../../skills/agent-usage/scripts/lib/csv.mjs";
import { encodeProjectPath } from "../../../skills/agent-usage/scripts/lib/sources/discover.mjs";
import { COLUMNS } from "../../../skills/agent-usage/scripts/lib/rows.mjs";
import {
  githubTarget,
  retractableRows,
} from "../../../skills/agent-usage/scripts/lib/run-collect.mjs";
import { branchLabel } from "../../../skills/agent-usage/scripts/lib/records.mjs";
import { localHourStart } from "../../../skills/agent-usage/scripts/lib/time.mjs";
import { coverageEnv } from "../../lib/testing/coverage-env.ts";
import { parseJsonAs } from "../../lib/parse-as.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const SCRIPTS = join(import.meta.dirname, "../../../skills/agent-usage/scripts");
const CLI = join(SCRIPTS, "agent-usage.mjs");
const GATE = join(SCRIPTS, "precommit-gate.sh");

describe("isGitCommit", () => {
  test.each([
    ["git commit -m x", true],
    ["git add a && git commit -F msg", true],
    ["git -C /repo commit -m x", true],
    ["git -c user.name=x commit", true],
    ["git com\\\nmit -m x", true],
    // 引用符・値を取るオプション・パス付き・代入・区切り
    ['git -C "/path with space" commit -m x', true],
    ["git -C '/a b' -c core.x=1 commit", true],
    ["git --git-dir /r/.git --work-tree /r commit", true],
    ["git --git-dir=/r/.git commit", true],
    ["git --no-pager commit", true],
    ["/usr/bin/git commit -m x", true],
    ["GIT_AUTHOR_NAME=x git commit", true],
    ["cd /r; git commit -m x", true],
    ["(cd /r && git commit)", true],
    ["echo $(git commit -m x)", true],
    ["false || git commit", true],
    ['git commit -m "a; b"', true],
    ['git commit -m "unterminated', true],
    // 検出しないもの
    ["git status", false],
    ["echo 'commit'", false],
    ["git log --grep commit", false],
    ["git commit-tree abc", false],
    ['echo "git commit"', false],
    ["git -C commit status", false],
    ["# git commit", false],
    ["git log # git commit", false],
    ['sh -c "git commit"', false],
    ["gitx commit", false],
    // シェルの予約語とラッパー
    ["if true; then git commit -m x; fi", true],
    ["for i in 1; do git commit; done", true],
    ["{ git commit; }", true],
    ["! git commit", true],
    ["time git commit", true],
    ["env FOO=1 git commit", true],
    ["env -i git commit", true],
    ["command git commit", true],
    ["sudo git commit", true],
    ["xargs -0 git commit", true],
    ["env git status", false],
    ['out="$(git commit -m x 2>&1)"', true],
    ['echo "`git commit -m x`"', true],
    ['echo "$(git status)"', false],
    ["grep -n '`git commit`' docs/a.md", false],
    ["gh pr comment 1 --body 'use $(git commit) here'", false],
    ['echo "a $(echo "$(git commit -m x)") b"', true],
    ["if git commit -m x; then echo ok; fi", true],
    ["while git commit; do :; done", true],
    ["until git commit -m y; do :; done", true],
    ["echo then commit", false],
  ])("%s → %s", (cmd, expected) => {
    expect(isGitCommit(cmd)).toBe(expected);
  });
});

describe("commitCwd", () => {
  test.each([
    ["git commit -m x", "/w"],
    ["git -C /other commit -m x", "/other"],
    ["git -C sub -C deeper commit", "/w/sub/deeper"],
    ["git -C ../o -c a=b commit", "/o"],
    ["git -C /x status && git commit", "/w"],
    ["git status", "/w"],
    ['git -C "/a b" commit "unterminated', "/w"],
    ["cd ../wt && git commit -m x", "/wt"],
    ["cd /r; git -C sub commit", "/r/sub"],
    ["cd /r && git status", "/w"],
    ["pushd ../o && git commit", "/o"],
    ["pushd sub && popd && git commit -m x", "/w"],
    ["cd /r && pushd sub && pushd x && popd && git commit", "/r/sub"],
    ["pushd +1 && git commit", "/w"],
    ['cd "$(git rev-parse --show-toplevel)" && git commit', "/w"],
    ["cd ~/x && git commit", "/w"],
    ["cd /r && cd $WT && git commit", "/w"],
  ])("%s → %s", (cmd, expected) => {
    expect(commitCwd(cmd, "/w")).toBe(expected);
  });
});

function setup() {
  const tmp = makeTempDir("agent-usage-cli-");
  const repo = join(tmp, "repo");
  mkdirSync(repo);
  const env = {
    ...process.env,
    AGENT_USAGE_CONFIG_DIR: join(tmp, "user"),
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
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: repo, env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout;
  };
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
  // Claude Code のログ: 2 回の指示と、その応答
  const dir = join(tmp, "claude", encodeProjectPath(repo));
  mkdirSync(dir, { recursive: true });
  const at = (m: number) => `2026-10-01T10:${String(m).padStart(2, "0")}:00.000Z`;
  const lines = [
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
  writeFileSync(join(dir, "s1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
  const cliWith = (extra: NodeJS.ProcessEnv, ...args: string[]) =>
    spawnSync("node", [CLI, ...args], { cwd: repo, env: { ...env, ...extra }, encoding: "utf8" });
  const cli = (...args: string[]) => cliWith({}, ...args);
  const gate = (command: string, cwd = repo) =>
    spawnSync("bash", [GATE, "claude-code"], {
      cwd,
      env,
      encoding: "utf8",
      input: JSON.stringify({ cwd, tool_input: { command } }),
    });
  return { tmp, repo, git, cli, cliWith, gate, logDir: dir, logLines: lines };
}

describe("agent-usage のコマンドと Hook", () => {
  test("setup 前は Hook が何もせず通し、collect はセットアップを求めて失敗する", () => {
    const { git, cli, gate } = setup();
    git("switch", "-q", "-c", "feature/5-x");
    expect(gate("git commit -m x").status).toBe(0);
    const r = cli("collect", "--no-github");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/setup/);
    // Hook は何もしないので、status も判断を「未決定」と出さない
    expect(cli("status").stdout).toMatch(/^このブランチの判断: 対象外（\.agent-usage\/ が無い/m);
  });

  test("判断の無い feature ブランチのコミットを止め、記録しないと決めたら通す。デフォルトブランチでは止めない", () => {
    const { git, cli, gate } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    expect(gate("git commit -m x").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(gate("git status").status).toBe(0);
    const blocked = gate("git add a && git commit -m x");
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/collect --stage/);
    expect(blocked.stderr).toMatch(/decline/);
    expect(cli("decline").status).toBe(0);
    expect(gate("git commit -m x").status).toBe(0);
  });

  test("判断の無いブランチでは、defaultDecision に従って止めずに通す。人の設定がリポジトリの設定より優先する", () => {
    const { tmp, repo, git, cli, gate } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    const repoConfig = join(repo, ".agent-usage", "config.json");
    const userConfig = join(tmp, "user", "config.json");
    const user = parseJsonAs<Record<string, unknown>>(readFileSync(userConfig, "utf8"));
    const staged = () => git("diff", "--cached", "--name-only").trim();

    // リポジトリの設定が decline: 記録せずに通す
    writeFileSync(repoConfig, JSON.stringify({ defaultDecision: "decline" }));
    const declined = gate("git commit -m x");
    expect(declined.status).toBe(0);
    expect(declined.stderr).toContain(`${repoConfig} の defaultDecision: decline`);
    expect(staged()).toBe("");
    expect(cli("status").stdout).toMatch(/未決定（defaultDecision: decline、/);

    // 人の設定の record が、リポジトリの設定の decline より優先する。記録して stage し、出所を出す
    writeFileSync(userConfig, JSON.stringify({ ...user, defaultDecision: "record" }));
    const recorded = gate("git commit -m x");
    expect(recorded.status).toBe(0);
    expect(recorded.stderr + recorded.stdout).toContain(`${userConfig} の defaultDecision: record`);
    expect(staged()).toMatch(/\.agent-usage\/records\//);

    // setup を実行し直しても、人の設定の defaultDecision は残る
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    expect(
      parseJsonAs<Record<string, unknown>>(readFileSync(userConfig, "utf8")).defaultDecision,
    ).toBe("record");

    // ブランチの判断は defaultDecision より優先する
    expect(cli("decline").status).toBe(0);
    git("reset", "-q");
    expect(gate("git commit -m x").status).toBe(0);
    expect(staged()).toBe("");

    // 反対の組み合わせ: 人の設定の decline が、リポジトリの設定の record より優先する
    git("switch", "-q", "-c", "feature/6-y");
    writeFileSync(repoConfig, JSON.stringify({ defaultDecision: "record" }));
    writeFileSync(userConfig, JSON.stringify({ ...user, defaultDecision: "decline" }));
    const userDeclined = gate("git commit -m x");
    expect(userDeclined.status).toBe(0);
    expect(userDeclined.stderr).toContain(`${userConfig} の defaultDecision: decline`);
    expect(staged()).toBe("");
  });

  test("リポジトリの defaultDecision: record で人の設定が無ければ、人の ID を作って記録し、作ったことを知らせる。デフォルトブランチの status は対象外と出す", () => {
    const { tmp, repo, git, cli, gate } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    writeFileSync(
      join(repo, ".agent-usage", "config.json"),
      JSON.stringify({ defaultDecision: "record" }),
    );
    expect(cli("status").stdout).toMatch(/このブランチの判断: 対象外（デフォルトブランチ/);
    git("switch", "-q", "-c", "feature/5-x");
    const userConfig = join(tmp, "user", "config.json");
    rmSync(userConfig);

    const recorded = gate("git commit -m x");
    expect(recorded.status).toBe(0);
    expect(recorded.stderr + recorded.stdout).toContain(`人の ID を作った: p-`);
    expect(recorded.stderr + recorded.stdout).toContain(userConfig);
    expect(existsSync(userConfig)).toBe(true);
  });

  test("defaultDecision が読めない値なら、コミットを止めて理由を返す。どちらの設定にも無ければ確かめる", () => {
    const { tmp, repo, git, cli, gate } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    const repoConfig = join(repo, ".agent-usage", "config.json");
    const userConfig = join(tmp, "user", "config.json");
    const user = parseJsonAs<Record<string, unknown>>(readFileSync(userConfig, "utf8"));

    writeFileSync(repoConfig, JSON.stringify({ defaultDecision: "yes" }));
    const badRepo = gate("git commit -m x");
    expect(badRepo.status).toBe(2);
    expect(badRepo.stderr).toMatch(/設定を読めない: .*defaultDecision: record か decline でない/);
    // 設定を読めなくても、記録しない側で先へ進める方法を案内する
    expect(badRepo.stderr).toMatch(/decline を実行してからコミット/);
    // status は設定を読めなくても止まらず、理由をブランチの判断の行に出す
    const status = cli("status");
    expect(status.status).toBe(0);
    expect(status.stdout).toMatch(/このブランチの判断: 未決定（設定を読めない: .*defaultDecision/);
    expect(status.stdout).toContain("人の設定: ");

    writeFileSync(repoConfig, "{}");
    writeFileSync(userConfig, JSON.stringify({ ...user, defaultDecision: "ask" }));
    const badUser = gate("git commit -m x");
    expect(badUser.status).toBe(2);
    expect(badUser.stderr).toMatch(/設定を読めない: .*defaultDecision: record か decline でない/);

    writeFileSync(userConfig, JSON.stringify(user));
    const ask = gate("git commit -m x");
    expect(ask.status).toBe(2);
    expect(ask.stderr).toMatch(/defaultDecision（record か decline）を置きます/);

    // null は置いていないのと同じに扱い、読めない設定として止めずに確かめる
    writeFileSync(repoConfig, JSON.stringify({ defaultDecision: null }));
    const askNull = gate("git commit -m x");
    expect(askNull.status).toBe(2);
    expect(askNull.stderr).toMatch(/defaultDecision（record か decline）を置きます/);

    // 判断の記録を読めなくても、status は止まらずに理由を出す
    mkdirSync(join(repo, ".git", "agent-usage"), { recursive: true });
    writeFileSync(join(repo, ".git", "agent-usage", "decisions.json"), "");
    const badDecisions = cli("status");
    expect(badDecisions.status).toBe(0);
    expect(badDecisions.stdout).toMatch(/^このブランチの判断: 判断の記録を読めない: /m);
    expect(badDecisions.stdout).toContain("人の設定: ");
  });

  test("collect --stage は明細を書いて stage し、記録すると決めたブランチのコミットでは Hook が collect して通す", () => {
    const { repo, git, cli, gate } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    const first = cli("collect", "--stage");
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/新しい行: \d+/);
    const staged = git("diff", "--cached", "--name-only").trim().split("\n");
    const file = staged.find((p) =>
      /^\.agent-usage\/records\/p-[0-9a-f]{8}\/branches\/\d{8}T\d{6}Z-feature-5-x\.csv$/.test(p),
    );
    expect(file).toBeDefined();
    // 新しいログが増えたら、Hook が collect して、同じブランチのファイルに足して stage する
    git("commit", "-q", "-m", "records");
    const dir = readdirSync(join(repo, ".agent-usage", "records"));
    const person = dir.find((d) => d.startsWith("p-")) ?? "";
    const branches = join(repo, ".agent-usage", "records", person, "branches");
    const beforeText = readFileSync(join(repo, file ?? ""), "utf8");
    const passed = gate("git commit -m y");
    expect(passed.status).toBe(0);
    // ログは変わっていないので、増えるのはテストが今した commit（reflog の人の commit）の行だけで、既存の行の後ろに足す
    expect(readdirSync(branches)).toHaveLength(1);
    const afterText = readFileSync(join(repo, file ?? ""), "utf8");
    expect(afterText.startsWith(beforeText)).toBe(true);
    const added = afterText.slice(beforeText.length).trim().split("\n");
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((l) => l.startsWith("activity:commit:"))).toBe(true);
    expect(git("diff", "--cached", "--name-only")).toMatch(/\.agent-usage\/records\//);
    // もう一度 Hook を通しても、同じ内容は書き直さず、ファイルも増えない
    expect(gate("git commit -m z").status).toBe(0);
    expect(readFileSync(join(repo, file ?? ""), "utf8")).toBe(afterText);
    expect(readdirSync(join(repo, ".agent-usage", "records", person))).toEqual(["branches"]);
  });

  test("report は report/<日付>/ に HTML と 3 つの CSV を書き、費用と稼働を集計する", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const r = cli("report");
    expect(r.status).toBe(0);
    const out = join(repo, ".agent-usage", "report", "20261001");
    for (const f of ["index.html", "usage.csv", "intervals.csv", "reviews.csv"])
      expect(existsSync(join(out, f))).toBe(true);
    const usage = readFileSync(join(out, "usage.csv"), "utf8");
    expect(usage).toMatch(/2026-10-01,p-[0-9a-f]{8},p-[0-9a-f]{8},claude-code,claude-opus-5-5/);
    const intervals = readFileSync(join(out, "intervals.csv"), "utf8").trim().split("\n");
    expect(intervals.filter((l) => l.startsWith("run,"))).toHaveLength(2);
    expect(readFileSync(join(out, "index.html"), "utf8")).toMatch(
      /<title>エージェントの利用実績<\/title>/,
    );
    expect(cli("report", "--since", "2026-10-02", "--until", "2026-10-01").status).toBe(1);
    expect(cli("report", "--since", "10/01").status).toBe(1);
  });

  test("Hook が実行された worktree のパスを覚え、その worktree を削除した後も collect がログを集める", () => {
    const { tmp, repo, git, cli, gate } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("add", ".agent-usage");
    git("commit", "-q", "-m", "setup");
    const wt = join(tmp, "wt");
    git("worktree", "add", "-q", "-b", "feature/7-wt", wt);
    // worktree のパスのディレクトリにだけあるログ
    const dir = join(tmp, "claude", encodeProjectPath(wt));
    mkdirSync(dir, { recursive: true });
    const lines = [
      {
        type: "user",
        timestamp: "2026-10-01T11:00:00.000Z",
        cwd: wt,
        gitBranch: "feature/7-wt",
        origin: { kind: "human" },
        message: { content: "wt" },
      },
      {
        type: "assistant",
        timestamp: "2026-10-01T11:01:00.000Z",
        cwd: wt,
        message: {
          id: "w1",
          model: "claude-opus-5-5",
          usage: { input_tokens: 10, output_tokens: 10 },
        },
      },
    ];
    writeFileSync(join(dir, "s-wt.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
    // 判断の無いブランチで止まるときも、パスは覚える
    expect(gate("git commit -m x", wt).status).toBe(2);
    git("worktree", "remove", "--force", wt);
    git("switch", "-q", "-c", "feature/8-main");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const text = readdirSync(join(records, person, "branches"))
      .map((f) => readFileSync(join(records, person, "branches", f), "utf8"))
      .join("");
    expect(text).toMatch(/usage:claude-code:s-wt:/);
  });

  test("Hook は、前に書いて stage されなかった記録も stage する", () => {
    const { repo, git, cli, gate } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect", "--stage").status).toBe(0);
    git("commit", "-q", "-m", "records");
    // 手動の collect（--stage なし）が足した記録は stage されない
    git("commit", "-q", "--allow-empty", "-m", "work");
    expect(cli("collect").status).toBe(0);
    const unstaged = git("diff", "--name-only", "--", ".agent-usage/records").trim();
    expect(unstaged).not.toBe("");
    expect(gate("git commit -m y").status).toBe(0);
    const staged = git("diff", "--cached", "--name-only").trim().split("\n");
    for (const f of unstaged.split("\n")) expect(staged).toContain(f);
    expect(existsSync(join(repo, unstaged.split("\n")[0] ?? ""))).toBe(true);
  });

  test("2 つのブランチで並行して記録しても、merge で記録のファイルが競合しない", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("add", ".agent-usage");
    git("commit", "-q", "-m", "setup");
    git("switch", "-q", "-c", "feature/5-a");
    expect(cli("collect", "--stage").status).toBe(0);
    git("commit", "-q", "-m", "a");
    expect(cli("collect", "--stage").status).toBe(0);
    git("commit", "-q", "--allow-empty", "-m", "a2");
    git("switch", "-q", "main");
    git("switch", "-q", "-c", "feature/6-b");
    expect(cli("collect", "--stage").status).toBe(0);
    git("commit", "-q", "-m", "b");
    git("merge", "-q", "--no-edit", "feature/5-a");
    expect(git("status", "--porcelain")).toBe("");
    const person = readdirSync(join(repo, ".agent-usage", "records")).find((d) =>
      d.startsWith("p-"),
    );
    const files = readdirSync(join(repo, ".agent-usage", "records", person ?? "", "branches"));
    expect(files.map((f) => f.replace(/^\d{8}T\d{6}Z-/, "")).sort()).toEqual([
      "feature-5-a.csv",
      "feature-6-b.csv",
    ]);
  });

  test("古い形（collect 1 回につき 1 ファイル）と新しい形が混在しても、report の結果は同じ", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const [name] = readdirSync(branches);
    const text = readFileSync(join(branches, name ?? ""), "utf8");
    const report = () => {
      expect(cli("report").status).toBe(0);
      const out = join(repo, ".agent-usage", "report", "20261001");
      return ["usage.csv", "intervals.csv", "reviews.csv"].map((f) =>
        readFileSync(join(out, f), "utf8"),
      );
    };
    const onlyNew = report();
    const [header, ...body] = text.trim().split("\n");
    expect(body.length).toBeGreaterThan(1);
    const half = Math.ceil(body.length / 2);
    // 半分を古い形のファイルに移す（混在）
    writeFileSync(join(branches, name ?? ""), `${[header, ...body.slice(half)].join("\n")}\n`);
    writeFileSync(
      join(records, person, "20261001T110000Z-5.csv"),
      `${[header, ...body.slice(0, half)].join("\n")}\n`,
    );
    expect(report()).toEqual(onlyNew);
    // すべてを古い形のファイルに移す
    rmSync(branches, { recursive: true });
    writeFileSync(join(records, person, "20261001T110000Z-5.csv"), text);
    expect(report()).toEqual(onlyNew);
  });

  test("collect は範囲より古いファイルを読まず、範囲の外の key を書き直しても report の結果は変わらない", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const [name] = readdirSync(branches);
    expect(cli("report").status).toBe(0);
    const out = join(repo, ".agent-usage", "report", "20261001");
    const baseline = readFileSync(join(out, "usage.csv"), "utf8");
    // 同じ行を、範囲（60 日）より古い時刻の古い形のファイルに移す
    const text = readFileSync(join(branches, name ?? ""), "utf8");
    rmSync(branches, { recursive: true });
    // そのときに書いた行なので、observed_at も範囲より古い
    writeFileSync(
      join(records, person, "20260701T000000Z-5.csv"),
      text.replaceAll("2026-10-01T12:00:00.000Z", "2026-07-01T00:00:00.000Z"),
    );
    const again = cli("collect");
    expect(again.stdout).toMatch(/範囲より古いので読まなかった記録のファイル: 1/);
    // 読まなかったので、同じ key の行をもう一度書く（重複）
    expect(readFileSync(join(branches, readdirSync(branches)[0] ?? ""), "utf8")).toContain(
      "usage:claude-code:s1:",
    );
    expect(cli("report").status).toBe(0);
    expect(readFileSync(join(out, "usage.csv"), "utf8")).toBe(baseline);
  });

  test("1 つのブランチで時刻を変えて何回 collect しても、記録のファイルは人別・GitHub のそれぞれ 1 つまで", () => {
    const { tmp, repo, git, cli, cliWith } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("remote", "add", "origin", "https://github.com/example-org/example-repo.git");
    git("switch", "-q", "-c", "feature/5-x");
    // 偽の gh: api は失敗する（取得した期間の行が、取得の失敗として毎回書かれる）
    const bin = join(tmp, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), "#!/bin/sh\necho fail >&2\nexit 1\n", { mode: 0o755 });
    const path = `${bin}:${process.env.PATH ?? ""}`;
    for (const [i, now] of [
      "2026-10-01T12:00:00Z",
      "2026-10-01T13:00:00Z",
      "2026-10-02T09:00:00Z",
    ].entries()) {
      git("commit", "-q", "--allow-empty", "-m", `work ${i}`);
      const r = cliWith({ AGENT_USAGE_NOW: now, PATH: path }, "collect", "--stage");
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/書いた: /);
    }
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    expect(readdirSync(join(records, person))).toEqual(["branches"]);
    expect(readdirSync(join(records, person, "branches"))).toEqual([
      "20261001T120000Z-feature-5-x.csv",
    ]);
    expect(readdirSync(join(records, "_github"))).toEqual([person]);
    expect(readdirSync(join(records, "_github", person))).toEqual([
      "20261001T120000Z-feature-5-x.csv",
    ]);
  });

  test("デフォルトブランチに入った（squash merge された）ブランチのファイルには足さず、新しいファイルを作る", () => {
    const { tmp, repo, git, cli, cliWith } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect", "--stage").status).toBe(0);
    // 他のマシンの時計が進んでいたことにする（デフォルトブランチに入るファイルの時刻が、今より後）
    const records0 = join(repo, ".agent-usage", "records");
    const person0 = readdirSync(records0).find((d) => d.startsWith("p-")) ?? "";
    const branches0 = join(records0, person0, "branches");
    const [created] = readdirSync(branches0);
    renameSync(join(branches0, created ?? ""), join(branches0, "20261005T000000Z-feature-5-x.csv"));
    git("add", "-A", ".agent-usage");
    git("commit", "-q", "-m", "records");
    // squash merge と同じく、今の内容を、このブランチの commit を祖先に持たない 1 つの commit として origin の main に入れる
    const origin = join(tmp, "origin.git");
    expect(spawnSync("git", ["init", "-q", "--bare", origin], { timeout: 30_000 }).status).toBe(0);
    git("remote", "add", "origin", origin);
    const squash = git("commit-tree", "HEAD^{tree}", "-p", "main", "-m", "squash").trim();
    git("push", "-q", "origin", `${squash}:refs/heads/main`);
    git("fetch", "-q", "origin");
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const [first] = readdirSync(branches);
    const before = readFileSync(join(branches, first ?? ""), "utf8");
    // 同じブランチで作業を続ける（同じ秒の collect でも、名前が重ならない）
    git("commit", "-q", "--allow-empty", "-m", "more");
    expect(cliWith({}, "collect", "--stage").status).toBe(0);
    const files = readdirSync(branches);
    expect(files).toHaveLength(2);
    // 新しいファイルは、デフォルトブランチに入ったファイルより後に並び、次の collect はそれに足す
    expect(files[1]).toBe("20261005T000001Z-feature-5-x.csv");
    git("commit", "-q", "--allow-empty", "-m", "more2");
    expect(cliWith({}, "collect", "--stage").status).toBe(0);
    expect(readdirSync(branches)).toHaveLength(2);
    expect(readFileSync(join(branches, first ?? ""), "utf8")).toBe(before);
    git("commit", "-q", "-m", "more records");
    // デフォルトブランチを取り込んでも競合しない（git は競合すると 0 以外で終わり、未解決のパスを残す）
    git("merge", "-q", "--no-edit", "origin/main");
    expect(git("diff", "--name-only", "--diff-filter=U")).toBe("");
  });

  test("古い形のファイルは、名前の時刻だけで読むかを決める（末尾を読まない）", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    // 名前の時刻は範囲より古く、最後の行は範囲の中（古い形は後から書き足さないので、この組み合わせは読まない）
    writeFileSync(
      join(records, person, "20260701T000000Z-5.csv"),
      readFileSync(
        join(records, person, "branches", readdirSync(join(records, person, "branches"))[0] ?? ""),
        "utf8",
      ),
    );
    expect(cli("collect").stdout).toMatch(/範囲より古いので読まなかった記録のファイル: 1/);
  });

  test("この clone で初めての collect は、記録の全体を読み、範囲より古い記録済みの行を重ねて書かない", () => {
    const { repo, git, cli, logDir, logLines } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    // 範囲より古いセッションのログを、古い形のファイルに記録済みにしておく
    const old = logLines.map((l) => ({
      ...l,
      timestamp: l.timestamp.replace("2026-10-01", "2026-07-01"),
      ...(l.message && "id" in l.message
        ? { message: { ...l.message, id: `old-${l.message.id}` } }
        : {}),
    }));
    writeFileSync(join(logDir, "s-old.jsonl"), old.map((l) => JSON.stringify(l)).join("\n"));
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const [name] = readdirSync(branches);
    writeFileSync(
      join(records, person, "20260701T000000Z-5.csv"),
      readFileSync(join(branches, name ?? ""), "utf8").replaceAll(
        "2026-10-01T12:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      ),
    );
    rmSync(branches, { recursive: true });
    // 新しい clone と同じ状態（last-collect.json が無い）
    rmSync(join(repo, ".git", "agent-usage", "last-collect.json"));
    const again = cli("collect");
    expect(again.stdout).not.toMatch(/範囲より古いので読まなかった/);
    // 記録済みの行は書かないので、新しいブランチのファイルは作られないか、古い行を含まない
    const text = existsSync(branches)
      ? readdirSync(branches)
          .map((f) => readFileSync(join(branches, f), "utf8"))
          .join("")
      : "";
    expect(text).not.toContain("usage:claude-code:s-old:");
  });

  test("デフォルトブランチ自身では、push した後も同じファイルに足す", () => {
    const { tmp, repo, git, cliWith } = setup();
    expect(cliWith({}, "setup", "--time-zone", "UTC").status).toBe(0);
    expect(cliWith({}, "collect", "--stage").status).toBe(0);
    git("commit", "-q", "-m", "records");
    const origin = join(tmp, "origin.git");
    expect(spawnSync("git", ["init", "-q", "--bare", origin], { timeout: 30_000 }).status).toBe(0);
    git("remote", "add", "origin", origin);
    git("push", "-q", "origin", "HEAD:main");
    git("fetch", "-q", "origin");
    git("commit", "-q", "--allow-empty", "-m", "more");
    expect(cliWith({ AGENT_USAGE_NOW: "2026-10-01T13:00:00Z" }, "collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    expect(readdirSync(join(records, person, "branches"))).toHaveLength(1);
  });

  test("今のブランチのファイルは、範囲より古い時刻でも読み、同じ行を書き直さない", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const [name] = readdirSync(branches);
    // そのブランチで最後に collect したのも範囲より前だったことにする（名前の時刻と observed_at）
    const renamed = join(branches, "20260701T000000Z-feature-5-x.csv");
    const original = readFileSync(join(branches, name ?? ""), "utf8");
    rmSync(join(branches, name ?? ""));
    writeFileSync(
      renamed,
      original.replaceAll("2026-10-01T12:00:00.000Z", "2026-07-01T00:00:00.000Z"),
    );
    const before = readFileSync(renamed, "utf8");
    const again = cli("collect");
    expect(again.stdout).toMatch(/新しい行: 0/);
    expect(readdirSync(branches)).toEqual(["20260701T000000Z-feature-5-x.csv"]);
    expect(readFileSync(renamed, "utf8")).toBe(before);
  });

  test("この clone で範囲の中に collect していれば、範囲より古いログの行は書かない（していなければ書く）", () => {
    const { repo, git, cli, logDir, logLines } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    // 範囲（60 日）より古いセッションのログを足す
    const old = logLines.map((l) => ({
      ...l,
      timestamp: l.timestamp.replace("2026-10-01", "2026-07-01"),
      ...(l.message && "id" in l.message
        ? { message: { ...l.message, id: `old-${l.message.id}` } }
        : {}),
    }));
    writeFileSync(join(logDir, "s-old.jsonl"), old.map((l) => JSON.stringify(l)).join("\n"));
    const skipped = cli("collect");
    expect(skipped.status).toBe(0);
    // 書かなかった行の件数を出す（取りこぼしに気づけるように）
    expect(skipped.stdout).toMatch(/開始時刻が範囲より古いので書かなかった行: [1-9]/);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const read = () =>
      readdirSync(branches)
        .map((f) => readFileSync(join(branches, f), "utf8"))
        .join("");
    expect(read()).not.toContain("usage:claude-code:s-old:");
    // 別の clone（別のマシン）で記録した行が範囲の中にあっても、この clone で collect していなければ、古い行も書く
    rmSync(join(repo, ".git", "agent-usage", "last-collect.json"));
    expect(cli("collect").status).toBe(0);
    expect(read()).toContain("usage:claude-code:s-old:");
  });

  test("名前の時刻が範囲より古くても最後の行が範囲の中のファイルは読み、別のブランチで同じ行を書き直さない", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const [name] = readdirSync(branches);
    // 長く続いたブランチ: 初めて collect したのは範囲より前で、最近も行を足した（最後の行の observed_at は今）
    renameSync(join(branches, name ?? ""), join(branches, "20260701T000000Z-feature-5-x.csv"));
    git("switch", "-q", "-c", "feature/6-y");
    git("commit", "-q", "--allow-empty", "-m", "work");
    const again = cli("collect");
    expect(again.status).toBe(0);
    expect(again.stdout).not.toMatch(/範囲より古いので読まなかった/);
    const other = readdirSync(branches).filter((f) => f.endsWith("-feature-6-y.csv"));
    const text = other.map((f) => readFileSync(join(branches, f), "utf8")).join("");
    expect(text).not.toContain("usage:claude-code:s1:");
  });

  test("この clone で最後に collect したのが範囲より前なら、範囲より古いログの行も書く", () => {
    const { repo, git, cli, logDir, logLines } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const state = join(repo, ".git", "agent-usage", "last-collect.json");
    const readState = (): Record<string, unknown> => {
      const v: unknown = JSON.parse(readFileSync(state, "utf8"));
      if (typeof v !== "object" || v === null)
        throw new Error("last-collect.json がオブジェクトでない");
      return Object.fromEntries(Object.entries(v));
    };
    const saved = readState();
    const person = Object.keys(saved)[0] ?? "";
    expect(saved[person]).toBe("2026-10-01T12:00:00.000Z");
    // 時計が進んでいたときに保存した、今より後の時刻は信じない（範囲の中で collect していないとして扱う）
    writeFileSync(state, JSON.stringify({ [person]: "2030-01-01T00:00:00.000Z" }));
    const old0 = logLines.map((l) => ({
      ...l,
      timestamp: l.timestamp.replace("2026-10-01", "2026-07-10"),
      ...(l.message && "id" in l.message
        ? { message: { ...l.message, id: `future-${l.message.id}` } }
        : {}),
    }));
    writeFileSync(join(logDir, "s-future.jsonl"), old0.map((l) => JSON.stringify(l)).join("\n"));
    expect(cli("collect").status).toBe(0);
    expect(readState()[person]).toBe("2026-10-01T12:00:00.000Z");
    const branches0 = join(repo, ".agent-usage", "records", person, "branches");
    expect(
      readdirSync(branches0)
        .map((f) => readFileSync(join(branches0, f), "utf8"))
        .join(""),
    ).toContain("usage:claude-code:s-future:");
    // 最後に collect したのが範囲より前だったことにする
    writeFileSync(state, JSON.stringify({ [person]: "2026-07-01T00:00:00.000Z" }));
    // 前回の collect の後（範囲より前）のセッションのログを足す
    const old = logLines.map((l) => ({
      ...l,
      timestamp: l.timestamp.replace("2026-10-01", "2026-07-15"),
      ...(l.message && "id" in l.message
        ? { message: { ...l.message, id: `old-${l.message.id}` } }
        : {}),
    }));
    writeFileSync(join(logDir, "s-old.jsonl"), old.map((l) => JSON.stringify(l)).join("\n"));
    expect(cli("collect").status).toBe(0);
    const branches = join(repo, ".agent-usage", "records", person, "branches");
    const text = readdirSync(branches)
      .map((f) => readFileSync(join(branches, f), "utf8"))
      .join("");
    expect(text).toContain("usage:claude-code:s-old:");
    expect(text).toContain("usage:claude-code:s-future:");
    expect(readState()[person]).toBe("2026-10-01T12:00:00.000Z");
  });

  test("ブランチのファイルの改行と、知らない列を保って足す", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const file = join(branches, readdirSync(branches)[0] ?? "");
    const text = readFileSync(file, "utf8");
    // CRLF のファイル（Windows の core.autocrlf）には、CRLF のまま後ろに足す
    writeFileSync(file, text.replace(/\n/g, "\r\n"));
    git("commit", "-q", "--allow-empty", "-m", "work");
    expect(cli("collect").status).toBe(0);
    const crlf = readFileSync(file, "utf8");
    expect(crlf.startsWith(text.replace(/\n/g, "\r\n"))).toBe(true);
    expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");
    // 新しい版が足した列（この版が知らない列）の値は、書き直しても落とさない
    const [header, ...body] = text.trim().split("\n");
    writeFileSync(
      file,
      `${[`${header},future_col`, ...body.map((l) => `${l},keep-me`)].join("\n")}\n`,
    );
    git("commit", "-q", "--allow-empty", "-m", "work2");
    expect(cli("collect").status).toBe(0);
    const merged = readFileSync(file, "utf8");
    expect(merged.split("\n")[0]).toMatch(/,future_col$/);
    expect(merged.split("keep-me").length - 1).toBe(body.length);
  });

  test.each([
    ["ASCII の名前はそのまま", "feature/5-x", "feature-5-x"],
    ["末尾の - を消す名前はハッシュを足す", "feature/x-", /^feature-x-[0-9a-f]{8}$/],
    ["英数字以外を含む名前はハッシュを足す", "feature/日本語", /^feature-[0-9a-f]{8}$/],
    ["長い名前は切ってハッシュを足す", `feature/${"a".repeat(300)}`, /^feature-a{83}-[0-9a-f]{8}$/],
  ])("branchLabel: %s", (_case, branch, expected) => {
    const label = branchLabel(branch);
    if (typeof expected === "string") expect(label).toBe(expected);
    else expect(label).toMatch(expected);
    expect(label.length).toBeLessThanOrEqual(100);
  });

  test("範囲より古い開始時刻の行でも、読んだ記録に同じ key があって内容が変われば書く", () => {
    const { repo, git, cli, logDir, logLines } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    // 範囲より古いセッションのログ（初めての collect なので書く）
    const old = logLines.map((l) => ({
      ...l,
      timestamp: l.timestamp.replace("2026-10-01", "2026-07-01"),
      ...(l.message && "id" in l.message
        ? { message: { ...l.message, id: `old-${l.message.id}` } }
        : {}),
    }));
    const write = (lines: unknown[]) =>
      writeFileSync(join(logDir, "s-old.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
    write(old);
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const read = () =>
      readdirSync(branches)
        .map((f) => readFileSync(join(branches, f), "utf8"))
        .join("")
        .split("\n")
        .filter((l) => l.startsWith("usage:claude-code:s-old:"));
    const before = read();
    expect(before.length).toBeGreaterThan(0);
    // 同じセッションの同じ日に応答を足す（同じ key の行の内容が変わる）
    write([
      ...old,
      {
        type: "assistant",
        timestamp: "2026-07-01T10:13:00.000Z",
        cwd: repo,
        message: {
          id: "old-m3",
          model: "claude-opus-5-5",
          usage: { input_tokens: 5, output_tokens: 5 },
        },
      },
    ]);
    expect(cli("collect").status).toBe(0);
    expect(read().length).toBeGreaterThan(before.length);
  });

  test("英数字以外を含むブランチの名前は、ハッシュを足して別のブランチと別のファイルにする", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/日本語");
    expect(cli("collect").status).toBe(0);
    git("switch", "-q", "main");
    git("switch", "-q", "-c", "feature/中文");
    git("commit", "-q", "--allow-empty", "-m", "work");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const files = readdirSync(join(records, person, "branches"));
    expect(files).toHaveLength(2);
    for (const f of files) expect(f).toMatch(/^\d{8}T\d{6}Z-feature-[0-9a-f]{8}\.csv$/);
  });

  test("見出しの列が今と違うファイルに足すときは、今の列で書き直す", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const file = join(branches, readdirSync(branches)[0] ?? "");
    // 列の少ない版が書いたファイル（detail の列が無い）
    const columns = [...COLUMNS].filter((c) => c !== "detail");
    writeFileSync(file, toCsv(columns, parseCsv(readFileSync(file, "utf8"))));
    git("commit", "-q", "--allow-empty", "-m", "work");
    const again = cli("collect");
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/書いた: /);
    expect(readFileSync(file, "utf8").split("\n")[0]).toBe(COLUMNS.join(","));
    expect(cli("report").status).toBe(0);
  });

  test("オフセットが 30 分のタイムゾーンでは、日付の境目の前後の使用量をそれぞれの日に入れる", () => {
    const { repo, git, cli, logDir } = setup();
    expect(cli("setup", "--time-zone", "Asia/Kolkata").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    // 18:20Z は IST の前日の 23:50、18:40Z は IST の翌日の 00:10（どちらも UTC では 18 時台）
    const msg = (id: string, ts: string) => ({
      type: "assistant",
      timestamp: ts,
      cwd: repo,
      message: { id, model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 0 } },
    });
    const lines = [
      {
        type: "user",
        timestamp: "2026-10-01T18:19:00.000Z",
        cwd: repo,
        gitBranch: "feature/5-x",
        origin: { kind: "human" },
        message: { content: "x" },
      },
      msg("k1", "2026-10-01T18:20:00.000Z"),
      msg("k2", "2026-10-01T18:40:00.000Z"),
    ];
    writeFileSync(join(logDir, "s-ist.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
    expect(cli("collect").status).toBe(0);
    expect(cli("report").status).toBe(0);
    const usage = readFileSync(
      join(repo, ".agent-usage", "report", "20261001", "usage.csv"),
      "utf8",
    );
    // usage.csv は日付・人・エージェント・モデルでまとめる。10-02 の行は、このセッションの 18:40Z の応答（100 トークン）だけ
    const [header, ...body] = usage.trim().split("\n");
    const cols = (header ?? "").split(",");
    const oct2 = body
      .map((l) => l.split(","))
      .filter((c) => c[cols.indexOf("date")] === "2026-10-02");
    expect(oct2.map((c) => c[cols.indexOf("input_tokens")])).toEqual(["100"]);
  });

  test("区切り方が変わった記録済みの行は打ち消し、report は二重に数えない", () => {
    const { repo, git, cli, logDir } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const total = () => {
      expect(cli("report").status).toBe(0);
      const usage = readFileSync(
        join(repo, ".agent-usage", "report", "20261001", "usage.csv"),
        "utf8",
      );
      const [header, ...body] = usage.trim().split("\n");
      const col = (header ?? "").split(",").indexOf("input_tokens");
      return body.reduce((a, l) => a + Number(l.split(",")[col] ?? 0), 0);
    };
    const before = total();
    expect(before).toBeGreaterThan(0);
    // タイムゾーンを 30 分のオフセットに変えると、使用量の区切り（key）が変わる
    expect(cli("setup", "--time-zone", "Asia/Kolkata").status).toBe(0);
    const again = cli("collect");
    expect(again.stdout).toMatch(/打ち消した行（ログはあるが、今は作らなくなった行）: [1-9]/);
    expect(total()).toBe(before);
    // 打ち消し済みの行は、次の collect で打ち消しの行を書き足さない
    expect(cli("collect").stdout).not.toMatch(/打ち消した行/);
    // ログが消えたセッションの行は、作れないだけなので打ち消さない
    rmSync(join(logDir, "s1.jsonl"));
    expect(cli("collect").stdout).not.toMatch(/打ち消した行/);
    expect(total()).toBe(before);
  });

  test("引き継いだ側のセッションの指示・稼働の行は、元のセッションのログが見つかると打ち消す", () => {
    const { repo, git, cli, logDir, logLines } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    // 元のセッション（s1）のログが見えない間に、それをコピーして続けたセッション（s2）だけを記録する
    const original = join(logDir, "s1.jsonl");
    const aside = join(logDir, "..", "s1.jsonl.aside");
    renameSync(original, aside);
    const extra = [
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
    writeFileSync(
      join(logDir, "s2.jsonl"),
      [...logLines, ...extra].map((l) => JSON.stringify(l)).join("\n"),
    );
    expect(cli("collect").status).toBe(0);
    // 元のログが見つかると、コピーした範囲の s2 の行は作らなくなるので、打ち消す
    renameSync(aside, original);
    const again = cli("collect");
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/打ち消した行（ログはあるが、今は作らなくなった行）: [1-9]/);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const latest = new Map<string, Record<string, string>>();
    for (const f of readdirSync(branches))
      for (const r of parseCsv(readFileSync(join(branches, f), "utf8")))
        if (r.session === "s2") latest.set(r.key ?? "", r);
    const retractedKinds = new Set(
      [...latest.values()].filter((r) => r.retracted === "1").map((r) => r.kind),
    );
    expect(retractedKinds).toContain("prompt");
    expect(retractedKinds).toContain("run");
    // コピーの後の指示（10:20）の行は、s2 だけにあるので残す
    expect(
      [...latest.values()].some(
        (r) =>
          r.kind === "prompt" && r.start?.startsWith("2026-10-01T10:20") && r.retracted !== "1",
      ),
    ).toBe(true);
  });

  test("別名で記録した行と、observed_at が今より後の行も打ち消し、report は二重に数えない", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const total = () => {
      expect(cli("report").status).toBe(0);
      const usage = readFileSync(
        join(repo, ".agent-usage", "report", "20261001", "usage.csv"),
        "utf8",
      );
      const [header, ...body] = usage.trim().split("\n");
      const col = (header ?? "").split(",").indexOf("input_tokens");
      return body.reduce((a, l) => a + Number(l.split(",")[col] ?? 0), 0);
    };
    const before = total();
    expect(before).toBeGreaterThan(0);
    // 記録済みの行を、前の ID（別名）で、時計の進んだマシンが書いた形にする
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    for (const f of readdirSync(branches)) {
      const file = join(branches, f);
      const rows = parseCsv(readFileSync(file, "utf8")).map((r) => ({
        ...r,
        person: "p-00000001",
        observed_at: "2027-01-01T00:00:00Z",
      }));
      writeFileSync(file, toCsv([...COLUMNS], rows));
    }
    writeFileSync(
      join(repo, ".agent-usage", "config.json"),
      JSON.stringify({ aliases: { "p-00000001": person } }),
    );
    expect(total()).toBe(before);
    expect(cli("setup", "--time-zone", "Asia/Kolkata").status).toBe(0);
    const again = cli("collect");
    expect(again.stdout).toMatch(/打ち消した行（ログはあるが、今は作らなくなった行）: [1-9]/);
    expect(total()).toBe(before);
    // 打ち消しが反映されたので、次の collect で打ち消しの行を書き足さない
    expect(cli("collect").stdout).not.toMatch(/打ち消した行/);
  });

  test("サブエージェントのログしか残っていないセッションの行は、打ち消さない", () => {
    const { repo, git, cli, logDir } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    const sub = join(logDir, "s1", "subagents");
    mkdirSync(sub, { recursive: true });
    const line = {
      type: "assistant",
      timestamp: "2026-10-01T10:05:00.000Z",
      cwd: repo,
      message: {
        id: "sa1",
        model: "claude-opus-5-5",
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    };
    writeFileSync(join(sub, "agent-a.jsonl"), JSON.stringify(line));
    expect(cli("collect").status).toBe(0);
    // メインのログが消えると、指示・稼働・待ちの行は作れなくなるが、ログが消えただけなので打ち消さない
    rmSync(join(logDir, "s1.jsonl"));
    const again = cli("collect");
    expect(again.status).toBe(0);
    expect(again.stdout).not.toMatch(/打ち消した行/);
  });

  test("サブエージェントのログだけが消えたセッションの使用量は、区切り方が変わっても打ち消さない", () => {
    const { repo, git, cli, logDir } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    // メインのログがあるので、サブエージェントの応答はメインのセッションにまとめて数える（別のモデル・別の時間帯）
    const sub = join(logDir, "s1", "subagents");
    mkdirSync(sub, { recursive: true });
    const line = {
      type: "assistant",
      timestamp: "2026-10-01T11:05:00.000Z",
      cwd: repo,
      message: {
        id: "sa2",
        model: "claude-haiku-5-5",
        usage: { input_tokens: 7, output_tokens: 0 },
      },
    };
    writeFileSync(join(sub, "agent-b.jsonl"), JSON.stringify(line));
    expect(cli("collect").status).toBe(0);
    // サブエージェントのログだけが先に消えても、その使用量は打ち消さない（メインのログはある）
    rmSync(sub, { recursive: true });
    const again = cli("collect");
    expect(again.status).toBe(0);
    expect(again.stdout).not.toMatch(/打ち消した行/);
    // 区切り方が変わっても、作り直した使用量が減るモデル（ログの欠けたサブエージェントのモデル）の行は打ち消さず、
    // 前の区切りの行と重なる新しい行も書かない（両方を数えて二重にしない）
    const total = () => {
      expect(cli("report").status).toBe(0);
      const usage = readFileSync(
        join(repo, ".agent-usage", "report", "20261001", "usage.csv"),
        "utf8",
      );
      const [header, ...body] = usage.trim().split("\n");
      const col = (header ?? "").split(",").indexOf("input_tokens");
      return body.reduce((a, l) => a + Number(l.split(",")[col] ?? 0), 0);
    };
    const before = total();
    expect(cli("setup", "--time-zone", "Asia/Kolkata").status).toBe(0);
    expect(cli("collect").status).toBe(0);
    expect(total()).toBe(before);
    expect(cli("report").status).toBe(0);
    const usage = readFileSync(
      join(repo, ".agent-usage", "report", "20261001", "usage.csv"),
      "utf8",
    );
    expect(usage).toMatch(/claude-haiku-5-5/);
  });

  test("同じモデルのサブエージェントのログが消えた後に区切り方を変えても、重なる新しい行を書かず二重に数えない", () => {
    const { repo, git, cli, logDir } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    const sub = join(logDir, "s1", "subagents");
    mkdirSync(sub, { recursive: true });
    const line = {
      type: "assistant",
      timestamp: "2026-10-01T10:05:00.000Z",
      cwd: repo,
      message: {
        id: "sa3",
        model: "claude-opus-5-5",
        usage: { input_tokens: 7, output_tokens: 0 },
      },
    };
    writeFileSync(join(sub, "agent-c.jsonl"), JSON.stringify(line));
    expect(cli("collect").status).toBe(0);
    const total = () => {
      expect(cli("report").status).toBe(0);
      const usage = readFileSync(
        join(repo, ".agent-usage", "report", "20261001", "usage.csv"),
        "utf8",
      );
      const [header, ...body] = usage.trim().split("\n");
      const col = (header ?? "").split(",").indexOf("input_tokens");
      return body.reduce((a, l) => a + Number(l.split(",")[col] ?? 0), 0);
    };
    const before = total();
    // メインと同じモデルの使用量が減るので、前の区切りの行は打ち消さず、それと重なる新しい区切りの行も書かない
    rmSync(sub, { recursive: true });
    expect(cli("setup", "--time-zone", "Asia/Kolkata").status).toBe(0);
    const again = cli("collect");
    expect(again.status).toBe(0);
    expect(again.stdout).not.toMatch(/打ち消した行/);
    expect(total()).toBe(before);
  });

  test("打ち消しの列が空でも 1 でもない記録は、読むときに失敗にする", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const [name] = readdirSync(branches);
    const file = join(branches, name ?? "");
    const [header, first, ...rest] = readFileSync(file, "utf8").trim().split("\n");
    writeFileSync(
      file,
      `${[header, `${(first ?? "").replace(/,$/, "")},true`, ...rest].join("\n")}\n`,
    );
    const r = cli("report");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/retracted が空でも 1 でもない/);
  });

  test("開始時刻が範囲より古い行は、区切り方が変わっても打ち消さず、使用量を残す", () => {
    const { repo, git, cli, logDir, logLines } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    // 範囲（60 日）より古いセッション。初めての collect なので書く
    const old = logLines.map((l) => ({
      ...l,
      timestamp: l.timestamp.replace("2026-10-01", "2026-07-01"),
      ...(l.message && "id" in l.message
        ? { message: { ...l.message, id: `old-${l.message.id}` } }
        : {}),
    }));
    writeFileSync(join(logDir, "s-old.jsonl"), old.map((l) => JSON.stringify(l)).join("\n"));
    expect(cli("collect").status).toBe(0);
    const tokens = () => {
      expect(cli("report", "--since", "2026-06-01").status).toBe(0);
      const dir = join(repo, ".agent-usage", "report");
      const day = readdirSync(dir)[0] ?? "";
      const usage = readFileSync(join(dir, day, "usage.csv"), "utf8");
      const [header, ...body] = usage.trim().split("\n");
      const cols = (header ?? "").split(",");
      return body
        .map((l) => l.split(","))
        .filter((c) => (c[cols.indexOf("date")] ?? "").startsWith("2026-07"))
        .reduce((a, c) => a + Number(c[cols.indexOf("input_tokens")] ?? 0), 0);
    };
    const before = tokens();
    expect(before).toBeGreaterThan(0);
    // 区切り方を変えても、範囲より古い行は書き直さないので、打ち消さない
    expect(cli("setup", "--time-zone", "Asia/Kolkata").status).toBe(0);
    expect(cli("collect").status).toBe(0);
    expect(tokens()).toBe(before);
  });

  test("打ち消しの列が無い古い記録も読み、report は同じ値を出す", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const out = join(repo, ".agent-usage", "report", "20261001");
    expect(cli("report").status).toBe(0);
    const baseline = readFileSync(join(out, "usage.csv"), "utf8");
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const [name] = readdirSync(branches);
    // 最後の列（retracted）を除いた、前の版の形にする
    const text = readFileSync(join(branches, name ?? ""), "utf8");
    const old = text
      .trim()
      .split("\n")
      .map((l) => l.replace(/,[^,]*$/, ""))
      .join("\n");
    expect(old.split("\n")[0]).not.toMatch(/retracted/);
    writeFileSync(join(branches, name ?? ""), `${old}\n`);
    expect(cli("report").status).toBe(0);
    expect(readFileSync(join(out, "usage.csv"), "utf8")).toBe(baseline);
  });

  test.each([
    ["UTC", "2026-10-01T18:40:00Z", "2026-10-01T18:00:00.000Z"],
    ["Asia/Tokyo", "2026-10-01T18:40:00Z", "2026-10-01T18:00:00.000Z"],
    ["Asia/Kolkata", "2026-10-01T18:40:00Z", "2026-10-01T18:30:00.000Z"],
    ["Asia/Kolkata", "2026-10-01T18:20:00Z", "2026-10-01T17:30:00.000Z"],
    ["Asia/Kathmandu", "2026-10-01T18:20:00Z", "2026-10-01T18:15:00.000Z"],
    // 夏時間の終わり: 01 時が 2 回ある。2 回目の 01:40 EST（06:40Z）は、2 回目の 01:00 EST（06:00Z）から
    ["America/New_York", "2026-11-01T05:40:00Z", "2026-11-01T05:00:00.000Z"],
    ["America/New_York", "2026-11-01T06:40:00Z", "2026-11-01T06:00:00.000Z"],
  ])("localHourStart %s %s → %s", (tz, at, expected) => {
    expect(new Date(localHourStart(Date.parse(at), tz)).toISOString()).toBe(expected);
  });

  test("origin が GitHub でなければ、GitHub を取得しない", () => {
    const { git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("remote", "add", "origin", "https://gitlab.com/group/sub/repo.git");
    git("switch", "-q", "-c", "feature/5-x");
    const sub = cli("collect");
    expect(sub.status).toBe(0);
    expect(sub.stdout).toMatch(/GitHub: 取得していない（.*の形でない）/);
    git("remote", "set-url", "origin", "https://gitlab.com/owner/repo.git");
    const flat = cli("collect");
    expect(flat.status).toBe(0);
    expect(flat.stdout).toMatch(/GitHub: 取得していない（origin のホスト gitlab\.com は/);
    expect(flat.stdout).toMatch(/gh auth login --hostname gitlab\.com/);
    expect(cli("collect", "--no-github").stdout).toMatch(/GitHub: 取得していない（--no-github）/);
  });

  test("ログインで GitHub と判定したホストには、環境変数の GH_ENTERPRISE_TOKEN を送らない", () => {
    const { tmp, git, cli, cliWith } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("remote", "add", "origin", "https://ghe.invalid/example-org/example-repo.git");
    git("switch", "-q", "-c", "feature/5-x");
    // 偽の gh: auth token は成功し、api は受け取った GH_ENTERPRISE_TOKEN を記録して失敗する
    const bin = join(tmp, "bin");
    mkdirSync(bin, { recursive: true });
    const log = join(tmp, "gh-token.log");
    writeFileSync(
      join(bin, "gh"),
      // 保存した token の印（GH_LOGGED_IN）か環境変数の token があれば、auth token は成功する（実物の gh と同じ）
      '#!/bin/sh\nif [ "$1" = auth ]; then\n  if [ -f "$GH_LOGGED_IN" ] || [ -n "${GH_ENTERPRISE_TOKEN-}${GH_TOKEN-}" ]; then exit 0; fi\n  echo "no oauth token" >&2; exit 1\nfi\nprintf "[%s%s]" "${GH_ENTERPRISE_TOKEN-}" "${GH_TOKEN-}" >> "$GH_LOG"\necho fail >&2\nexit 1\n',
      { mode: 0o755 },
    );
    const path = `${bin}:${process.env.PATH ?? ""}`;
    const marker = join(tmp, "logged-in");
    const base = { PATH: path, GH_LOG: log, GH_LOGGED_IN: marker, GH_ENTERPRISE_TOKEN: "secret" };
    // 環境変数の token だけでは、ログインとして数えない
    const envOnly = cliWith({ ...base, GH_TOKEN: "t" }, "collect");
    expect(envOnly.stdout).toMatch(/GitHub: 取得していない（.*no oauth token/);
    writeFileSync(marker, "");
    const viaLogin = cliWith({ ...base, GH_TOKEN: "t" }, "collect");
    expect(viaLogin.stdout).not.toMatch(/GitHub: 取得していない/);
    expect(readFileSync(log, "utf8")).toMatch(/^(\[\])+$/);
    // GH_HOST で指定したホストには、これまでどおり環境変数の token で問い合わせる
    writeFileSync(log, "");
    cliWith({ ...base, GH_HOST: "ghe.invalid" }, "collect");
    expect(readFileSync(log, "utf8")).toMatch(/^(\[secret\])+$/);
    // auth token を持たない古い gh では、更新が要ることを理由に出す
    writeFileSync(
      join(bin, "gh"),
      '#!/bin/sh\necho \'unknown command "token" for "gh auth"\' >&2\nexit 1\n',
      {
        mode: 0o755,
      },
    );
    const old = cliWith({ PATH: path }, "collect");
    expect(old.stdout).toMatch(/GitHub: 取得していない（.*gh を更新する/);
  });

  // githubTarget の reason は、collect が出す「GitHub: 取得していない（…）」の理由になる。
  test.each([
    ["origin が無い", "", {}, "", "origin が無い", false],
    ["owner/name の形でない", "gitlab.com/group/sub/repo", {}, "", "の形でない", false],
    [
      "ポート付きでログインしていなければ取得しない",
      "ghe.invalid:7999/o/r",
      {},
      "x",
      "ポートを含み",
      false,
    ],
    ["ポート付きでもログインしていれば取得する", "ghe.invalid:8443/o/r", {}, "", "", true],
    [
      "ポート付きでも GH_HOST と一致すれば扱う",
      "ghe.invalid:8443/o/r",
      { GH_HOST: "ghe.invalid:8443" },
      "x",
      "",
      false,
    ],
    ["github.com はログインを確かめない", "github.com/o/r", {}, "x", "", false],
    [
      "GH_HOST は大文字小文字を区別せずログインを確かめない",
      "ghe.invalid/o/r",
      { GH_HOST: "GHE.invalid" },
      "x",
      "",
      false,
    ],
    ["ログインしたホストは viaLogin", "ghe.invalid/o/r", {}, "", "", true],
    [
      "ログインしていないホストは理由を返す",
      "gitlab.com/o/r",
      {},
      "gh auth token が失敗した",
      "gh auth token が失敗した",
      false,
    ],
  ])("githubTarget: %s", (_case, remote, env, loginError, reason, viaLogin) => {
    const t = githubTarget(remote, env, () => loginError);
    if (reason === "") expect(t.reason).toBe("");
    else expect(t.reason).toContain(reason);
    expect(t.viaLogin).toBe(viaLogin);
    if (reason === "") expect(t.slug).toBe(remote.split("/").slice(1).join("/"));
  });

  // 取得した期間の coverage の行は、停止の分類に使う段がすべて取れたときだけ ok にする。
  // 課金 API と artifact の失敗は費用の行が欠けるだけなので、その期間を判定不能（ok でない）にしない。
  // 課金 API と artifact を数えない分岐は、aggregate.test.ts の classifyingFailuresOf のテストが確かめる。
  test("collect の coverage: Actions の run の取得も失敗したら、その段だけを挙げて判定不能にする", () => {
    const { tmp, repo, git, cli, cliWith } = setup();
    expect(cli("setup", "--time-zone", "UTC", "--billing", "user").status).toBe(0);
    git("remote", "add", "origin", "https://github.com/example-org/example-repo.git");
    git("switch", "-q", "-c", "feature/5-x");
    // 偽の gh: 自分の login・PR・Actions の run は空の結果を返し、artifact と課金 API は失敗する
    const bin = join(tmp, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        'case "$*" in',
        '  "api user") echo \'{"login":"me"}\' ;;',
        '  *graphql*) echo \'[{"data":{"search":{"nodes":[]}}}]\' ;;',
        '  *actions/artifacts*) echo "artifacts: HTTP 500" >&2; exit 1 ;;',
        '  *billing*) echo "billing: HTTP 404" >&2; exit 1 ;;',
        '  *actions/runs*) if [ -n "$FAIL_RUNS" ]; then echo "runs: HTTP 502" >&2; exit 1; fi; echo \'[{"workflow_runs":[]}]\' ;;',
        '  *) echo "unexpected: $*" >&2; exit 1 ;;',
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const r = cliWith({ PATH: `${bin}:${process.env.PATH ?? ""}`, FAIL_RUNS: "runs" }, "collect");
    expect(r.status, r.stderr).toBe(0);
    // 失敗した段は、coverage の判定に使わなくても collect の出力に出す
    expect(r.stdout).toMatch(/artifacts/);
    expect(r.stdout).toMatch(/billing/);
    const dir = join(repo, ".agent-usage", "records", "_github");
    const rows = readdirSync(dir).flatMap((p) =>
      readdirSync(join(dir, p)).flatMap((f) => parseCsv(readFileSync(join(dir, p, f), "utf8"))),
    );
    const coverage = rows.filter((row) => row.kind === "coverage");
    expect(coverage).toHaveLength(1);
    expect(coverage[0]?.detail).toMatch(/^failed:actions\/runs: /);
    expect(coverage[0]?.detail).not.toMatch(/billing|artifacts/);
  });

  test("ポートを含み、gh にログインしていないホストの origin は、理由を出して取得しない", () => {
    const { git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("remote", "add", "origin", "ssh://git@ghe.invalid:7999/example-org/example-repo.git");
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").stdout).toMatch(/GitHub: 取得していない（.*ポートを含み/);
  });

  test("Hook の collect も、GitHub を取得しなかった理由を出す", () => {
    const { git, cli, gate } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("remote", "add", "origin", "https://gitlab.com/owner/repo.git");
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect", "--stage").status).toBe(0);
    const r = gate("git commit -m x");
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/GitHub は取得していない: origin のホスト gitlab\.com は/);
  });

  test("gate は、確認の処理の誤り（不正な AGENT_USAGE_NOW）ではコミットを止めない", () => {
    const { repo, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    const r = spawnSync("node", [CLI, "gate", "--agent", "claude-code"], {
      cwd: repo,
      env: { ...process.env, AGENT_USAGE_NOW: "not-a-time" },
      encoding: "utf8",
      input: JSON.stringify({ cwd: repo, tool_input: { command: "git commit -m x" } }),
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/確認をせずに通します/);
  });

  test("知らない引数と値の無い引数は、使い方を出して 2 で止める", () => {
    const { cli } = setup();
    const bad = cli("collect", "--nope");
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/^usage: /m);
    expect(cli("report", "--since").status).toBe(2);
    expect(cli("unknown").status).toBe(2);
  });
});

// コマンドの入力の誤りと、表示する状態（SKILL.md の status・setup・decline）。
describe("agent-usage のコマンドの入力と状態", () => {
  test("status は、セットアップの有無・ブランチ・判断・人の設定を表示する", () => {
    const { tmp, git, cli } = setup();
    const before = cli("status");
    expect(before.status).toBe(0);
    expect(before.stdout).toMatch(/^セットアップ: 未（.*\.agent-usage）$/m);
    expect(before.stdout).toMatch(/^ブランチ: main \/ デフォルトブランチ: \(不明\)$/m);
    // setup の前なので、デフォルトブランチかより先に、.agent-usage/ が無いことを理由に出す（Hook と同じ順）
    expect(before.stdout).toMatch(/^このブランチの判断: 対象外（\.agent-usage\/ が無い/m);
    expect(before.stdout).toMatch(/^人の設定: \(無い\)$/m);
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    // origin/HEAD があれば、それをデフォルトブランチとして表示する
    const origin = join(tmp, "origin.git");
    expect(
      spawnSync("git", ["init", "-q", "--bare", "-b", "trunk", origin], { timeout: 30_000 }).status,
    ).toBe(0);
    git("remote", "add", "origin", origin);
    git("push", "-q", "origin", "HEAD:trunk");
    git("remote", "set-head", "origin", "trunk");
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("decline").status).toBe(0);
    const after = cli("status");
    expect(after.stdout).toMatch(/^セットアップ: 済み/m);
    expect(after.stdout).toMatch(/^ブランチ: feature\/5-x \/ デフォルトブランチ: trunk$/m);
    expect(after.stdout).toMatch(/^このブランチの判断: decline$/m);
    expect(after.stdout).toMatch(/^人の設定: .*"timeZone": "UTC"/m);
    git("switch", "-q", "--detach");
    const detached = cli("status");
    expect(detached.stdout).toMatch(/^ブランチ: \(detached\) /m);
    expect(detached.stdout).toMatch(/^このブランチの判断: -$/m);
  });

  test("origin/HEAD のデフォルトブランチでは、main 以外の名前でもコミットを止めない", () => {
    const { tmp, git, cli, gate } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    const origin = join(tmp, "origin.git");
    expect(
      spawnSync("git", ["init", "-q", "--bare", "-b", "trunk", origin], { timeout: 30_000 }).status,
    ).toBe(0);
    git("remote", "add", "origin", origin);
    git("switch", "-q", "-c", "trunk");
    git("push", "-q", "origin", "trunk");
    git("remote", "set-head", "origin", "trunk");
    expect(gate("git commit -m x").status).toBe(0);
    // origin/HEAD が分かるときは、main もデフォルトブランチとして扱わない
    git("switch", "-q", "main");
    expect(gate("git commit -m x").status).toBe(2);
  });

  test.each([
    [
      "人の ID の形が違う",
      ["setup", "--person-id", "p-xyz"],
      /--person-id は p- と 16 進数 8 桁の形にする/,
    ],
    [
      "タイムゾーンが IANA の名前でない",
      ["setup", "--time-zone", "Mars/Olympus"],
      /--time-zone は IANA のタイムゾーンの名前にする/,
    ],
    [
      "同じ引数が 2 回ある",
      ["setup", "--time-zone", "UTC", "--time-zone", "UTC"],
      /--time-zone が 2 回ある/,
    ],
  ])("setup は、%s なら使い方を出して 2 で止める", (_case, args, message) => {
    const { cli } = setup();
    const r = cli(...args);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(message);
    expect(r.stderr).toMatch(/^usage: /m);
  });

  test("decline は、detached HEAD では判断を記録せずに失敗する", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "--detach");
    const r = cli("decline");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ブランチの上にいない（detached HEAD）/);
    expect(existsSync(join(repo, ".git", "agent-usage", "decisions.json"))).toBe(false);
  });

  test("detached HEAD の collect --stage は、detached の名前のファイルに書き、判断は記録しない", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "--detach");
    const r = cli("collect", "--stage");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/書いた: .*\/branches\/\d{8}T\d{6}Z-detached\.csv$/m);
    expect(existsSync(join(repo, ".git", "agent-usage", "decisions.json"))).toBe(false);
  });

  test("collect は、人の設定が無ければ作ったことと、読めなかったログの行の数を出す", () => {
    const { tmp, git, cli, logDir, logLines } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    rmSync(join(tmp, "user"), { recursive: true });
    writeFileSync(
      join(logDir, "s1.jsonl"),
      [...logLines.map((l) => JSON.stringify(l)), "{ not json"].join("\n"),
    );
    const r = cli("collect");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^人の ID を作った: p-[0-9a-f]{8}（/m);
    expect(r.stdout).toMatch(/^読めなかったログの行: 1$/m);
  });

  test.each([
    ["JSON として読めない", () => "{ not json"],
    ["人の時刻が文字列でない", (person: string) => JSON.stringify({ [person]: 1 })],
  ])(
    "last-collect.json が%sなら、範囲の中で collect していないとして扱い、範囲より古いログの行も書いて作り直す",
    (_case, broken) => {
      const { repo, git, cli, logDir, logLines } = setup();
      expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
      git("switch", "-q", "-c", "feature/5-x");
      expect(cli("collect").status).toBe(0);
      // 範囲（60 日）より古いセッションのログを足す
      const old = logLines.map((l) => ({
        ...l,
        timestamp: l.timestamp.replace("2026-10-01", "2026-07-01"),
        ...(l.message && "id" in l.message
          ? { message: { ...l.message, id: `old-${l.message.id}` } }
          : {}),
      }));
      writeFileSync(join(logDir, "s-old.jsonl"), old.map((l) => JSON.stringify(l)).join("\n"));
      const records = join(repo, ".agent-usage", "records");
      const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
      const last = join(repo, ".git", "agent-usage", "last-collect.json");
      writeFileSync(last, broken(person));
      const r = cli("collect");
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).not.toMatch(/開始時刻が範囲より古いので書かなかった行/);
      const branches = join(records, person, "branches");
      const text = readdirSync(branches)
        .map((f) => readFileSync(join(branches, f), "utf8"))
        .join("");
      expect(text).toContain("usage:claude-code:s-old:");
      // 作り直した last-collect.json には、この人の時刻がある
      expect(JSON.parse(readFileSync(last, "utf8"))).toEqual({
        [person]: "2026-10-01T12:00:00.000Z",
      });
    },
  );

  test("GitHub を前に取得した期間があれば、その終わりから 1 日さかのぼって取得する", () => {
    const { tmp, repo, git, cli, cliWith } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("remote", "add", "origin", "https://github.com/example-org/example-repo.git");
    git("switch", "-q", "-c", "feature/5-x");
    const bin = join(tmp, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        'case "$*" in',
        '  "api user") echo \'{"login":"me"}\' ;;',
        '  *graphql*) echo \'[{"data":{"search":{"nodes":[]}}}]\' ;;',
        "  *actions/runs*) echo '[{\"workflow_runs\":[]}]' ;;",
        "  *actions/artifacts*) echo '[{\"artifacts\":[]}]' ;;",
        '  *) echo "unexpected: $*" >&2; exit 1 ;;',
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const path = `${bin}:${process.env.PATH ?? ""}`;
    expect(cliWith({ PATH: path }, "collect").status).toBe(0);
    const second = cliWith({ PATH: path, AGENT_USAGE_NOW: "2026-10-03T12:00:00Z" }, "collect");
    expect(second.status).toBe(0);
    const dir = join(repo, ".agent-usage", "records", "_github");
    const coverage = readdirSync(dir)
      .flatMap((p) =>
        readdirSync(join(dir, p)).flatMap((f) => parseCsv(readFileSync(join(dir, p, f), "utf8"))),
      )
      .filter((r) => r.kind === "coverage")
      .map((r) => [r.start, r.end, r.detail]);
    // 1 回目はローカルの行の最初の時刻（10:00）から、2 回目は前回の終わり（10-01 12:00）の 1 日前から取得する
    expect(coverage).toEqual([
      ["2026-10-01T10:00:00.000Z", "2026-10-01T12:00:00.000Z", "ok"],
      ["2026-09-30T12:00:00.000Z", "2026-10-03T12:00:00.000Z", "ok"],
    ]);
  });

  test.each([
    ["gh が無い", "", /gh を起動できない: /],
    [
      "gh auth token が理由を出さずに失敗する",
      "#!/bin/sh\nexit 3\n",
      /gh auth token が失敗した: exit 3/,
    ],
  ])("ログインを確かめられないホストは、%s 理由を出して取得しない", (_case, script, reason) => {
    const { tmp, git, cli, cliWith } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("remote", "add", "origin", "https://ghe.invalid/o/r.git");
    git("switch", "-q", "-c", "feature/5-x");
    // PATH には collect が使う node と git だけを置き、gh は置かない（置くなら偽物）
    const bin = join(tmp, "bin");
    mkdirSync(bin, { recursive: true });
    for (const tool of ["node", "git"]) {
      const real = spawnSync("bash", ["-c", `command -v ${tool}`], {
        encoding: "utf8",
        timeout: 30_000,
      }).stdout.trim();
      expect(real).not.toBe("");
      symlinkSync(real, join(bin, tool));
    }
    if (script !== "") writeFileSync(join(bin, "gh"), script, { mode: 0o755 });
    const r = cliWith({ PATH: bin }, "collect");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/GitHub: 取得していない（origin のホスト ghe\.invalid は/);
    expect(r.stdout).toMatch(reason);
  });
});

// precommit-gate.sh が、確認の処理を実行できないときにコミットを止めないこと（スクリプトの冒頭の取り決め）。
describe("precommit-gate.sh の、確認を実行できないとき", () => {
  const input = JSON.stringify({ cwd: "/tmp", tool_input: { command: "git commit -m x" } });
  const bash = spawnSync("bash", ["-c", "command -v bash"], {
    encoding: "utf8",
    timeout: 30_000,
  }).stdout.trim();
  /** precommit-gate.sh をコピーしたディレクトリ（同梱の agent-usage.mjs を置き換えられる）。 */
  function copied(mjs: string | null) {
    const dir = makeTempDir("agent-usage-gate-");
    writeFileSync(join(dir, "precommit-gate.sh"), readFileSync(GATE, "utf8"));
    if (mjs !== null) writeFileSync(join(dir, "agent-usage.mjs"), mjs);
    return join(dir, "precommit-gate.sh");
  }
  const run = (script: string, env: NodeJS.ProcessEnv, stdin = input) =>
    spawnSync(bash, [script, "claude-code"], {
      encoding: "utf8",
      input: stdin,
      env: { ...env, ...coverageEnv() },
      timeout: 30_000,
    });

  test("git commit を含まない入力は、同梱の agent-usage.mjs が無くても何も出さずに通す", () => {
    const r = run(
      copied(null),
      { PATH: process.env.PATH ?? "" },
      JSON.stringify({ tool_input: { command: "git status" } }),
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("同梱の agent-usage.mjs を読めなければ、確認をせずに通す", () => {
    const r = run(copied(null), { PATH: process.env.PATH ?? "" });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/同梱の agent-usage\.mjs を読めないので、確認をせずに通します/);
  });

  test("node が無ければ、確認をせずに通す", () => {
    const bin = makeTempDir("agent-usage-nonode-");
    const dirname = spawnSync("bash", ["-c", "command -v dirname"], {
      encoding: "utf8",
      timeout: 30_000,
    }).stdout.trim();
    symlinkSync(dirname, join(bin, "dirname"));
    const r = run(copied("process.exit(2);\n"), { PATH: bin });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/node が無いので、確認をせずに通します/);
  });

  test.each([
    [0, 0, false],
    [2, 2, false],
    [3, 0, true],
  ])(
    "確認の処理が %i で終わったら %i で終わる（0 と 2 以外では止めない）",
    (code, expected, warned) => {
      const r = run(copied(`process.exit(${code});\n`), { PATH: process.env.PATH ?? "" });
      expect(r.status).toBe(expected);
      if (warned)
        expect(r.stderr).toContain(
          `確認の処理が失敗しました（exit ${code}）。コミットは止めません`,
        );
      else expect(r.stderr).toBe("");
    },
  );
});

// 範囲より古い時刻の名前を持つブランチのファイルは、最後の行の observed_at も範囲より古いときだけ読まない。
// 最後の行を判定できない形（次の表）なら、ファイル全体を読む。読んだことは、同じ key の行を別のブランチで書き直さないことで確かめる。
// 範囲の中の最後の行を読む形は「名前の時刻が範囲より古くても…」が、範囲より古い最後の行で読まない形は
// 「collect は範囲より古いファイルを読まず…」が確かめる。
describe("読む範囲の判定で、最後の行を判定できないブランチのファイル", () => {
  const OLD = "2026-07-01T00:00:00.000Z";
  /** 記録済みのファイルを範囲より古い時刻のファイルにして末尾に tail を足し、別のブランチに移る。 */
  function prepare(tail: string) {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    const branches = join(records, person, "branches");
    const [name] = readdirSync(branches);
    const text = readFileSync(join(branches, name ?? ""), "utf8").replaceAll(
      "2026-10-01T12:00:00.000Z",
      OLD,
    );
    rmSync(join(branches, name ?? ""));
    const old = join(branches, "20260701T000000Z-feature-5-x.csv");
    writeFileSync(old, `${text}${tail}`);
    git("switch", "-q", "-c", "feature/6-y");
    git("commit", "-q", "--allow-empty", "-m", "work");
    const written = () =>
      readdirSync(branches)
        .filter((f) => f.endsWith("-feature-6-y.csv"))
        .map((f) => readFileSync(join(branches, f), "utf8"))
        .join("");
    return { cli, old, written };
  }
  /**
   * COLUMNS の順の 1 行（見出しを除き、改行で終える）。toCsv は改行で終えるので、改行を足さない。
   * 足すとファイルの最後の行が空になり、どの形も「最後の行が空」として判定されて、形ごとの分岐に届かない。
   */
  const line = (row: Record<string, string>) =>
    toCsv([...COLUMNS], [row]).slice(COLUMNS.join(",").length + 1);

  test.each([
    [
      "最後の行が末尾の読み取りに収まらない",
      line({ key: "x:long", kind: "coverage", observed_at: OLD, detail: "x".repeat(40000) }),
    ],
    [
      "最後の行が引用符の中の改行で分かれている",
      line({ key: "x:nl", kind: "coverage", observed_at: OLD, detail: "x\ny" }),
    ],
    [
      // 物理的な最後の行は「b,c,」の後に範囲より古い日時が続き、範囲より古い observed_at を持つ行に見える
      "最後の行が、改行を含む値の途中に見える",
      line({
        key: "x:mid",
        kind: "coverage",
        observed_at: OLD,
        person: "a\nb,c,2025-01-01T00:00:00.000Z,d",
      }),
    ],
  ])("%s なら、ファイル全体を読む", (_case, tail) => {
    const { cli, written } = prepare(tail);
    const r = cli("collect");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/範囲より古いので読まなかった/);
    expect(written()).not.toContain("usage:claude-code:s1:");
  });

  test("見出しだけのファイルも読む（読まなかったファイルとして数えない）", () => {
    const { repo, git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").status).toBe(0);
    const records = join(repo, ".agent-usage", "records");
    const person = readdirSync(records).find((d) => d.startsWith("p-")) ?? "";
    writeFileSync(
      join(records, person, "branches", "20260701T000000Z-feature-4-w.csv"),
      `${COLUMNS.join(",")}\n`,
    );
    const r = cli("collect");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/範囲より古いので読まなかった/);
  });

  test("最後の行の observed_at が時刻でなければ、ファイル全体を読んでその行をエラーにする", () => {
    const { cli } = prepare(line({ key: "x:bad", kind: "coverage", observed_at: "nope" }));
    const r = cli("collect");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/20260701T000000Z-feature-5-x\.csv:\d+: observed_at が時刻でない/);
  });

  // root は読み取りの権限が無くてもファイルを開けるので、開けないファイルを作れない
  test.skipIf(process.getuid?.() === 0)(
    "開けないファイルは、読まなかったことにせずエラーにする",
    () => {
      const { cli, old } = prepare("");
      chmodSync(old, 0o000);
      const r = cli("collect");
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/EACCES/);
    },
  );
});

// retractableRows の rows は、collect が記録のファイルに書く打ち消しの行になる（withheld は書かない行の key）。
describe("retractableRows", () => {
  const W = Date.parse("2026-10-01T10:20:00Z");
  const canonical = (p: string | undefined) => p ?? "";
  const usage = (start: string, end: string, tz: string, input: number) => ({
    key: `usage:claude-code:s1:claude-opus-5-5:${start}`,
    kind: "usage",
    person: "p-1",
    agent: "claude-code",
    session: "s1",
    model: "claude-opus-5-5",
    start,
    end,
    tz,
    input_tokens: String(input),
  });
  const byKey = (rows: { key: string }[]) => new Map(rows.map((r) => [r.key, r]));

  test("範囲の下限より前に始まる前の区切りの行があるまとまりは打ち消さず、重なる新しい行を書かない", () => {
    const o1 = usage("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z", "UTC", 10);
    const o2 = usage("2026-10-01T11:00:00Z", "2026-10-01T12:00:00Z", "UTC", 10);
    const n1 = usage("2026-10-01T09:30:00Z", "2026-10-01T10:30:00Z", "Asia/Kolkata", 5);
    const n2 = usage("2026-10-01T10:30:00Z", "2026-10-01T11:30:00Z", "Asia/Kolkata", 10);
    const n3 = usage("2026-10-01T11:30:00Z", "2026-10-01T12:30:00Z", "Asia/Kolkata", 5);
    const { rows, withheld } = retractableRows([o1, o2], byKey([o1, o2]), byKey([n1, n2, n3]), {
      person: "p-1",
      lowerBound: W,
      canonical,
    });
    expect(rows).toEqual([]);
    expect([...withheld].sort()).toEqual([n1.key, n2.key, n3.key]);
  });

  test("指示・稼働・cost-state の使用量は、範囲の中に始まる行だけを打ち消す", () => {
    const run = (start: string) => ({
      key: `run:claude-code:s2:${start}`,
      kind: "run",
      person: "p-1",
      agent: "claude-code",
      session: "s2",
      start,
      end: start,
    });
    const inside = run("2026-10-01T10:20:00Z");
    const before = run("2026-10-01T10:19:59Z");
    const cost = {
      ...usage("2026-10-01T11:00:00Z", "2026-10-01T12:00:00Z", "UTC", 1),
      detail: "cost-state",
    };
    // 範囲の前の cost-state の行は、作り直す行が無くても打ち消さない（使用量のまとまりとして扱わない）
    const costBefore = {
      ...usage("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z", "UTC", 1),
      key: "usage:claude-code:s1:claude-haiku-5-5:cost-state",
      model: "claude-haiku-5-5",
      detail: "cost-state",
    };
    const { rows } = retractableRows(
      [inside, before, cost, costBefore],
      byKey([inside, before, cost, costBefore]),
      new Map(),
      { person: "p-1", lowerBound: W, canonical },
    );
    expect(rows.map((r) => r.key)).toEqual([inside.key, cost.key]);
  });
});
