import { expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 変異の宣言（`scripts/*.mutations.json`）の**形**を速く検査する。
// 実走（`node scripts/check-mutation-proof.js`）は 3 分ほどかかるので、単純な宣言ミス
// （find が実ファイルに無い・出現数が違う・id 重複・テストファイルの指し違い）はここで拾う。
//
// **この検査を `check-mutation-proof.test.js` に置かない。** 実行器自身を変異させる宣言
// （`check-mutation-proof.mutations.json`）があるため、同じファイルに置くと
// 「変異中の実行器を読んだ形の検査」が毎回落ち、狙った assertion の実証と区別できなくなる（実測）。
//
// 発見ロジックは実行器の `specPaths()` と揃える（1 ファイルを名指しすると、
// 宣言を増やしたときにこの検査だけ追随しない）。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPECS = readdirSync(join(repoRoot, "scripts"))
  .filter((n) => n.endsWith(".mutations.json"))
  .sort();

test("宣言ファイルを 1 件以上同梱している（0 件を合格に倒さない）", () => {
  expect(SPECS.length).toBeGreaterThan(0);
});

test.each(SPECS)("宣言が形を満たす: %s", (fileName) => {
  const spec = JSON.parse(readFileSync(join(repoRoot, "scripts", fileName), "utf8"));
  // 宣言は対応するテストファイルを指す（`<テスト名>.mutations.json` の命名と揃っていること）。
  expect(spec.test_file).toBe(`scripts/${fileName.replace(".mutations.json", ".test.js")}`);
  expect(existsSync(join(repoRoot, spec.test_file))).toBe(true);
  expect(spec.mutations.length).toBeGreaterThan(0);
  const ids = spec.mutations.map((m) => m.id);
  expect(new Set(ids).size, "id が重複している").toBe(ids.length);
  for (const m of spec.mutations) {
    // find は実ファイルに宣言どおりの数だけ在ること（腐った宣言をコミットさせない）。
    const text = readFileSync(join(repoRoot, m.file), "utf8");
    expect(text.split(m.find).length - 1, `${m.id}: ${m.file} の find 出現数`).toBe(
      m.occurrences ?? 1,
    );
    expect(m.expect_failing.length, `${m.id}: expect_failing`).toBeGreaterThan(0);
  }
});
