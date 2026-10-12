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
      // 配列への絞り込みは、`Array.isArray` ではなく `isArray`（scripts/lib/is-array.ts、配布スキルは各スキルの
      // scripts/lib/is-array.mjs）で行う。組み込みの `Array.isArray` は `any[]` に絞るので、要素を読む処理で型の検査が外れる。
      // 利用者のプロジェクトへコピーする雛形（skills/*/assets/）は import できないので、同じ関数をファイルの中に持つ。
      // ユーティリティの中で組み込みの判定を呼ぶ 1 行は、その行の disable コメントで外す。
      // eval の fixture は下流のプロジェクトの書き方をそのまま持つので、対象にしない。
      // 直下の設定ファイルは `./*.ts` で指す（`*.ts` は深い階層にも当たり、eval の fixture まで含む）。
      files: [
        "./*.ts",
        "types/**",
        "scripts/**",
        ".agents/skills/*/scripts/**",
        "skills/*/scripts/**",
        "skills/*/assets/**",
      ],
      rules: {
        "no-restricted-properties": [
          "error",
          {
            object: "Array",
            property: "isArray",
            message:
              "isArray（scripts/lib/is-array.ts、配布スキルは scripts/lib/is-array.mjs）を使う。Array.isArray は any[] に絞る",
          },
        ],
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
