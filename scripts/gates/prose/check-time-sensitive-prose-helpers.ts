// check-time-sensitive-prose.test.ts のヘルパー（一時リポジトリを作り、時間の語と日付の検出を文字列にする）。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findTimeMentions } from "./check-time-sensitive-prose.ts";
import { ALLOWED_PATH } from "../../lib/doc-scan.ts";
import { TIERS_PATH } from "../docs/doc-tiers.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { write } from "../../lib/testing/repo-file.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const script = join(repoRoot, "scripts/gates/prose/check-time-sensitive-prose.ts");

export function makeRepo(files: Record<string, string>) {
  const root = makeTempDir("time-sensitive-prose-");
  for (const [p, t] of Object.entries(files)) write(root, p, t);
  return root;
}

/** 時間の語と日付のチェックに要るもの（git と階層の原本）を持つ一時リポジトリ。 */
export function makeGitRepo(files: Record<string, string>, { allowed }: { allowed?: object } = {}) {
  const root = makeRepo({
    [TIERS_PATH]: readFileSync(join(repoRoot, TIERS_PATH), "utf8"),
    ...files,
  });
  if (allowed) writeFileSync(join(root, ALLOWED_PATH), JSON.stringify(allowed));
  const r = spawnSync("git", ["init", "-q"], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: root,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return root;
}

/** 見つけた時間の語と日付（規則・文字列）。 */
export const texts = (file: string, text: string) =>
  findTimeMentions(file, text).map((h) => `${h.rule}:${h.text}`);
