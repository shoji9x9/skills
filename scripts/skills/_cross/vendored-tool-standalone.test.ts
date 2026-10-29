// 利用者のプロジェクトへコピーして使う配布スキルのツールが、手順書のとおりにコピーした先で読み込めることの回帰テスト。
//
// 手順書は、これらのツールを `<parity_suite_dir>/parity/lib/tools/vendor/` へコピーして使うよう案内する。
// 多くは 1 ファイルだけをコピーする。trait-capture.mjs と element-shot.mjs は、ページで実行する本体（page/*.page.mjs）を
// import するので、その page ファイルをコピー先の隣の page/ へ一緒にコピーする。
// コピーはスペックから import するか、CLI として起動する。
// 案内しているのは、parity-suite の SKILL.md・references/baseline.md・references/api-batch.md と、
// parity-component の references/capture.md・references/motion.md である。
// コピーした先には隣のファイル（scripts/lib/ など）が無いので、相対パスの import を 1 つ足すと、
// スキルの中のテストはすべて通るのに、コピーは ERR_MODULE_NOT_FOUND で読み込めなくなる。
// そこで、各ツールを空の一時ディレクトリへ手順書のとおりにコピーして import する。
// CLI の起動の判定（process.argv[1]）に当たらないよう、パスは環境変数で渡す。

import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 手順書が 1 ファイルだけコピーして使うよう案内するツール。手順書に足したら、ここにも足す。 */
const VENDORED_TOOLS = [
  "skills/parity-suite/scripts/trait-compare.mjs",
  "skills/parity-suite/scripts/header-normalize.mjs",
  "skills/parity-component/scripts/motion-probe.mjs",
];

/** 手順書が、ページで実行する本体（ツールの隣の page/ にある）と一緒にコピーするよう案内するツール。 */
const VENDORED_WITH_PAGE: [string, string][] = [
  ["skills/parity-suite/scripts/trait-capture.mjs", "page/trait-capture.page.mjs"],
  ["skills/parity-suite/scripts/element-shot.mjs", "page/element-shot.page.mjs"],
];

/** 空の一時ディレクトリへツールをコピーし、隣のファイル（companions。ツールからの相対パス）も同じ相対パスへコピーする。 */
function copyTool(tool: string, companions: string[]): string {
  const src = join(repoRoot, tool);
  expect(existsSync(src)).toBe(true);
  const dir = makeTempDir("vendored-tool-");
  const dest = join(dir, basename(tool));
  copyFileSync(src, dest);
  for (const rel of companions) {
    const from = join(dirname(src), rel);
    expect(existsSync(from)).toBe(true);
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    copyFileSync(from, join(dir, rel));
  }
  return dest;
}

/** コピーしたツールを、別のプロセスで import する。 */
function importCopy(dest: string) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import(process.env.TOOL); process.stdout.write(Object.keys(m).join(','));",
    ],
    {
      timeout: CHILD_TIMEOUT_MS,
      encoding: "utf8",
      env: { ...process.env, TOOL: dest },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

test.each(VENDORED_TOOLS)("%s は 1 ファイルだけコピーした先で import できる", (tool) => {
  const r = importCopy(copyTool(tool, []));
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  // 読み込めたうえで、ツールのバージョン（metadata.json に記録する値）を取り出せる。
  expect(r.stdout.split(",")).toContain("VERSION");
});

test.each(VENDORED_WITH_PAGE)("%s は %s と一緒にコピーした先で import できる", (tool, page) => {
  const r = importCopy(copyTool(tool, [page]));
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(r.stdout.split(",")).toContain("VERSION");
});

// 一緒にコピーする page ファイルを手順書から外すと、コピーは読み込めない（一覧が実際の import と合っていることの確認）。
test.each(VENDORED_WITH_PAGE)("%s は %s を欠くと import できない", (tool) => {
  const r = importCopy(copyTool(tool, []));
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/ERR_MODULE_NOT_FOUND/);
});
