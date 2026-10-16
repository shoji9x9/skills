import { configDefaults, defineConfig } from "vitest/config";

// **リポジトリの tracked ファイルを書き換えて戻すテスト。** 兄弟テストと並べない。
// `check-mutation-proof.test.ts` の差分選択テストはミューテーションテストの実行を含む。
// その実行は tracked ファイル（`scripts/gates/prose/check-word-list.ts`）を書き換えて戻す。
// それを読む兄弟テスト（`check-word-list.test.ts` / `mutations-declaration.test.ts`）と並ぶと、
// 変異中の中間状態を読んで**無関係に赤くなる**。
// `MUTATION_PROOF_LOCK` は別のミューテーションテストを排除するだけで、兄弟テストには機能しない。
const ISOLATED: string[] = ["scripts/mutation/check-mutation-proof.test.ts"];

export default defineConfig({
  test: {
    environment: "node",
    experimental: { viteModuleRunner: false },
    // 収集より前に、異常終了で残った使い捨て fixture を掃く（理由はスクリプト内のコメント）。
    globalSetup: ["scripts/lib/testing/vitest-global-setup.ts"],
    // テストが起動する git に、hook が渡したリポジトリの指定（GIT_DIR など）を渡さない（理由はスクリプト内のコメント）。
    setupFiles: [
      "scripts/lib/testing/vitest-git-env-setup.ts",
      "scripts/lib/testing/vitest-coverage-setup.ts",
    ],
    // 残りはファイル並列で実行し、書き換えるテストだけを後のグループで単独に実行する。
    // `groupOrder` が違うプロジェクトは前のグループが終わってから始まる。
    // 実測コスト（手元 8 コア）: 全件直列 118 秒 → 並列 25 秒 ＋ 単独 約 11 秒。
    projects: [
      {
        extends: true,
        test: {
          name: "parallel",
          // テストはスクリプトのユニットテストのみ（node_modules はデフォルトで除外）。
          include: ["scripts/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...ISOLATED],
          // 子プロセスを待つテストを並べて実行するファイルがあり（Issue #590）、ファイルの並列とも重なって CPU が混む。
          // run-skill-eval.sh のように、同じロックを並べたテストどうしで待つものもある。
          // デフォルトの 5 秒で、変異と関係なく落とさない（isolated と同じ理由）。
          testTimeout: 30_000,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "isolated",
          include: ISOLATED,
          // テストを並べて実行するので、CPU が混むと 1 本が延びる（ミューテーションテストのシャードや CI の少ないコア）。
          // デフォルトの 5 秒で、変異と関係なく落とさない。
          testTimeout: 30_000,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
