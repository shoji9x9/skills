import { defineConfig } from "oxlint";
import { agentCopyGlobs } from "./scripts/lib/source-scope.ts";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc"],
  categories: {
    correctness: "error",
  },
  // エージェント用のコピーとリンクだけを除く。.agents/ を丸ごと除くと rule と private skill の実体も外れる。
  ignorePatterns: agentCopyGlobs(import.meta.dirname),
  rules: {},
  overrides: [
    {
      // TypeScript 全体（scripts/・private skill・設定ファイル・types/・配布スキルの雛形・eval の fixture）。
      // 型の検査を警告なしに外す書き方を失敗にする。
      // null や undefined になりうる値は、表明（`!`）ではなく、確かめて型を絞る（テストなら vitest の `assert`）。
      // 型の表明（`as T`・`<T>x`）も禁じる。`as const` と `satisfies` は型を外さないので使ってよい。
      // どうしても要る表明は、その行に `// oxlint-disable-next-line typescript/consistent-type-assertions -- <理由>` を書く。
      // 理由を書く欄（`--` の後）は、使わない語などの文章のチェックの対象になる。
      files: ["**/*.{ts,tsx,mts,cts}"],
      rules: {
        "typescript/no-non-null-assertion": "error",
        "typescript/no-explicit-any": "error",
        "typescript/ban-ts-comment": "error",
        "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      },
    },
    {
      // eval の fixture は、エージェントに渡す下流のプロジェクトの断片で、そのプロジェクトの書き方をそのまま持つ
      // （React の雛形の `createRoot(document.getElementById("root")!)` など）。書き換えると eval の入力が変わり、
      // eval を実行し直す必要がある（docs/skill-development.md）。non-null の表明だけを外し、他のルールは残す。
      files: ["evals/*/fixtures/**"],
      rules: {
        "typescript/no-non-null-assertion": "off",
      },
    },
  ],
  options: {
    // 外した理由が無くなった disable のコメントを残さない（表明を消したのにコメントだけが残る、など）。
    reportUnusedDisableDirectives: "error",
  },
  env: {
    builtin: true,
  },
});
