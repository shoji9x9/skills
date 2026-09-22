import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // テストはスクリプトのユニットテストのみ（node_modules は既定で除外）。
    include: ["scripts/**/*.test.js"],
    environment: "node",
    // 収集より前に、異常終了で残った使い捨て fixture を掃く（理由はスクリプト内のコメント）。
    globalSetup: ["scripts/vitest-global-setup.js"],
    // **テストファイルを並列に走らせない。** `check-mutation-proof.test.js` の差分選択テストは
    // 変異実証の実走を含み、リポジトリの**tracked ファイル**（`scripts/build-skill-eval-benchmark.js` /
    // `skills/kaizen/scripts/tracking-issue-lib.sh`）を書き換えて戻す。それらを読む兄弟テスト
    // （`tracking-issue-title.test.js` / `build-skill-eval-benchmark.test.js` /
    // `mutations-declaration.test.js`）と並ぶと、変異中の中間状態を読んで**無関係に赤くなる**。
    // `MUTATION_PROOF_LOCK` は別の変異実証を排除するだけで、兄弟テストには効かない。
    // 実測コスト: 並列 40 秒 → 直列 130 秒（2112 tests）。変異実証は単一ファイル実行なので影響しない。
    fileParallelism: false,
  },
});
