// 別の作業ツリーが checkout しているブランチの行を、今のブランチの記録に書かないこと（Issue #871）を確かめる。
//
// 入力の軸（行の branch 列）:
//   今のブランチ／別の作業ツリーが checkout しているブランチ／どの作業ツリーも checkout していないブランチ／空（coverage など）。
// 別の作業ツリーのブランチを外さない条件:
//   デフォルトブランチ（origin/HEAD が無ければ main・master）／取得した PR がすべて閉じた／作業ツリーが prunable（ディレクトリが消えた）。
// 作業ツリーの一覧の形: branch／detached／prunable（理由あり・なし）／locked。

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseCsv } from "../../../skills/agent-usage/scripts/lib/csv.mjs";
import { parseWorktreeList } from "../../../skills/agent-usage/scripts/lib/repo.mjs";
import { withoutOtherWorktrees } from "../../../skills/agent-usage/scripts/lib/run-collect.mjs";
import { closedBranchesOf } from "../../../skills/agent-usage/scripts/lib/sources/github.mjs";
import { encodeProjectPath } from "../../../skills/agent-usage/scripts/lib/sources/discover.mjs";
import { recordDirs, setup, type Setup } from "./cli-helpers.ts";

describe("parseWorktreeList", () => {
  test("作業ツリーごとに、パス・ブランチ・prunable かを読む", () => {
    const text = [
      "worktree /r",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/feature/1-a",
      "",
      "worktree /r/wt-detached",
      "HEAD 2222222222222222222222222222222222222222",
      "detached",
      "",
      "worktree /r/wt-gone",
      "HEAD 3333333333333333333333333333333333333333",
      "branch refs/heads/feature/2-b",
      "prunable gitdir file points to non-existent location",
      "",
      "worktree /r/wt-gone-bare-reason",
      "HEAD 4444444444444444444444444444444444444444",
      "branch refs/heads/feature/3-c",
      "prunable",
      "",
      "worktree /r/wt-locked",
      "HEAD 5555555555555555555555555555555555555555",
      "branch refs/heads/feature/4-d",
      "locked reason",
      "",
    ].join("\n");
    expect(parseWorktreeList(text)).toEqual([
      { path: "/r", branch: "feature/1-a", prunable: false },
      { path: "/r/wt-detached", branch: "", prunable: false },
      { path: "/r/wt-gone", branch: "feature/2-b", prunable: true },
      { path: "/r/wt-gone-bare-reason", branch: "feature/3-c", prunable: true },
      { path: "/r/wt-locked", branch: "feature/4-d", prunable: false },
    ]);
  });

  test("空の出力は空の一覧にする", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });
});

describe("closedBranchesOf", () => {
  const pr = (number: number, branch: string, closedAt: number | null) => ({
    number,
    branch,
    author: "me",
    sha: "abc",
    closedAt,
  });

  test("PR がすべて閉じたブランチだけを返し、open な PR が 1 つでもあるブランチは返さない", () => {
    expect(
      closedBranchesOf([
        pr(1, "feature/1-closed", 1),
        pr(2, "feature/1-closed", 2),
        pr(3, "feature/2-reopened", 1),
        pr(4, "feature/2-reopened", null),
        pr(5, "feature/3-open", null),
      ]),
    ).toEqual(["feature/1-closed"]);
  });

  test("PR が無ければ空にする", () => {
    expect(closedBranchesOf([])).toEqual([]);
  });
});

describe("withoutOtherWorktrees", () => {
  const repo = (o: { branch: string; otherBranches: string[]; defaultBranch: string | null }) => ({
    root: "/r",
    commonDir: "/r/.git",
    worktrees: ["/r"],
    remote: "",
    ...o,
  });
  const rows = ["feature/1-here", "feature/2-there", "feature/3-nowhere", "main", "master", ""].map(
    (branch) => ({ key: `k:${branch}`, branch }),
  );
  const keptBranches = (r: { rows: { branch?: string }[] }) => r.rows.map((x) => x.branch);

  test("別の作業ツリーが checkout しているブランチの行だけを外し、ブランチごとの件数を返す", () => {
    const r = withoutOtherWorktrees([...rows, { key: "k2", branch: "feature/2-there" }], {
      repo: repo({
        branch: "feature/1-here",
        otherBranches: ["feature/2-there"],
        defaultBranch: "main",
      }),
      closedBranches: [],
    });
    expect(keptBranches(r)).toEqual(["feature/1-here", "feature/3-nowhere", "main", "master", ""]);
    expect(r.elsewhere).toEqual({ "feature/2-there": 2 });
  });

  test("デフォルトブランチは、別の作業ツリーが checkout していても外さない", () => {
    const r = withoutOtherWorktrees(rows, {
      repo: repo({ branch: "feature/1-here", otherBranches: ["main"], defaultBranch: "main" }),
      closedBranches: [],
    });
    expect(keptBranches(r)).toEqual(rows.map((x) => x.branch));
    expect(r.elsewhere).toEqual({});
  });

  test("origin/HEAD が無ければ、main と master をデフォルトブランチとして外さない", () => {
    const r = withoutOtherWorktrees(rows, {
      repo: repo({
        branch: "feature/1-here",
        otherBranches: ["main", "master", "feature/2-there"],
        defaultBranch: null,
      }),
      closedBranches: [],
    });
    expect(r.elsewhere).toEqual({ "feature/2-there": 1 });
  });

  test("origin/HEAD が main 以外なら、main は外す対象になる", () => {
    const r = withoutOtherWorktrees(rows, {
      repo: repo({ branch: "feature/1-here", otherBranches: ["main"], defaultBranch: "develop" }),
      closedBranches: [],
    });
    expect(r.elsewhere).toEqual({ main: 1 });
  });

  test("取得した PR がすべて閉じたブランチは、別の作業ツリーが checkout していても外さない", () => {
    const r = withoutOtherWorktrees(rows, {
      repo: repo({
        branch: "feature/1-here",
        otherBranches: ["feature/2-there"],
        defaultBranch: "main",
      }),
      closedBranches: ["feature/2-there"],
    });
    expect(keptBranches(r)).toEqual(rows.map((x) => x.branch));
  });

  test("打ち消しの行は、別の作業ツリーが checkout しているブランチでも外さない", () => {
    const r = withoutOtherWorktrees(
      [{ key: "k:r", branch: "feature/2-there", retracted: "1" }, ...rows],
      {
        repo: repo({
          branch: "feature/1-here",
          otherBranches: ["feature/2-there"],
          defaultBranch: "main",
        }),
        closedBranches: [],
      },
    );
    expect(r.rows.filter((x) => x.retracted === "1").map((x) => x.key)).toEqual(["k:r"]);
    expect(r.elsewhere).toEqual({ "feature/2-there": 1 });
  });

  test("今のブランチは、一覧に入っていても外さない", () => {
    const r = withoutOtherWorktrees(rows, {
      repo: repo({
        branch: "feature/1-here",
        otherBranches: ["feature/1-here"],
        defaultBranch: "main",
      }),
      closedBranches: [],
    });
    expect(r.elsewhere).toEqual({});
  });

  test("detached の作業ツリー（今のブランチが空）でも、branch 列が空の行は外さない", () => {
    const r = withoutOtherWorktrees(rows, {
      repo: repo({ branch: "", otherBranches: ["feature/1-here"], defaultBranch: "main" }),
      closedBranches: [],
    });
    expect(r.elsewhere).toEqual({ "feature/1-here": 1 });
    expect(keptBranches(r)).toContain("");
  });
});

describe.concurrent("別の作業ツリーのブランチの行を書かない collect", () => {
  /** 共有の作業ツリーを feature/8-main にし、feature/7-wt の作業ツリーと、そこで動いたセッションのログを作る。 */
  async function withWorktree() {
    const s = await setup();
    expect((await s.cli("setup", "--time-zone", "UTC")).status).toBe(0);
    await s.git("add", ".agent-usage");
    await s.git("commit", "-q", "-m", "setup");
    const wt = join(s.tmp, "wt");
    await s.git("worktree", "add", "-q", "-b", "feature/7-wt", wt);
    const dir = join(s.tmp, "claude", encodeProjectPath(wt));
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
        gitBranch: "feature/7-wt",
        message: {
          id: "w1",
          model: "claude-opus-5-5",
          usage: { input_tokens: 10, output_tokens: 10 },
        },
      },
    ];
    writeFileSync(join(dir, "s-wt.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
    await s.git("switch", "-q", "-c", "feature/8-main");
    return { ...s, wt };
  }

  /** 共有の作業ツリーのブランチのファイルに書いた行の branch 列。 */
  function writtenBranches(s: Setup): string[] {
    const { branches } = recordDirs(s.repo);
    return readdirSync(branches)
      .filter((f) => f.endsWith(".csv"))
      .flatMap((f) => parseCsv(readFileSync(join(branches, f), "utf8")))
      .map((r) => r.branch ?? "");
  }

  test("別の作業ツリーのブランチの行は書かず、その件数を出し、作業ツリーを消した後の collect で書く", async () => {
    const s = await withWorktree();
    const r = await s.cli("collect", "--no-github");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /別の作業ツリーが checkout しているので書かなかった行.*: feature\/7-wt \d+/,
    );
    const before = writtenBranches(s);
    expect(before.length).toBeGreaterThan(0);
    expect(before).not.toContain("feature/7-wt");

    await s.git("worktree", "remove", "--force", s.wt);
    const again = await s.cli("collect", "--no-github");
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).not.toMatch(/別の作業ツリーが checkout している/);
    expect(writtenBranches(s)).toContain("feature/7-wt");
  });

  test("ディレクトリが消えて prunable になった作業ツリーのブランチの行は書く", async () => {
    const s = await withWorktree();
    rmSync(s.wt, { recursive: true, force: true });
    const r = await s.cli("collect", "--no-github");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/別の作業ツリーが checkout している/);
    expect(writtenBranches(s)).toContain("feature/7-wt");
  });

  test("取得した PR がすべて閉じたブランチの行は、別の作業ツリーが checkout していても書く", async () => {
    const s = await withWorktree();
    await s.git("remote", "add", "origin", "https://github.com/example-org/example-repo.git");
    const bin = join(s.tmp, "bin");
    mkdirSync(bin, { recursive: true });
    const page = (nodes: unknown[]) =>
      JSON.stringify([
        { data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } },
      ]);
    const closedPr = {
      number: 7,
      headRefName: "feature/7-wt",
      author: { login: "me" },
      headRefOid: "abc",
      closedAt: "2026-10-01T11:30:00Z",
      timelineItems: { pageInfo: { hasNextPage: false }, nodes: [] },
    };
    writeFileSync(join(bin, "updated.json"), page([closedPr]));
    writeFileSync(join(bin, "open.json"), page([]));
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        `d='${bin}'`,
        'case "$*" in',
        '  "api user") echo \'{"login":"me"}\' ;;',
        '  *is:open*) cat "$d/open.json" ;;',
        '  *graphql*) cat "$d/updated.json" ;;',
        '  *) echo \'[{"workflow_runs":[],"artifacts":[],"check_runs":[]}]\' ;;',
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const r = await s.cliWith({ PATH: `${bin}:${process.env.PATH ?? ""}` }, "collect");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/GitHub の取得に失敗/);
    expect(r.stdout).not.toMatch(/別の作業ツリーが checkout している/);
    expect(writtenBranches(s)).toContain("feature/7-wt");
  });
});
