// check-kaizen-refs.test.ts のヘルパー（学びを追跡済みで持つ一時リポジトリを作り、チェックを実行する）。
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Exemption, checkKaizenRefs } from "./check-kaizen-refs.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { write } from "./repo-file-helpers.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const script = join(repoRoot, "scripts/gates/docs/check-kaizen-refs.ts");

// 学びのパスは組み立てて書く。このファイルはチェックが自分の fixture として読まない対象（SELF_FIXTURES）に入っていないので、
// そのまま書くと実在しない学びへの参照として数えられる。
const KZ = ".kaizen/";
export const NOTE = `${KZ}2026-09-01-live-note.md`;
export const ARCHIVED = `${KZ}archive/2026-08-01-old-note.md`;
export const INDEX = `${KZ}archive/INDEX.md`;

export function git(root: string, ...args: string[]) {
  const r = spawnSync("git", args, { timeout: CHILD_TIMEOUT_MS, cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

/** 学び 3 件を追跡済みで持つ一時リポジトリ。`files` は追跡して置く参照元、`untracked` は置くだけ。 */
export function makeRepo(
  files: Record<string, string> = {},
  { untracked = {} }: { untracked?: Record<string, string> } = {},
) {
  const root = makeTempDir("kaizen-refs-");
  git(root, "init", "-q");
  for (const p of [NOTE, ARCHIVED, INDEX]) write(root, p, "# note\n");
  for (const [p, t] of Object.entries(files)) write(root, p, t);
  git(root, "add", "-A");
  for (const [p, t] of Object.entries(untracked)) write(root, p, t);
  return root;
}

export const run = (root: string, exemptions: Exemption[] = []) =>
  checkKaizenRefs(root, { exemptions });
