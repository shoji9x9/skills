// チェックが使う git の呼び出し（scripts/lib/git.ts）の回帰テスト。
//
// | 軸           | 値                                                       |
// | ------------ | -------------------------------------------------------- |
// | 終わり方     | 成功 / 0 以外の終了 / 打ち切り / 起動できない            |
// | 呼び出し     | runGit / repoRoot / listFiles / indexBlobs / readBlob    |
// | ルートの名前 | 通常 / 末尾が空白 / 末尾が CR                            |
// | ファイル     | 追跡 / 未追跡 / .gitignore / stage した後に作業ツリーから消した |
//
// 期待値は runGit の doc コメント（`<what>（git <サブコマンド> <終わり方>）: <stderr>`）と spawnEnd の書き方から決める。
import { chmodSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";
import { indexBlobs, listFiles, readBlob, repoRoot, runGit } from "./git.ts";
import { gitInit, write } from "./testing/repo-file.ts";
import { makeTempDir } from "./testing/test-tmpdir.ts";

test("repoRoot はリポジトリの中の場所から、ルートを返す", () => {
  const root = makeTempDir("git-root-");
  gitInit(root);
  write(root, "a/b/c.txt", "x");
  expect(repoRoot(join(root, "a", "b"))).toBe(realpathSync(root));
});

test("repoRoot は末尾の LF だけを外し、名前の末尾の CR は残す", () => {
  const dir = makeTempDir("git-cr-");
  const fake = join(dir, "fake-git");
  // 引数が rev-parse --show-toplevel のときだけ、名前が CR で終わるルートを出力する
  write(
    dir,
    "fake-git",
    '#!/bin/sh\n[ "$*" = "rev-parse --show-toplevel" ] || exit 9\nprintf \'/x/repo\\r\\n\'\n',
  );
  chmodSync(fake, 0o755);
  expect(repoRoot(dir, { command: fake })).toBe("/x/repo\r");
});

test("repoRoot は、ディレクトリ名の末尾の空白を消さない", () => {
  const root = join(makeTempDir("git-space-"), "repo ");
  write(root, "a.txt", "x");
  gitInit(root);
  expect(repoRoot(root)).toBe(realpathSync(root));
});

test("listFiles・indexBlobs・readBlob は、追跡しているファイルと staged の中身を読む", () => {
  const root = makeTempDir("git-files-");
  gitInit(root);
  write(root, "skills/a.mjs", "staged\n");
  write(root, "other/b.mjs", "x\n");
  runGit(root, ["add", "skills/a.mjs"], { what: "add" });
  write(root, "skills/a.mjs", "worktree\n");
  expect(listFiles(root, ["skills"])).toEqual(["skills/a.mjs"]);
  // 未追跡のファイルは含め、.gitignore のファイルは除く
  write(root, "skills/new.mjs", "x\n");
  write(root, "skills/ignored.mjs", "x\n");
  write(root, ".gitignore", "skills/ignored.mjs\n");
  expect(listFiles(root, ["skills"]).sort()).toEqual(["skills/a.mjs", "skills/new.mjs"]);
  const blobs = indexBlobs(root, ["skills/a.mjs"]);
  const blob = blobs.get("skills/a.mjs");
  expect(blob).toMatch(/^[0-9a-f]{40,64}$/);
  expect(readBlob(root, blob ?? "", "skills/a.mjs")).toBe("staged\n");
});

test("listFiles は、stage した後に作業ツリーから消したファイルも返す（commit には入るため）", () => {
  const root = makeTempDir("git-deleted-");
  gitInit(root);
  write(root, "skills/a.mjs", "x\n");
  runGit(root, ["add", "skills/a.mjs"], { what: "add" });
  rmSync(join(root, "skills", "a.mjs"));
  expect(listFiles(root, ["skills"])).toEqual(["skills/a.mjs"]);
});

test("0 以外の終了は、何をしようとしたかと終了コードと stderr を書いて投げる", () => {
  const dir = makeTempDir("git-norepo-");
  // 一時ディレクトリがリポジトリの中にある環境でも、上位のリポジトリを探さない
  vi.stubEnv("GIT_CEILING_DIRECTORIES", dirname(dir));
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  expect(() => repoRoot(dir)).toThrow(
    /^git のリポジトリのルートを特定できない（git rev-parse exit 128）: fatal: not a git repository/u,
  );
});

test("読めない blob は、ファイルのパスを書いて投げる", () => {
  const root = makeTempDir("git-blob-");
  gitInit(root);
  expect(() => readBlob(root, "0".repeat(40), "skills/x.mjs")).toThrow(
    /^skills\/x\.mjs: staged の中身を読めない（git cat-file exit 128）/u,
  );
});

test("応答しない git は打ち切り、打ち切ったことが分かるメッセージで投げる", () => {
  const dir = makeTempDir("git-timeout-");
  const fake = join(dir, "fake-git");
  write(dir, "fake-git", "#!/bin/sh\nexec sleep 10\n");
  chmodSync(fake, 0o755);
  const started = performance.now();
  expect(() => repoRoot(dir, { command: fake, timeoutMs: 200 })).toThrow(
    /^git のリポジトリのルートを特定できない（git rev-parse signal SIGTERM（spawnSync .*fake-git ETIMEDOUT））/u,
  );
  expect(performance.now() - started).toBeLessThan(5000);
});

test("起動できない git は、起動できない理由を書いて投げる", () => {
  const dir = makeTempDir("git-missing-");
  expect(() => repoRoot(dir, { command: join(dir, "no-such-git") })).toThrow(
    /^git のリポジトリのルートを特定できない（git rev-parse 起動できない: spawnSync .*no-such-git ENOENT）/u,
  );
});
