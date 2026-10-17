// vitest の setupFiles。各テストファイルの前に、テストを起動したリポジトリを指す git の環境変数を外す。
//
// git は hook に GIT_DIR などを渡す。worktree から push すると、pre-push の hook に GIT_DIR が絶対パスで渡る。
// テストが一時ディレクトリで起動する git がそれを受け継ぐと、一時ディレクトリではなく、
// 起動したリポジトリに commit・branch・設定（`git init --bare` の core.bare=true など）を書き込む。
// 外す変数は `git rev-parse --local-env-vars` の一覧である。git がサブモジュールに入るときに外すのと同じ範囲にした。
// GIT_CONFIG_COUNT が指す GIT_CONFIG_KEY_<n>・GIT_CONFIG_VALUE_<n> も外す。

/** `git rev-parse --local-env-vars` が挙げる、リポジトリに固有の環境変数。 */
export const REPO_LOCAL_GIT_ENV = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

const CONFIG_ENTRY = /^GIT_CONFIG_(KEY|VALUE)_\d+$/;

/** `env` から、リポジトリに固有の git の環境変数を消す。他の変数（GIT_EXEC_PATH など）は残す。 */
export function clearRepoLocalGitEnv(env: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(env)) {
    if (REPO_LOCAL_GIT_ENV.includes(name) || CONFIG_ENTRY.test(name)) delete env[name];
  }
}

clearRepoLocalGitEnv(process.env);
