// 別の作業ツリーの collect が記録するブランチの行を、今のブランチの記録に書かないこと（Issue #871）を確かめる。
//
// 外すブランチ（branchesRecordedElsewhere）の入力の軸:
//   別の作業ツリーのブランチの判断: 記録する／記録しない／無い／判断の記録を読めない。
//   merge 済みか: まだ／済み（HEAD がデフォルトブランチに含まれる）。
//   ブランチの種類: デフォルトブランチ／それ以外。
//   作業ツリー: ある／ディレクトリが消えた（prunable）／消した。
// 外す処理（withoutOtherWorktrees）の入力の軸:
//   行の branch 列: 外すブランチ／それ以外／空。打ち消しの行か。
// 作業ツリーの一覧の形: branch／detached／prunable（理由あり・なし）／locked。

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseCsv } from "../../../skills/agent-usage/scripts/lib/csv.mjs";
import { saveDecision } from "../../../skills/agent-usage/scripts/lib/decisions.mjs";
import { branchesRecordedElsewhere } from "../../../skills/agent-usage/scripts/lib/merged.mjs";
import { parseWorktreeList, repoInfo } from "../../../skills/agent-usage/scripts/lib/repo.mjs";
import { withoutOtherWorktrees } from "../../../skills/agent-usage/scripts/lib/run-collect.mjs";
import { encodeProjectPath } from "../../../skills/agent-usage/scripts/lib/sources/discover.mjs";
import { recordDirs, setup, type Setup } from "./cli-helpers.ts";

const NOW = Date.parse("2026-10-01T12:00:00Z");

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

describe("withoutOtherWorktrees", () => {
  const rows = ["feature/1-here", "feature/2-there", "main", ""].map((branch) => ({
    key: `k:${branch}`,
    branch,
  }));

  test("渡したブランチの行だけを外し、ブランチごとの件数を返す", () => {
    const r = withoutOtherWorktrees(
      [...rows, { key: "k2", branch: "feature/2-there" }],
      new Set(["feature/2-there"]),
    );
    expect(r.rows.map((x) => x.branch)).toEqual(["feature/1-here", "main", ""]);
    expect(r.elsewhere).toEqual({ "feature/2-there": 2 });
  });

  test("外すブランチが無ければ、すべての行を残す", () => {
    const r = withoutOtherWorktrees(rows, new Set());
    expect(r.rows).toEqual(rows);
    expect(r.elsewhere).toEqual({});
  });

  test("打ち消しの行は、外すブランチの行でも残す", () => {
    const retraction = { key: "k:old", branch: "feature/2-there", retracted: "1" };
    const r = withoutOtherWorktrees([retraction], new Set(["feature/2-there"]));
    expect(r.rows).toEqual([retraction]);
    expect(r.elsewhere).toEqual({});
  });
});

/** 共有の作業ツリーを feature/8-main にし、別の作業ツリーを足す関数を返す。 */
async function sharedOnFeature() {
  const s = await setup();
  expect((await s.cli("setup", "--time-zone", "UTC")).status).toBe(0);
  await s.git("add", ".agent-usage");
  await s.git("commit", "-q", "-m", "setup");
  await s.git("switch", "-q", "-c", "feature/8-main");
  const commonDir = join(s.repo, ".git");
  /** 別の作業ツリーを、新しいブランチ（main なら既存の main）で作る。 */
  const addWorktree = async (name: string, branch: string) => {
    const wt = join(s.tmp, name);
    if (branch === "main") await s.git("worktree", "add", "-q", wt, "main");
    else await s.git("worktree", "add", "-q", "-b", branch, wt);
    return wt;
  };
  const record = (branch: string, decision: "record" | "decline" = "record") =>
    saveDecision(commonDir, { branch, decision, now: NOW });
  const elsewhere = () => [...branchesRecordedElsewhere(repoInfo(s.repo), {}, null)].sort();
  return { ...s, commonDir, addWorktree, record, elsewhere };
}

describe.concurrent("branchesRecordedElsewhere", () => {
  test("判断が「記録する」で merge していないブランチだけを返す", async () => {
    const s = await sharedOnFeature();
    await s.addWorktree("wt-a", "feature/1-a");
    await s.addWorktree("wt-b", "feature/2-b");
    await s.addWorktree("wt-c", "feature/3-c");
    s.record("feature/1-a");
    s.record("feature/2-b", "decline");
    expect(s.elsewhere()).toEqual(["feature/1-a"]);
  });

  test("merge 済みのブランチは、判断が「記録する」でも返さない", async () => {
    const s = await sharedOnFeature();
    const wt = await s.addWorktree("wt-a", "feature/1-a");
    s.record("feature/1-a");
    await s.git("-C", wt, "commit", "-q", "--allow-empty", "-m", "work");
    expect(s.elsewhere()).toEqual(["feature/1-a"]);
    const head = (await s.git("-C", wt, "rev-parse", "HEAD")).trim();
    await s.git("update-ref", "refs/remotes/origin/main", head);
    expect(s.elsewhere()).toEqual([]);
  });

  test("デフォルトブランチは、判断が「記録する」でも返さない", async () => {
    const s = await sharedOnFeature();
    await s.addWorktree("wt-main", "main");
    s.record("main");
    expect(s.elsewhere()).toEqual([]);
  });

  test("ディレクトリが消えて prunable になった作業ツリーのブランチは返さない", async () => {
    const s = await sharedOnFeature();
    const wt = await s.addWorktree("wt-a", "feature/1-a");
    s.record("feature/1-a");
    rmSync(wt, { recursive: true, force: true });
    expect(s.elsewhere()).toEqual([]);
  });

  test("判断の記録を読めなければ、どのブランチも返さない", async () => {
    const s = await sharedOnFeature();
    await s.addWorktree("wt-a", "feature/1-a");
    s.record("feature/1-a");
    writeFileSync(join(s.commonDir, "agent-usage", "decisions.json"), "{");
    expect(s.elsewhere()).toEqual([]);
  });
});

describe.concurrent("別の作業ツリーの collect が記録するブランチの行を書かない collect", () => {
  /** feature/7-wt の作業ツリーと、そこで動いたセッションのログを作る。 */
  async function withWorktree() {
    const s = await sharedOnFeature();
    const wt = await s.addWorktree("wt", "feature/7-wt");
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

  test("別の作業ツリーが記録するブランチの行は書かず、その件数を出し、作業ツリーを消した後の collect で書く", async () => {
    const s = await withWorktree();
    s.record("feature/7-wt");
    const r = await s.cli("collect", "--no-github");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /別の作業ツリーの collect が記録するので書かなかった行: feature\/7-wt \d+/,
    );
    const before = writtenBranches(s);
    expect(before.length).toBeGreaterThan(0);
    expect(before).not.toContain("feature/7-wt");

    await s.git("worktree", "remove", "--force", s.wt);
    const again = await s.cli("collect", "--no-github");
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).not.toMatch(/別の作業ツリーの collect が記録する/);
    expect(writtenBranches(s)).toContain("feature/7-wt");
  });

  test("別の作業ツリーのブランチに判断が無ければ、その行を書く", async () => {
    const s = await withWorktree();
    const r = await s.cli("collect", "--no-github");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/別の作業ツリーの collect が記録する/);
    expect(writtenBranches(s)).toContain("feature/7-wt");
  });
});
