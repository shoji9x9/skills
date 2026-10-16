// これまでに見た作業ツリーのパス。git の共通のディレクトリ（worktree で共有）に置く。
//
// Claude Code のログは作業ツリーのパスごとのディレクトリに分かれ、ログにはリポジトリを示す情報が無い。
// そのため、削除した worktree のログは、そのパスを覚えていないと探せない。
// Hook と collect が実行されるたびに、その時点の worktree のパスをここに足す。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.mjs";
import { isArray } from "../is-array.mjs";

/**
 * @param {string} commonDir
 * @returns {string}
 */
export function worktreesPath(commonDir) {
  return join(commonDir, "agent-usage", "worktrees.json");
}

/**
 * @param {string} commonDir
 * @returns {string[]}
 */
export function loadKnownWorktrees(commonDir) {
  const path = worktreesPath(commonDir);
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!isArray(raw)) throw new Error(`${path}: パスの配列でない`);
  return raw.map((p) => {
    if (typeof p !== "string" || p === "") throw new Error(`${path}: パスの配列でない`);
    return p;
  });
}

/**
 * 今の worktree のパスを覚え、これまでに見たものと合わせて返す。
 * @param {string} commonDir
 * @param {readonly string[]} current
 * @returns {string[]}
 */
export function rememberWorktrees(commonDir, current) {
  const known = loadKnownWorktrees(commonDir);
  const all = [...new Set([...current, ...known])];
  if (all.length !== known.length) {
    const path = worktreesPath(commonDir);
    writeFileAtomic(path, `${JSON.stringify([...all].sort(), null, 2)}\n`);
  }
  return all;
}
