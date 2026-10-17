// setupFiles が外す git の環境変数の範囲と、読み込んだだけで外すことの回帰テスト。
//
// | 軸         | 値                                                                    |
// | ---------- | --------------------------------------------------------------------- |
// | 名前       | 一覧の名前 / GIT_CONFIG_KEY_<n>・GIT_CONFIG_VALUE_<n> / 一覧に無い名前 |
// | 一致       | 完全一致 / 一覧の名前を前方に含む別の名前                             |
// | 呼び出し方 | 関数を呼ぶ / モジュールを読み込むだけ                                 |
// | 一覧の出所 | 実物の `git rev-parse --local-env-vars` の出力                         |
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import config from "../../../vitest.config.ts";
import { makeTempDir } from "./test-tmpdir.ts";
import { REPO_LOCAL_GIT_ENV, clearRepoLocalGitEnv } from "./vitest-git-env-setup.ts";

test("一覧の名前と GIT_CONFIG_KEY_<n>・GIT_CONFIG_VALUE_<n> を消し、他の名前は残す", () => {
  const env: NodeJS.ProcessEnv = {
    GIT_CONFIG_KEY_0: "user.name",
    GIT_CONFIG_VALUE_0: "t",
    GIT_CONFIG_KEY_12: "user.email",
    GIT_EXEC_PATH: "/usr/lib/git-core",
    GIT_AUTHOR_NAME: "a",
    GIT_DIRX: "keep",
    GIT_CONFIG_KEY_: "keep",
    PATH: "/bin",
  };
  for (const name of REPO_LOCAL_GIT_ENV) env[name] = "x";

  clearRepoLocalGitEnv(env);

  expect(Object.keys(env).sort()).toEqual([
    "GIT_AUTHOR_NAME",
    "GIT_CONFIG_KEY_",
    "GIT_DIRX",
    "GIT_EXEC_PATH",
    "PATH",
  ]);
});

// spawnSync は同期の呼び出しで vitest のタイムアウトが発火しないので、呼び出しごとにタイムアウトを付ける。
const TIMEOUT_MS = 10_000;

test("実物の git が挙げるリポジトリに固有の変数を、一覧がすべて含む", () => {
  const res = spawnSync("git", ["rev-parse", "--local-env-vars"], {
    cwd: makeTempDir("vitest-git-env-setup-"),
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  expect(res.status, res.stderr).toBe(0);
  const fromGit = res.stdout.split("\n").filter((name) => name !== "");
  expect(fromGit.length).toBeGreaterThan(0);
  expect(fromGit.filter((name) => !REPO_LOCAL_GIT_ENV.includes(name))).toEqual([]);
});

test("実リポジトリの vitest.config.ts が、他の setupFiles より先にこの setup を読み込む", () => {
  expect(config.test?.setupFiles?.[0]).toBe("scripts/lib/testing/vitest-git-env-setup.ts");
});

test("読み込んだだけで外すので、GIT_DIR を受け継いだ子の git の commit が元のリポジトリに入らない", () => {
  const dir = makeTempDir("vitest-git-env-setup-");
  const git = (cwd: string, args: string[]) =>
    spawnSync("git", args, { cwd, encoding: "utf8", timeout: TIMEOUT_MS });
  const victim = join(dir, "victim");
  const own = join(dir, "own");
  for (const repo of [victim, own]) {
    mkdirSync(repo);
    expect(git(repo, ["init", "-q"]).status).toBe(0);
  }
  const setupUrl = pathToFileURL(join(import.meta.dirname, "vitest-git-env-setup.ts")).href;
  // 子は own で commit する。GIT_DIR を外さないと、commit は victim に入る。
  const script = [
    `await import(${JSON.stringify(setupUrl)});`,
    `const { spawnSync } = await import("node:child_process");`,
    `const args = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "com" + "mit", "-q", "--allow-empty", "-m", "child"];`,
    `process.exit(spawnSync("git", args, { timeout: ${TIMEOUT_MS} }).status ?? 1);`,
  ].join("\n");

  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: own,
    encoding: "utf8",
    env: { ...process.env, GIT_DIR: join(victim, ".git") },
    timeout: TIMEOUT_MS * 2,
  });

  expect(child.status, child.stderr).toBe(0);
  expect(git(victim, ["rev-parse", "-q", "--verify", "HEAD"]).status).not.toBe(0);
  expect(git(own, ["rev-list", "--count", "HEAD"]).stdout.trim()).toBe("1");
});
