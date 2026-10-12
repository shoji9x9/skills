import { expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { parseJsonAs } from "../lib/parse-as.ts";

// 変異の宣言（`scripts/**/*.mutations.json`）の**形**を速くチェックする。
// 本番の実行（`node scripts/mutation/check-mutation-proof.ts`）は 3 分ほどかかるので、単純な宣言ミス
// （find が実ファイルに無い・出現数が違う・id 重複・テストファイルの指し違い）はここで拾う。
//
// **このチェックを `check-mutation-proof.test.ts` に置かない。** ランナー自身を変異させる宣言
// （`check-mutation-proof.mutations.json`）がある。同じファイルに置くと、
// 「変異中のランナーを読んだ形のチェック」が毎回落ちる。すると、狙った assertion の実証と区別できなくなる（実測）。
//
// 宣言を見つける処理は、ランナーの `specPaths()` と揃える（1 ファイルを名指しすると、
// 宣言を増やしたときにこのチェックだけ追随しない）。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function findSpecs(dir: string): string[] {
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
/** 宣言ファイルのうち、このテストが読む項目の形。 */
type MutationSpec = {
  test_file: string;
  mutations: {
    id: string;
    file: string;
    find: string;
    occurrences?: number;
    expect_failing: string[];
  }[];
};
const SPECS = findSpecs(join(repoRoot, "scripts"))
  .map((p) => relative(repoRoot, p))
  .sort();

test("宣言ファイルを 1 件以上同梱している（0 件を合格として扱わない）", () => {
  expect(SPECS.length).toBeGreaterThan(0);
});

test.each(SPECS)("宣言が形を満たす: %s", (specPath) => {
  const spec = parseJsonAs<MutationSpec>(readFileSync(join(repoRoot, specPath), "utf8"));
  // 宣言は同じディレクトリの対応するテストファイルを指す（`<テスト名>.mutations.json` の命名と揃っていること）。
  expect(spec.test_file).toBe(specPath.replace(".mutations.json", ".test.ts"));
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

// `--shard` の割り当てに使う所要時間の見積もり（`mutation-durations.json`）。宣言を移したときに古いキーだけが残ると、
// 移した先の宣言は見積もりが無いまま default_seconds で配られ、シャードの釣り合いが警告なしに悪くなる。
test("所要時間の見積もりのキーは、実在する宣言を指す", () => {
  const durations = parseJsonAs<{ seconds_per_run: Record<string, unknown> }>(
    readFileSync(join(repoRoot, "scripts/mutation/mutation-durations.json"), "utf8"),
  );
  const keys = Object.keys(durations.seconds_per_run);
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.filter((key) => !SPECS.includes(key))).toEqual([]);
});
