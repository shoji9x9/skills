import { configDefaults, defineConfig } from "vitest/config";

// **リポジトリの tracked ファイルを書き換えて戻すテスト。** 兄弟テストと並べない。
// `check-mutation-proof.test.js` の差分選択テストは変異実証の実走を含み、tracked ファイル
// （`scripts/eval/build-skill-eval-benchmark.js` / `skills/kaizen/scripts/tracking-issue-lib.sh`）を書き換えて戻す。
// それらを読む兄弟テスト（`tracking-issue-title.test.js` / `build-skill-eval-benchmark.test.js` /
// `mutations-declaration.test.js`）と並ぶと、変異中の中間状態を読んで**無関係に赤くなる**。
// `MUTATION_PROOF_LOCK` は別の変異実証を排除するだけで、兄弟テストには効かない。
const ISOLATED: string[] = ["scripts/mutation/check-mutation-proof.test.js"];

export default defineConfig({
  test: {
    environment: "node",
    // 収集より前に、異常終了で残った使い捨て fixture を掃く（理由はスクリプト内のコメント）。
    globalSetup: ["scripts/lib/vitest-global-setup.ts"],
    // 残りはファイル並列で走らせ、書き換えるテストだけを後のグループで単独に走らせる。
    // `groupOrder` が違うプロジェクトは前のグループが終わってから始まる。
    // 実測コスト（手元 8 コア）: 全件直列 118 秒 → 並列 25 秒 ＋ 単独 約 11 秒。
    projects: [
      {
        extends: true,
        test: {
          name: "parallel",
          // テストはスクリプトのユニットテストのみ（node_modules は既定で除外）。
          include: ["scripts/**/*.test.js"],
          exclude: [...configDefaults.exclude, ...ISOLATED],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "isolated",
          include: ISOLATED,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
