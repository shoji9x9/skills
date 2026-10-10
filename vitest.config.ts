import { configDefaults, defineConfig } from "vitest/config";

// **リポジトリの tracked ファイルを書き換えて戻すテスト。** 兄弟テストと並べない。
// `check-mutation-proof.test.js` の差分選択テストはミューテーションテストの実行を含む。
// その実行は tracked ファイル（`scripts/gates/check-word-list.js`）を書き換えて戻す。
// それを読む兄弟テスト（`check-word-list.test.js` / `mutations-declaration.test.js`）と並ぶと、
// 変異中の中間状態を読んで**無関係に赤くなる**。
// `MUTATION_PROOF_LOCK` は別のミューテーションテストを排除するだけで、兄弟テストには機能しない。
const ISOLATED: string[] = ["scripts/mutation/check-mutation-proof.test.js"];

export default defineConfig({
  test: {
    environment: "node",
    // 収集より前に、異常終了で残った使い捨て fixture を掃く（理由はスクリプト内のコメント）。
    globalSetup: ["scripts/lib/vitest-global-setup.ts"],
    // 残りはファイル並列で実行し、書き換えるテストだけを後のグループで単独に実行する。
    // `groupOrder` が違うプロジェクトは前のグループが終わってから始まる。
    // 実測コスト（手元 8 コア）: 全件直列 118 秒 → 並列 25 秒 ＋ 単独 約 11 秒。
    projects: [
      {
        extends: true,
        test: {
          name: "parallel",
          // テストはスクリプトのユニットテストのみ（node_modules はデフォルトで除外）。
          include: ["scripts/**/*.test.js"],
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
