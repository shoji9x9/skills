import { expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// 変異の宣言（`scripts/**/*.mutations.json`）の**形**を速くチェックする。
// 本番の実行（`node scripts/mutation/check-mutation-proof.js`）は 3 分ほどかかるので、単純な宣言ミス
// （find が実ファイルに無い・出現数が違う・id 重複・テストファイルの指し違い）はここで拾う。
//
// **このチェックを `check-mutation-proof.test.js` に置かない。** ランナー自身を変異させる宣言
// （`check-mutation-proof.mutations.json`）がある。同じファイルに置くと、
// 「変異中のランナーを読んだ形のチェック」が毎回落ちる。すると、狙った assertion の実証と区別できなくなる（実測）。
//
// 宣言を見つける処理は、ランナーの `specPaths()` と揃える（1 ファイルを名指しすると、
// 宣言を増やしたときにこのチェックだけ追随しない）。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function findSpecs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name.startsWith("mutation-proof-fixture-")
        ? []
        : findSpecs(path);
    }
    return entry.isFile() && entry.name.endsWith(".mutations.json") ? [path] : [];
  });
}
const SPECS = findSpecs(join(repoRoot, "scripts"))
  .map((p) => relative(repoRoot, p))
  .sort();

test("宣言ファイルを 1 件以上同梱している（0 件を合格として扱わない）", () => {
  expect(SPECS.length).toBeGreaterThan(0);
});

test.each(SPECS)("宣言が形を満たす: %s", (specPath) => {
  const spec = JSON.parse(readFileSync(join(repoRoot, specPath), "utf8"));
  // 宣言は同じディレクトリの対応するテストファイルを指す（`<テスト名>.mutations.json` の命名と揃っていること）。
  expect(spec.test_file).toBe(specPath.replace(".mutations.json", ".test.js"));
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
