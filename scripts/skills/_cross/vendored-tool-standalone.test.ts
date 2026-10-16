// 利用者のプロジェクトへ 1 ファイルだけコピーして使う配布スキルのツールが、コピーした先で単独で読み込めることの回帰テスト。
//
// 手順書は、これらのツールを `<parity_suite_dir>/parity/lib/tools/vendor/` へ 1 ファイルだけコピーして使うよう案内する。
// コピーはスペックから import するか、CLI として起動する。
// 案内しているのは、parity-suite の SKILL.md・references/baseline.md・references/api-batch.md と、
// parity-component の references/capture.md・references/motion.md である。
// コピーした先には隣のファイル（scripts/lib/ など）が無いので、相対パスの import を 1 つ足すと、
// スキルの中のテストはすべて通るのに、コピーは ERR_MODULE_NOT_FOUND で読み込めなくなる。
// そこで、各ツールを空の一時ディレクトリへ 1 ファイルだけコピーして import する。
// CLI の起動の判定（process.argv[1]）に当たらないよう、パスは環境変数で渡す。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 手順書が 1 ファイルだけコピーして使うよう案内するツール。手順書に足したら、ここにも足す。 */
const VENDORED_TOOLS = [
  "skills/parity-suite/scripts/trait-capture.mjs",
  "skills/parity-suite/scripts/trait-compare.mjs",
  "skills/parity-suite/scripts/element-shot.mjs",
  "skills/parity-suite/scripts/header-normalize.mjs",
  "skills/parity-component/scripts/motion-probe.mjs",
];

test.each(VENDORED_TOOLS)("%s は 1 ファイルだけコピーした先で import できる", (tool) => {
  const src = join(repoRoot, tool);
  expect(existsSync(src)).toBe(true);
  const dest = join(makeTempDir("vendored-tool-"), basename(tool));
  copyFileSync(src, dest);
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import(process.env.TOOL); process.stdout.write(Object.keys(m).join(','));",
    ],
    { encoding: "utf8", env: { ...process.env, TOOL: dest }, stdio: ["ignore", "pipe", "pipe"] },
  );
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  // 読み込めたうえで、ツールの版（metadata.json に記録する値）を取り出せる。
  expect(r.stdout.split(",")).toContain("VERSION");
});
