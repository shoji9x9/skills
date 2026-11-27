// git-at.ts（日時を固定した git の呼び出し）のテスト。
//
// | 軸 | 値 |
// | --- | --- |
// | daysAgo | 渡さない（now の日時）/ 渡す（now の daysAgo 日前） |
// | git の終了コード | 0 / 0 以外（stderr を添えて例外） |
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { CHILD_TIMEOUT_MS } from "./child-timeout.ts";
import { gitAt, initRepo } from "./git-at.ts";
import { writeFiles } from "./repo-file.ts";
import { makeTempDir } from "./test-tmpdir.ts";

const NOW = new Date("2026-11-11T03:00:00Z");

function commitDate(root: string, rev: string): string {
  const r = spawnSync("git", ["-C", root, "log", "-1", "--format=%cI", rev], {
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  return new Date(r.stdout.trim()).toISOString();
}

describe("gitAt", () => {
  test("daysAgo を渡さなければ now の日時で、渡せば now の daysAgo 日前の日時で commit する", () => {
    const root = makeTempDir("git-at-");
    const git = gitAt(root, NOW);
    initRepo(git);
    writeFiles(root, { "a.txt": "a\n" });
    git(["add", "-A"]);
    git(["commit", "-qm", "now"]);
    writeFiles(root, { "a.txt": "b\n" });
    git(["commit", "-qam", "ago"], 3);
    expect(commitDate(root, "HEAD~1")).toBe(NOW.toISOString());
    expect(commitDate(root, "HEAD")).toBe("2026-11-08T03:00:00.000Z");
  });

  test("git が 0 以外で終わったら、引数と stderr を添えて例外にする", () => {
    const root = makeTempDir("git-at-");
    const git = gitAt(root, NOW);
    initRepo(git);
    expect(() => git(["rev-parse", "--verify", "no-such-ref"])).toThrow(
      /git rev-parse --verify no-such-ref が失敗した: fatal: /u,
    );
  });
});
