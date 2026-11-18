// setupFiles が fast-check の seed を固定する条件の回帰テスト。
//
// | 軸 | 値 |
// | --- | --- |
// | MUTATION_PROOF_CHILD | 無い / 空 / "1" |
// | 呼び出し方 | 関数を呼ぶ / モジュールを読み込んだ後の fast-check の設定 |
import fc from "fast-check";
import { expect, test } from "vitest";
import config from "../../../../vitest.config.ts";
import { MUTATION_PROOF_SEED, fastCheckSeed } from "./vitest-fast-check-setup.ts";

test("ミューテーションテストの子の実行でだけ seed を固定する", () => {
  expect(fastCheckSeed({})).toBeUndefined();
  expect(fastCheckSeed({ MUTATION_PROOF_CHILD: "" })).toBeUndefined();
  expect(fastCheckSeed({ MUTATION_PROOF_CHILD: "1" })).toBe(MUTATION_PROOF_SEED);
});

test("setupFiles に入っていて、読み込んだ後の fast-check の seed が環境変数で決めた値になる", () => {
  expect(config.test?.setupFiles).toContain(
    "scripts/lib/testing/vitest-setup/vitest-fast-check-setup.ts",
  );
  expect(fc.readConfigureGlobal().seed).toBe(fastCheckSeed(process.env));
});
