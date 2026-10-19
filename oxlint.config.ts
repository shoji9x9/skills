import { defineConfig } from "oxlint";
import { IS_ARRAY_HOLDERS, IS_ARRAY_RESTRICTION } from "./scripts/lib/is-array-holders.ts";
import { VENDORED_GLOBS, agentCopyGlobs } from "./scripts/lib/source-scope.ts";

// 禁じるプロパティ。型ガード isArray を持つファイル（IS_ARRAY_HOLDERS）では、`Array.isArray` だけを除いた一覧を当てる。
// 規則ごと "off" にしないのは、ここに足した他の禁止まで、そのファイルで外れてしまうからである。
const RESTRICTED_PROPERTIES = [IS_ARRAY_RESTRICTION];

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc"],
  categories: {
    correctness: "error",
  },
  // エージェント用のコピーとリンクだけを除く。.agents/ を丸ごと除くと rule と private skill の実体も外れる。
  ignorePatterns: [...agentCopyGlobs(import.meta.dirname), ...VENDORED_GLOBS],
  rules: {},
  overrides: [
    {
      // TypeScript 全体（scripts/・private skill・設定ファイル・types/・配布スキルの雛形・eval の fixture）。
      // 型の検査を警告なしに外す書き方を失敗にする。
      // null や undefined になりうる値は、表明（`!`）ではなく、確かめて型を絞る（テストなら vitest の `assert`）。
      // 型の表明（`as T`・`<T>x`）も禁じる。`as const` と `satisfies` は型を外さないので使ってよい。
      // どうしても要る表明は、その行に `// oxlint-disable-next-line typescript/consistent-type-assertions -- <理由>` を書く。
      // 配布スキル（skills/**）には行の disable コメントを置かない（利用者のプロジェクトで使われない disable になる）。
      // そこでは表明を避けるか、この設定の overrides でファイルごとに外す（scripts/gates/code/check-skill-lint-directives.ts）。
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
      // 型ガードの中で組み込みの判定を呼ぶファイルは、行の disable コメントではなく、この後の override で外す
      // （配布スキルのファイルは利用者のプロジェクトへ入り、そこでは使われない disable になる。scripts/lib/is-array-holders.ts）。
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
        "no-restricted-properties": ["error", ...RESTRICTED_PROPERTIES],
      },
    },
    {
      // 型ガード isArray を持つファイル。`Array.isArray` の禁止だけを外し、他の禁止は残す（一覧が空なら何も禁じない）。
      // 型ガードの外の呼び出しは scripts/gates/code/check-skill-lint-directives.ts が検出する。
      files: IS_ARRAY_HOLDERS,
      rules: {
        "no-restricted-properties": [
          "error",
          ...RESTRICTED_PROPERTIES.filter((r) => r !== IS_ARRAY_RESTRICTION),
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
