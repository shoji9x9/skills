// AGENTS.md が `@path` で取り込むファイルの回帰テスト。
//
// Claude Code は AGENTS.md の行頭の `@path` を展開して、セッション開始時に読み込む（コードスパンの中は展開しない）。
// 取り込みの行が消える・パスが変わると、作業の原則や使わない語の一覧が届かなくなるが、何もエラーにならない。
import { expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
const imports = [...agents.matchAll(/^@(\S+)$/gm)].map((m) => m[1]);

test("作業の原則の詳細と使わない語の一覧を、行頭の @path で取り込んでいる", () => {
  expect(imports).toEqual(
    expect.arrayContaining(["docs/agent-workflow.md", ".textlint/word-list.md"]),
  );
});

test("取り込むファイルはすべて実在する", () => {
  expect(imports.length).toBeGreaterThan(0);
  for (const path of imports) expect(existsSync(join(repoRoot, path)), path).toBe(true);
});
