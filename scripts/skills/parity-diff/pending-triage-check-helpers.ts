// pending-triage-check.test.ts のヘルパー（pending の要素と棚卸し記録を書いてスクリプトを実行する）。

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const script = join(repoRoot, "skills/parity-diff/scripts/pending-triage-check.mjs");

export const SLUG = "my-feature";

/**
 * pending の要素と棚卸し記録を書いてスクリプトを 1 回実行する。
 * @param {{pending: unknown[], entries?: unknown[], record?: unknown, keep?: unknown[], may_change?: unknown[], slugs?: string[], features?: false}} input
 */
export function run(input: {
  pending: unknown[];
  entries?: unknown[];
  /** 棚卸しの記録（intentional_diffs_pending）全体。渡すと entries より優先する。 */
  record?: unknown;
  keep?: unknown[];
  may_change?: unknown[];
  slugs?: string[];
  features?: false;
}) {
  const work = makeTempDir("pending-triage-");
  const registries = join(work, "registries.json");
  const metadata = join(work, "diff-metadata.json");
  const features = join(work, "features.md");
  writeFileSync(
    features,
    [
      "| slug | \u6a5f\u80fd\u540d |",
      "|---|---|",
      ...(input.slugs ?? [SLUG, "other-feature"]).map((s) => `| ${s} | x |`),
      "",
    ].join("\n"),
  );
  writeFileSync(
    registries,
    JSON.stringify({
      intentional_diffs: {
        keep: input.keep ?? [],
        may_change: input.may_change ?? [],
        pending: input.pending,
      },
    }),
  );
  writeFileSync(
    metadata,
    JSON.stringify({
      slug: SLUG,
      intentional_diffs_pending: input.record ?? { entries: input.entries ?? [] },
    }),
  );
  const args = [script, "--registries", registries, "--metadata", metadata];
  if (input.features !== false) args.push("--features", features);
  const result = spawnSync(process.execPath, args, { timeout: CHILD_TIMEOUT_MS, encoding: "utf8" });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}
