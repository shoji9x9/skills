// git の情報（リポジトリのルート・共通のディレクトリ・worktree・リモート・ブランチ）。

import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

/**
 * git を実行して標準出力を返す。失敗したら例外にする（呼び出し側で「判定できない」として扱う）。
 * @param {readonly string[]} args
 * @param {string} cwd
 * @returns {string}
 */
export function git(args, cwd) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")}: ${(r.stderr || "").trim() || `exit ${r.status}`}`);
  return r.stdout;
}

/**
 * git を実行し、失敗なら null を返す（無いことが正常な問い合わせ用）。
 * @param {readonly string[]} args
 * @param {string} cwd
 * @returns {string | null}
 */
export function gitOrNull(args, cwd) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

/**
 * リモートの URL を `host/owner/repo` にそろえる（ssh と https の違い・末尾の .git を除く）。
 * @param {string} url
 * @returns {string}
 */
export function normalizeRemote(url) {
  let u = url.trim();
  if (u === "") return "";
  const scp = /^[^@/]+@([^:/]+):(.+)$/.exec(u);
  if (scp) u = `${scp[1]}/${scp[2]}`;
  else u = u.replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]+@/, "");
  return u
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * デフォルトブランチの候補。リモートのデフォルトブランチが分からなければ main と master。
 * @param {{ defaultBranch: string | null }} repo
 * @returns {string[]}
 */
export function defaultBranches(repo) {
  return repo.defaultBranch ? [repo.defaultBranch] : ["main", "master"];
}

/**
 * コミットの前の確認が、記録するかを判断するブランチか。detached HEAD とデフォルトブランチは判断しない。
 * @param {{ branch: string; defaultBranch: string | null }} repo
 * @returns {boolean}
 */
export function isDecisionBranch(repo) {
  return repo.branch !== "" && !defaultBranches(repo).includes(repo.branch);
}

/**
 * @typedef {object} RepoInfo
 * @property {string} root 今の作業ツリーのルート
 * @property {string} commonDir git の共通のディレクトリ（worktree で共有する）
 * @property {string[]} worktrees すべての作業ツリーのルート
 * @property {{ path: string; branch: string }[]} otherWorktrees 今の作業ツリー以外の、ブランチを checkout している作業ツリー（ディレクトリが消えて prunable になったものを除く）
 * @property {string} remote origin を normalizeRemote した形（無ければ空）
 * @property {string} branch 今のブランチ（detached なら空）
 * @property {string | null} defaultBranch リモートのデフォルトブランチ（分からなければ null）
 */

/**
 * `git worktree list --porcelain` の出力を、作業ツリーごとに読む。
 * 形式: https://git-scm.com/docs/git-worktree#_porcelain_format
 * （空行で区切った項目ごとに `worktree <パス>`・`branch refs/heads/<名前>` か `detached`・`prunable [理由]` などの行を持つ）
 * @param {string} text
 * @returns {{ path: string; branch: string; prunable: boolean }[]}
 */
export function parseWorktreeList(text) {
  /** @type {{ path: string; branch: string; prunable: boolean }[]} */
  const list = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) {
      list.push({ path: line.slice("worktree ".length), branch: "", prunable: false });
      continue;
    }
    const cur = list.at(-1);
    if (cur === undefined) continue;
    if (line.startsWith("branch refs/heads/")) cur.branch = line.slice("branch refs/heads/".length);
    else if (line === "prunable" || line.startsWith("prunable ")) cur.prunable = true;
  }
  return list;
}

/**
 * @param {string} cwd
 * @returns {RepoInfo}
 */
export function repoInfo(cwd) {
  const root = git(["rev-parse", "--show-toplevel"], cwd).trim();
  const commonRaw = git(["rev-parse", "--git-common-dir"], root).trim();
  const commonDir = isAbsolute(commonRaw) ? commonRaw : resolve(root, commonRaw);
  const list = parseWorktreeList(git(["worktree", "list", "--porcelain"], root));
  const worktrees = list.map((w) => w.path);
  if (!worktrees.includes(root)) worktrees.push(root);
  const otherWorktrees = list
    .filter((w) => w.path !== root && !w.prunable && w.branch !== "")
    .map((w) => ({ path: w.path, branch: w.branch }));
  const remote = normalizeRemote(gitOrNull(["remote", "get-url", "origin"], root) ?? "");
  const branch = (gitOrNull(["symbolic-ref", "--quiet", "--short", "HEAD"], root) ?? "").trim();
  const head = gitOrNull(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], root);
  const defaultBranch = head ? head.trim().replace(/^refs\/remotes\/origin\//, "") : null;
  return { root, commonDir, worktrees, otherWorktrees, remote, branch, defaultBranch };
}

/**
 * パスが、いずれかのルートの中にあるか。
 * @param {string} path
 * @param {readonly string[]} roots
 * @returns {boolean}
 */
export function isInside(path, roots) {
  return roots.some((r) => path === r || path.startsWith(`${r.replace(/\/+$/, "")}/`));
}
