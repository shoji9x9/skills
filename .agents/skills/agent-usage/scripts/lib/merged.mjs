// ブランチが merge 済みかを決める（コミット前の確認で、merge 済みのブランチに記録を足さないために使う）。
//
// 決め方は次の 2 つで、1 に当たらなければ 2 を見る。
//   1. HEAD がリモートのデフォルトブランチ（origin/<デフォルトブランチ>）の祖先で、HEAD がこのブランチで作った commit である。
//      作った直後のブランチや、fast-forward（git pull・merge --ff-only）や reset でデフォルトブランチの commit に移っただけのブランチも
//      HEAD が祖先になる。そこで、ブランチの reflog の最新の行が commit か merge commit を作った行であることも確かめる。
//      reflog が無ければ、この方法では merge 済みとしない。
//   2. gh で、このブランチを head にした PR のうち、merge 済みで head の commit が HEAD と同じものを探す。
//      squash merge と rebase merge では、HEAD がデフォルトブランチの祖先にならないからである。
//      merge の後にこのブランチで commit を足していれば HEAD が変わるので、merge 済みとしない（新しい作業として記録する）。
//      PR は origin のリポジトリでだけ探すので、fork から上流へ出した PR は見つからない。
//   origin が無い・GitHub でない・gh が無い・取得に失敗したときは、2 では merge 済みとしない（記録を止めない）。

import { isRecord } from "./config.mjs";
import { defaultBranches, gitOrNull } from "./repo.mjs";
import { ghLoginError, githubTarget } from "./run-collect.mjs";
import { getAll, makeGh, withoutEnvTokens } from "./sources/github.mjs";

/**
 * @typedef {object} MergedResult
 * @property {boolean} merged
 * @property {string} how merge 済みと決めた方法（merge 済みでなければ空）
 */

/**
 * @param {import("./repo.mjs").RepoInfo} repo
 * @param {NodeJS.ProcessEnv} env
 * @param {import("./sources/github.mjs").GhRunner | null} [gh] テストで差し替える（null なら gh を使う）
 * @returns {MergedResult}
 */
export function branchMerged(repo, env, gh = null) {
  const head = (gitOrNull(["rev-parse", "--verify", "--quiet", "HEAD"], repo.root) ?? "").trim();
  if (head === "") return { merged: false, how: "" };
  const byAncestry = mergedByAncestry(repo, head);
  if (byAncestry !== "") return { merged: true, how: byAncestry };
  const byPr = mergedByPullRequest(repo, head, { env, gh });
  if (byPr !== "") return { merged: true, how: byPr };
  return { merged: false, how: "" };
}

/**
 * HEAD がリモートのデフォルトブランチの祖先で、HEAD がこのブランチで作った commit なら、その説明を返す。
 * @param {import("./repo.mjs").RepoInfo} repo
 * @param {string} head
 * @returns {string}
 */
function mergedByAncestry(repo, head) {
  if (!tipCommittedHere(repo)) return "";
  for (const b of defaultBranches(repo)) {
    const ref = `refs/remotes/origin/${b}`;
    if (gitOrNull(["rev-parse", "--verify", "--quiet", ref], repo.root) === null) continue;
    // --is-ancestor は、祖先なら 0、祖先でなければ 1 で終わる（どちらも出力は無い）
    if (gitOrNull(["merge-base", "--is-ancestor", head, ref], repo.root) !== null)
      return `HEAD が origin/${b} に含まれる`;
  }
  return "";
}

/**
 * ブランチの reflog の最新の行が、このブランチで commit か merge commit を作った行か。reflog が無ければ false。
 * git commit は「commit: 」「commit (amend): 」「commit (cherry-pick): 」を書き、git cherry-pick と git revert は「cherry-pick: 」「revert: 」を書く。
 * git merge と git pull で作った merge commit は「merge <名前>: Merge made by 」「pull: Merge made by 」を書く。
 * fast-forward は「: Fast-forward」、ブランチの作成は「branch: 」、reset は「reset: 」を書くので、当たらない。
 * rebase の「rebase (finish): 」も当てない。git pull --rebase で、移っただけのブランチにも書くからである（PR で決める方法に任せる）。
 * @param {import("./repo.mjs").RepoInfo} repo
 * @returns {boolean}
 */
function tipCommittedHere(repo) {
  const log = gitOrNull(
    ["reflog", "show", "-n", "1", "--format=%gs", `refs/heads/${repo.branch}`],
    repo.root,
  );
  const subject = (log ?? "").split("\n")[0] ?? "";
  return (
    /^commit( \([a-z-]+\))?: /.test(subject) ||
    /^(cherry-pick|revert): /.test(subject) ||
    /^(merge [^:]*|pull[^:]*): Merge made by /.test(subject)
  );
}

/**
 * このブランチを head にした merge 済みの PR のうち、head の commit が HEAD と同じものがあれば、その説明を返す。
 * @param {import("./repo.mjs").RepoInfo} repo
 * @param {string} head
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} opts.env
 * @param {import("./sources/github.mjs").GhRunner | null} opts.gh
 * @returns {string}
 */
function mergedByPullRequest(repo, head, { env, gh }) {
  const target = githubTarget(repo.remote, env, (h) => ghLoginError(h, env));
  if (target.reason !== "") return "";
  const owner = target.slug.split("/")[0] ?? "";
  const run = gh ?? makeGh(target.host, target.viaLogin ? withoutEnvTokens(env) : env);
  const query = `state=closed&per_page=100&head=${encodeURIComponent(`${owner}:${repo.branch}`)}`;
  /** @type {unknown[]} */
  let prs;
  try {
    prs = getAll(run, `repos/${target.slug}/pulls?${query}`, (page) => page);
  } catch {
    return "";
  }
  for (const pr of prs) {
    if (!isRecord(pr) || !isRecord(pr.head)) continue;
    if (typeof pr.merged_at === "string" && pr.merged_at !== "" && pr.head.sha === head)
      return `PR #${String(pr.number)} が merge 済み`;
  }
  return "";
}
