// scripts/ の配置の規約（AGENTS.md「ディレクトリ構造」）の回帰テスト。
//
// scripts/ と scripts/gates/ の直下にファイルを置かないこと、scripts/gates/ の 1 つの分類を 20 ファイル以下に
// 保つことを確かめる。散文に書いただけでは、新しいチェックを直下や満杯の分類に足してもエラーにならない。
import { expect, test } from "vitest";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/test-tmpdir.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MAX_FILES_PER_CATEGORY = 20;
const NO_ROOT_FILES = ["scripts", "scripts/gates"];

/** `dir` 配下のディレクトリでないエントリ（ファイル・リンク）を再帰で数える。 */
function countFiles(dir: string): number {
  return readdirSync(dir, { withFileTypes: true }).reduce(
    (n, entry) => n + (entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1),
    0,
  );
}

/** `root` の scripts/ が配置の規約に反している箇所を返す。 */
function layoutViolations(root: string): string[] {
  const violations: string[] = [];
  for (const dir of NO_ROOT_FILES) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isDirectory()) violations.push(`${dir}/${entry.name}: 直下のファイル`);
    }
  }
  const gates = join(root, "scripts/gates");
  for (const entry of readdirSync(gates, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const files = countFiles(join(gates, entry.name));
    if (files > MAX_FILES_PER_CATEGORY) violations.push(`scripts/gates/${entry.name}: ${files} 件`);
  }
  return violations;
}

/** `files`（root からの相対パス）を空のファイルとして作った root を返す。 */
function makeTree(files: string[]): string {
  const root = makeTempDir("gates-layout-");
  mkdirSync(join(root, "scripts/gates"), { recursive: true });
  for (const rel of files) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), "");
  }
  return root;
}

const categoryFiles = (name: string, n: number) =>
  Array.from({ length: n }, (_, i) => `scripts/gates/${name}/f${i}.ts`);

test("分類の下に置いた 20 ファイル（入れ子を含む）と、直下のディレクトリは違反にしない", () => {
  const root = makeTree([
    ...categoryFiles("docs", 19),
    "scripts/gates/docs/sub/g.json",
    "scripts/lib/x.ts",
  ]);
  expect(layoutViolations(root)).toEqual([]);
});

test.each(NO_ROOT_FILES)("%s の直下のファイルを違反にする", (dir) => {
  const root = makeTree([`${dir}/a.ts`]);
  expect(layoutViolations(root)).toEqual([`${dir}/a.ts: 直下のファイル`]);
});

test("21 ファイル（入れ子を含む）の分類を違反にする", () => {
  const root = makeTree([...categoryFiles("code", 20), "scripts/gates/code/sub/g.json"]);
  expect(layoutViolations(root)).toEqual(["scripts/gates/code: 21 件"]);
});

test("実リポジトリの scripts/ は配置の規約を満たす", () => {
  expect(readdirSync(join(repoRoot, "scripts/gates")).length).toBeGreaterThan(0);
  expect(layoutViolations(repoRoot)).toEqual([]);
});
