// テストが一時ディレクトリに git のリポジトリを作るときの、日時を固定した git の呼び出し。
import { spawnSync } from "node:child_process";
import { CHILD_TIMEOUT_MS } from "./child-timeout.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** gitAt が返す、git を実行する関数。 */
export type GitAt = (args: string[], daysAgo?: number) => void;

/**
 * root で git を実行する関数を返す。daysAgo を渡すと、author と committer の日時を now の daysAgo 日前にする。
 * 利用者の hook と署名の設定を使わない。失敗したら stderr を添えて例外にする。
 */
export function gitAt(root: string, now: Date): GitAt {
  return (args, daysAgo = 0) => {
    const date = new Date(now.getTime() - daysAgo * DAY_MS).toISOString();
    const r = spawnSync(
      "git",
      ["-C", root, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      {
        encoding: "utf8",
        timeout: CHILD_TIMEOUT_MS,
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} が失敗した: ${r.stderr}`);
  };
}

/** root に main を持つ空のリポジトリを作り、commit できるように利用者の名前とメールを設定する。 */
export function initRepo(git: GitAt): void {
  git(["init", "-q", "-b", "main", "."]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "test"]);
}
