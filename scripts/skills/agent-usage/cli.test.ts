// agent-usage のコマンド（agent-usage.mjs）とコミット前の Hook（precommit-gate.sh）を、使い捨てのリポジトリで通しで確かめる。
// GitHub には問い合わせない（使い捨てのリポジトリは origin を持たないので、collect は GitHub を取得しない）。
//
// 入力の軸（Hook）:
//   コマンド       git commit を含まない／含む（`git -C x commit`・行の継続を含む）。
//   リポジトリ     .agent-usage/ が無い／ある。
//   ブランチ       デフォルトブランチ（origin/HEAD が無ければ main・master）／それ以外。
//   判断           未決定（止める）／記録しない（通す）／記録する（collect して stage し、通す）。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { commitCwd, isGitCommit } from "../../../skills/agent-usage/scripts/lib/gate.mjs";
import { encodeProjectPath } from "../../../skills/agent-usage/scripts/lib/discover.mjs";
import { githubTarget } from "../../../skills/agent-usage/scripts/lib/run-collect.mjs";
import { makeTempDir } from "../../lib/test-tmpdir.ts";

const SCRIPTS = join(import.meta.dirname, "../../../skills/agent-usage/scripts");
const HAS_GH = spawnSync("gh", ["--version"], { stdio: "ignore" }).status === 0;
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
  const cli = (...args: string[]) =>
    spawnSync("node", [CLI, ...args], { cwd: repo, env, encoding: "utf8" });
  const cliWith = (extra: NodeJS.ProcessEnv, ...args: string[]) =>
    spawnSync("node", [CLI, ...args], { cwd: repo, env: { ...env, ...extra }, encoding: "utf8" });
  const gate = (command: string, cwd = repo) =>
    spawnSync("bash", [GATE, "claude-code"], {
      cwd,
      env,
      encoding: "utf8",
      input: JSON.stringify({ cwd, tool_input: { command } }),
    });
  return { tmp, repo, git, cli, cliWith, gate };
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
    expect(
      staged.some((p) => /^\.agent-usage\/records\/p-[0-9a-f]{8}\/\d{8}T\d{6}Z-5\.csv$/.test(p)),
    ).toBe(true);
    // 新しいログが増えたら、Hook が collect して stage する
    git("commit", "-q", "-m", "records");
    const dir = readdirSync(join(repo, ".agent-usage", "records"));
    const person = dir.find((d) => d.startsWith("p-")) ?? "";
    const beforeFiles = readdirSync(join(repo, ".agent-usage", "records", person));
    const before = beforeFiles.length;
    const passed = gate("git commit -m y");
    expect(passed.status).toBe(0);
    // ログは変わっていないので、増えるのはテストが今した commit（reflog の人の commit）の行だけで、それを stage する
    const newFiles = readdirSync(join(repo, ".agent-usage", "records", person)).filter(
      (f) => !beforeFiles.includes(f),
    );
    expect(newFiles).toHaveLength(1);
    const added = readFileSync(join(repo, ".agent-usage", "records", person, newFiles[0]), "utf8")
      .trim()
      .split("\n")
      .slice(1);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((l) => l.startsWith("activity:commit:"))).toBe(true);
    expect(git("diff", "--cached", "--name-only")).toMatch(/\.agent-usage\/records\//);
    // もう一度 Hook を通しても、同じ内容は書き直さない
    expect(gate("git commit -m z").status).toBe(0);
    expect(readdirSync(join(repo, ".agent-usage", "records", person))).toHaveLength(before + 1);
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
    const text = readdirSync(join(records, person))
      .map((f) => readFileSync(join(records, person, f), "utf8"))
      .join("");
    expect(text).toMatch(/usage:claude-code:s-wt:/);
  });

  test("Hook は、前に書いて stage されなかった記録も stage する", () => {
    const { repo, git, cli, gate } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect", "--stage").status).toBe(0);
    git("commit", "-q", "-m", "records");
    // 手動の collect（--stage なし）が書いた記録は stage されない
    expect(cli("collect").status).toBe(0);
    const untracked = git("ls-files", "--others", "--", ".agent-usage/records").trim();
    expect(untracked).not.toBe("");
    expect(gate("git commit -m y").status).toBe(0);
    const staged = git("diff", "--cached", "--name-only").trim().split("\n");
    for (const f of untracked.split("\n")) expect(staged).toContain(f);
    expect(existsSync(join(repo, untracked.split("\n")[0]))).toBe(true);
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

  // gh の hosts.yml を実際に読ませるので、gh が無い環境では実行しない（判定そのものは githubTarget の単体テストで確かめる）
  test.skipIf(!HAS_GH)(
    "GH_HOST が無くても、gh にログインしたホストの origin は GitHub として取得する",
    () => {
      const { tmp, git, cli, cliWith } = setup();
      expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
      git("remote", "add", "origin", "https://ghe.invalid/example-org/example-repo.git");
      git("switch", "-q", "-c", "feature/5-x");
      // ログインしていなければ取得せず、理由を出す。GH_ENTERPRISE_TOKEN はどのホストにも返るので、ログインとして数えない
      const none = cliWith({ GH_ENTERPRISE_TOKEN: "dummy" }, "collect");
      expect(none.stdout).toMatch(/GitHub: 取得していない（origin のホスト ghe\.invalid は/);
      // GH_HOST で指定したホストは、ログインを確かめずに GitHub として扱う（ログインしていない状態で確かめる）
      const viaHost = cliWith({ GH_HOST: "ghe.invalid" }, "collect");
      expect(viaHost.stdout).not.toMatch(/GitHub: 取得していない/);
      expect(viaHost.stdout).toMatch(/GitHub の取得に失敗/);
      // ログインしていれば GitHub として問い合わせる（実在しないホストなので、取得の失敗として出る）
      mkdirSync(join(tmp, "gh"), { recursive: true });
      writeFileSync(
        join(tmp, "gh", "hosts.yml"),
        "ghe.invalid:\n    users:\n        u:\n            oauth_token: dummy\n    oauth_token: dummy\n    user: u\n",
      );
      const authed = cli("collect");
      expect(authed.status).toBe(0);
      expect(authed.stdout).not.toMatch(/GitHub: 取得していない/);
      expect(authed.stdout).toMatch(/GitHub の取得に失敗/);
    },
  );

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
    ["ポート付きはログインを確かめない", "ghe.invalid:7999/o/r", {}, "", "ポートを含む", false],
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

  test("ポートを含むホストの origin は、ログインを確かめずに理由を出して取得しない", () => {
    const { git, cli } = setup();
    expect(cli("setup", "--time-zone", "UTC").status).toBe(0);
    git("remote", "add", "origin", "ssh://git@ghe.invalid:7999/example-org/example-repo.git");
    git("switch", "-q", "-c", "feature/5-x");
    expect(cli("collect").stdout).toMatch(/GitHub: 取得していない（.*ポートを含む/);
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
