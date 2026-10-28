// テストが一時ディレクトリをリポジトリにするヘルパーのテスト。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitInit, REPO_ROOT, write } from "./repo-file.ts";
import { makeTempDir } from "./test-tmpdir.ts";

test("REPO_ROOT は、このリポジトリのルート（AGENTS.md を持つ）を指す", () => {
  expect(existsSync(join(REPO_ROOT, "AGENTS.md"))).toBe(true);
});

test("write は親のディレクトリを作って書き、gitInit はリポジトリにする", () => {
  const root = makeTempDir("repo-file-");
  write(root, "a/b/c.txt", "x");
  expect(readFileSync(join(root, "a/b/c.txt"), "utf8")).toBe("x");
  gitInit(root);
  expect(existsSync(join(root, ".git"))).toBe(true);
});

test("gitInit は、git を起動できないディレクトリでは理由を出して例外にする", () => {
  const missing = join(makeTempDir("repo-file-"), "missing");
  expect(() => gitInit(missing)).toThrow(/git init に失敗した（起動できない: .*ENOENT/u);
});
