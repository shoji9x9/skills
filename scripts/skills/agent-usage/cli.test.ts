// agent-usage のコマンド（agent-usage.mjs）とコミット前の Hook（precommit-gate.sh）を、使い捨てのリポジトリで通しで確かめる。
// GitHub には問い合わせない（使い捨てのリポジトリは origin を持たないので、collect は GitHub を取得しない）。
//
// 入力の軸（Hook）:
//   コマンド       git commit を含まない／含む（`git -C x commit`・行の継続を含む）。
//   リポジトリ     .agent-usage/ が無い／ある。
//   ブランチ       デフォルトブランチ（origin/HEAD が無ければ main・master）／それ以外。
//   判断           未決定（止める）／記録しない（通す）／記録する（collect して stage し、通す）。

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { commitCwd, isGitCommit } from "../../../skills/agent-usage/scripts/lib/gate.mjs";
import { parseCsv, toCsv } from "../../../skills/agent-usage/scripts/lib/csv.mjs";
import { encodeProjectPath } from "../../../skills/agent-usage/scripts/lib/discover.mjs";
import { COLUMNS } from "../../../skills/agent-usage/scripts/lib/rows.mjs";
import { githubTarget } from "../../../skills/agent-usage/scripts/lib/run-collect.mjs";
import { branchLabel, lastObservedAt } from "../../../skills/agent-usage/scripts/lib/records.mjs";
import { makeTempDir } from "../../lib/test-tmpdir.ts";

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
    spawnSync("git", ["init", "-q", "--bare", origin]);
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
    spawnSync("git", ["init", "-q", "--bare", origin]);
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

describe("lastObservedAt（読む範囲の判定に使う、最後の行の observed_at）", () => {
  const write = (text: string) => {
    const f = join(makeTempDir("agent-usage-tail-"), "20260701T000000Z-x.csv");
    writeFileSync(f, text);
    return f;
  };
  const header = "key,kind,observed_at,detail\n";
  test("開けないファイルは null を返す", () => {
    expect(lastObservedAt(join(makeTempDir("agent-usage-tail-"), "missing.csv"))).toBeNull();
  });
  test("最後の行の observed_at を返す", () => {
    const f = write(
      `${header}a,usage,2026-07-01T00:00:00.000Z,\nb,usage,2026-09-30T00:00:00.000Z,\n`,
    );
    expect(lastObservedAt(f)).toBe(Date.parse("2026-09-30T00:00:00.000Z"));
  });
  test.each([
    ["見出しだけ", header],
    [
      "最後の行が末尾の読み取りに収まらない",
      `${header}a,usage,2026-09-30T00:00:00.000Z,${"x".repeat(40000)}\n`,
    ],
    [
      "最後の行が引用符の中の改行で分かれている",
      `${header}a,usage,2026-09-30T00:00:00.000Z,"x\ny"\n`,
    ],
    [
      "最後の行が、改行を含む値の途中に見える",
      `${header}k2,usage,2026-10-01T00:00:00.000Z,"a\nb,c,2025-01-01T00:00:00.000Z,d"\n`,
    ],
    ["observed_at が時刻でない", `${header}a,usage,nope,\n`],
  ])("判定できなければ null を返す（呼び出し側はファイル全体を読む）: %s", (_case, text) => {
    expect(lastObservedAt(write(text))).toBeNull();
  });
});
