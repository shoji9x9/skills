import { expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { isArray } from "../lib/is-array.ts";
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

// `--shard` の割り当てに使う所要時間の見積もり（`mutation-durations.json`）。
const DURATIONS_FILE = parseJsonAs<{ default_seconds?: unknown; seconds_per_run?: unknown }>(
  readFileSync(join(repoRoot, "scripts/mutation/mutation-durations.json"), "utf8"),
);
const DURATIONS: Record<string, unknown> =
  typeof DURATIONS_FILE.seconds_per_run === "object" && DURATIONS_FILE.seconds_per_run !== null
    ? { ...DURATIONS_FILE.seconds_per_run }
    : {};

// ランナーは見積もりを `--shard` で宣言が選ばれた実行でだけ読む（`loadDurations`）。このファイルだけを変える PR は
// どの宣言にも当たらないので、不正な値が CI を通って main に入り、その後に宣言を触るすべての PR のシャードが exit 2 になる。
// ランナーと同じ条件（正の有限の数）を、ここで常に確かめる。
test("所要時間の見積もりの値は正の数である", () => {
  const positive = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  expect(positive(DURATIONS_FILE.default_seconds), "default_seconds").toBe(true);
  expect(
    typeof DURATIONS_FILE.seconds_per_run === "object" &&
      DURATIONS_FILE.seconds_per_run !== null &&
      !isArray(DURATIONS_FILE.seconds_per_run),
    "seconds_per_run がオブジェクトでない",
  ).toBe(true);
  expect(Object.entries(DURATIONS).filter(([, value]) => !positive(value))).toEqual([]);
});

// 宣言を移したときに古いキーだけが残ると、
// 移した先の宣言は見積もりが無いまま default_seconds で配られ、シャードの釣り合いが警告なしに悪くなる。
test("所要時間の見積もりのキーは、実在する宣言を指す", () => {
  const keys = Object.keys(DURATIONS);
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.filter((key) => !SPECS.includes(key))).toEqual([]);
});

// 見積もりの無い宣言は default_seconds で配られ、重い宣言だと 1 つのシャードに寄る（ログに 1 行出るだけで CI は落ちない）。
// 宣言を足したら、見積もりも足す。最初は手元の実行の `時間: X 秒（N 変異、基準 run を含む）` から X ÷ (N + 1) で書く。
test("どの宣言にも所要時間の見積もりがある", () => {
  expect(SPECS.filter((spec) => !(spec in DURATIONS))).toEqual([]);
});
