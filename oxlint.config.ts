import { defineConfig } from "oxlint";
import { IS_ARRAY_HOLDERS, IS_ARRAY_RESTRICTION } from "./scripts/lib/is-array-holders.ts";
import { VENDORED_GLOBS, agentCopyGlobs } from "./scripts/lib/source-scope.ts";
import { PENDING_FIXES, pendingOverrides } from "./scripts/gates/code/oxlint-pending.ts";

// 禁じるプロパティ。型ガード isArray を持つファイル（IS_ARRAY_HOLDERS）では、`Array.isArray` だけを除いた一覧を当てる。
// 規則ごと "off" にしないのは、ここに足した他の禁止まで、そのファイルで外れてしまうからである。
const RESTRICTED_PROPERTIES = [IS_ARRAY_RESTRICTION];

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "import"],
  // 組み込みのルールで表せない規約（scripts/gates/code/oxlint-plugin/）。
  jsPlugins: ["./scripts/gates/code/oxlint-plugin/plugin.ts"],
  categories: {
    correctness: "error",
  },
  // エージェント用のコピーとリンクだけを除く。.agents/ を丸ごと除くと rule と private skill の実体も外れる。
  ignorePatterns: [...agentCopyGlobs(import.meta.dirname), ...VENDORED_GLOBS],
  rules: {
    // 関数の大きさと分岐の数。閾値は oxlint のデフォルト（complexity 20・max-lines-per-function 50 行・max-depth 4・
    // max-params 3・max-nested-callbacks 10）を使う。大きく分岐の多い関数は、テストとミューテーションテストで振る舞いを確かめにくい。
    // max-lines-per-function は空行とコメントも数える。テストのファイルでは、後の override で describe のコールバックだけを外す。
    complexity: "error",
    "max-lines-per-function": "error",
    "max-depth": "error",
    "max-params": "error",
    "max-nested-callbacks": "error",
    // 循環参照と参照の向き（docs/tooling.md「関数の大きさ・参照の向き・循環参照」）。向きは import するファイルからの相対パスを解決して判定する。
    "import/no-cycle": "error",
    "skills-repo/import-direction": ["error", { root: import.meta.dirname }],
  },
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
      // ファイル単位で外すので、型ガードの外の呼び出しも検出しない。一覧には型ガードを持つファイルだけを挙げる。
      files: IS_ARRAY_HOLDERS,
      rules: {
        "no-restricted-properties": [
          "error",
          ...RESTRICTED_PROPERTIES.filter((r) => r !== IS_ARRAY_RESTRICTION),
        ],
      },
    },
    {
      // テストのファイル。describe はファイルの大半を包むので、describe のコールバックだけを行数の上限から外す。
      // 組み込みのルールは describe だけを外すオプションを持たないので、同じ数え方の JS プラグインのルールに替える。
      // テストを書く関数は test にそろえる（it を混ぜない）。
      files: ["scripts/**/*.test.ts"],
      plugins: ["vitest"],
      rules: {
        "max-lines-per-function": "off",
        "skills-repo/max-lines-per-function-except-describe": "error",
        "vitest/consistent-test-it": ["error", { fn: "test" }],
        // vitest プラグインの correctness のルールのうち、このリポジトリのテストが違反するもの。
        // consistent-test-it を使うためにプラグインを有効にしただけで、これらは対象にしていないので外す。採るときは、違反を直してから off の行を消す。
        // valid-expect は vitest の expect の第 2 引数（失敗したときのメッセージ）を誤りとして扱う。
        "vitest/valid-expect": "off",
        "vitest/no-conditional-expect": "off",
        "vitest/expect-expect": "off",
        "vitest/require-to-throw-message": "off",
        "vitest/require-mock-type-parameters": "off",
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
    {
      // 配布スキルの、ページで実行するコード（page/*.page.mjs）。ページへはソースだけが渡る。
      // 渡し方は 2 通りある。CLI が本文を関数式で包んで evaluate_script へ渡すもの（replace-strategy）と、
      // 本体の関数を import して Playwright の evaluate へそのまま渡すもの（parity-suite・parity-component）である。
      // どちらも、宣言していない名前の参照は、ページで実行したときに初めて ReferenceError になる。
      // そこで、ブラウザのグローバルだけを宣言済みとして no-undef を当て、参照の誤りを lint で見つける。
      // 本体は export するので、no-unused-vars はこの設定なしで本体を使われているものとして扱う。
      files: ["skills/*/scripts/page/*.page.mjs"],
      env: { browser: true },
      rules: {
        "no-undef": "error",
      },
    },
    {
      // 本体の関数を Playwright の evaluate へそのまま渡す page ファイル。evaluate はその関数のソースだけを送るので、
      // 本体が呼ぶ関数は本体の中に入れ子で書くしかない。組み込みの max-lines-per-function は入れ子の行も本体に数えるので、
      // JS プラグインのルールに替える。本体は入れ子の関数とコメントを除いてコードの残る行を数え、入れ子の関数は全体の行数で数える。
      // complexity と max-depth は関数ごとに数え、入れ子の関数を本体に数えないので、組み込みのまま当てる。
      // 本体の外にある関数を送るために new Function でソースを組み立てる方法は、利用者の lint や
      // --disallow-code-generation-from-strings で止まるので採らない。
      // CLI が本文を関数式で包む replace-strategy の page ファイルは、本体が呼ぶ関数を最上位に置けるので対象にしない。
      files: [
        "skills/parity-suite/scripts/page/*.page.mjs",
        "skills/parity-component/scripts/page/*.page.mjs",
      ],
      rules: {
        "max-lines-per-function": "off",
        "skills-repo/max-lines-per-function-except-page-entry": "error",
      },
    },
    // 既存の違反のうち、後で直すもの（ファイルごとに外すルール。scripts/gates/code/oxlint-pending.ts）。
    // oxlint-pending.test.ts は、直したのに一覧に残ったものを見つけるため、OXLINT_IGNORE_PENDING=1 で一覧を外して実行する。
    ...(process.env.OXLINT_IGNORE_PENDING === "1" ? [] : pendingOverrides(PENDING_FIXES)),
  ],
  options: {
    // 外した理由が無くなった disable のコメントを残さない（表明を消したのにコメントだけが残る、など）。
    reportUnusedDisableDirectives: "error",
  },
  env: {
    builtin: true,
  },
});
