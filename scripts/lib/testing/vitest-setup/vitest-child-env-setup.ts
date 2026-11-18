// vitest の setupFiles。各テストファイルの前に、テストが起動する子プロセスが受け継ぐ環境変数から、
// テストを起動した環境を指すものを外す。子プロセスの環境は process.env から組み立てるので、ここで外せばすべての子に及ぶ。
//
// git の変数: git は hook に GIT_DIR などを渡す。worktree から push すると、pre-push の hook に GIT_DIR が絶対パスで渡る。
// テストが一時ディレクトリで起動する git がそれを受け継ぐと、一時ディレクトリではなく、
// 起動したリポジトリに commit・branch・設定（`git init --bare` の core.bare=true など）を書き込む。
// 外す変数は `git rev-parse --local-env-vars` の一覧である。git がサブモジュールに入るときに外すのと同じ範囲にした。
// GIT_CONFIG_COUNT が指す GIT_CONFIG_KEY_<n>・GIT_CONFIG_VALUE_<n> も外す。
//
// GitHub Actions の変数: CI のステップには、ジョブの要約・出力・環境変数を追記するファイルのパスが渡る（Issue #850）。
// 子がそれを受け継ぐと、テストの中の処理がジョブに書き込む。
// 例えば、テストが起動した子の vitest は GITHUB_STEP_SUMMARY に自分の結果を追記し、わざと失敗させた結果がジョブの要約に「失敗」として出た。
// 手元では渡らない変数なので、外すと CI と手元でテストの環境が揃う。

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

/**
 * GitHub Actions がステップに渡す、ジョブへ追記するファイル（ワークフローのコマンドのファイル）のパス。
 * 一覧は GitHub の Workflow commands の文書の environment files から取った。読み取りだけの GITHUB_ARTIFACTS_LIST は、書き込まれないので外さない。
 */
const ACTIONS_FILE_COMMAND_ENV = [
  "GITHUB_ARTIFACTS",
  "GITHUB_ENV",
  "GITHUB_OUTPUT",
  "GITHUB_PATH",
  "GITHUB_STATE",
  "GITHUB_STEP_SUMMARY",
];

const CONFIG_ENTRY = /^GIT_CONFIG_(KEY|VALUE)_\d+$/;

/** `env` から、リポジトリに固有の git の環境変数を消す。他の変数（GIT_EXEC_PATH など）は残す。 */
export function clearRepoLocalGitEnv(env: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(env)) {
    if (REPO_LOCAL_GIT_ENV.includes(name) || CONFIG_ENTRY.test(name)) delete env[name];
  }
}

/** `env` から、GitHub Actions のジョブへ追記するファイルのパスを消す。他の変数（GITHUB_ACTIONS など）は残す。 */
export function clearActionsFileCommandEnv(env: NodeJS.ProcessEnv): void {
  for (const name of ACTIONS_FILE_COMMAND_ENV) delete env[name];
}

clearRepoLocalGitEnv(process.env);
clearActionsFileCommandEnv(process.env);
