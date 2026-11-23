// setupFiles が、makeTempDirFactory の作り直した共有の一時ディレクトリを、テストファイルの終わりに消すことの回帰テスト（Issue #1112）。
//
// 作り直しが起きるのは、テストファイルの間でモジュールを使い回す（isolate: false）ときだけである。
// そのため、子の vitest を isolate: false・ワーカー 1 つで起動し、共有のヘルパーを 2 つのテストファイルから読み込ませる。
// 1 つ目のファイルの afterAll が共有のディレクトリを消し、2 つ目のファイルが作り直す。
// setupFiles が作り直したものを消さないと、子の実行の後に一時ディレクトリが残る。
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import config from "../../../../vitest.config.ts";
import { CHILD_TIMEOUT_MS } from "../child-timeout.ts";
import { makeTempDirFactory } from "../test-tmpdir.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
const SETUP = "scripts/lib/testing/vitest-setup/vitest-tmpdir-setup.ts";

// 子の vitest がテストファイルから vitest を解決できるよう、リポジトリの node_modules の下に置く。
const cacheDir = join(repoRoot, "node_modules", ".cache");
mkdirSync(cacheDir, { recursive: true });
const newProject = makeTempDirFactory("vitest-tmpdir-setup-test-", cacheDir);

/**
 * 子の vitest を起動し、共有のヘルパーが一時ディレクトリを作る場所に、実行の後に残ったものを返す。
 * `setupFiles` に渡したものだけを子の setupFiles にする。
 */
function leftoversAfterChildRun(setupFiles: readonly string[]): string[] {
  const root = realpathSync(newProject("p-"));
  const base = join(root, "tmp");
  mkdirSync(base);
  mkdirSync(join(root, "tests"));
  const helperUrl = pathToFileURL(join(repoRoot, "scripts/lib/testing/test-tmpdir.ts")).href;
  writeFileSync(
    join(root, "tests", "helper.mjs"),
    `import { makeTempDirFactory } from ${JSON.stringify(helperUrl)};\n` +
      `export const make = makeTempDirFactory("shared-", ${JSON.stringify(base)});\n`,
  );
  for (const name of ["a", "b"]) {
    writeFileSync(
      join(root, "tests", `${name}.test.mjs`),
      `import { existsSync } from "node:fs";\nimport { expect, test } from "vitest";\nimport { make } from "./helper.mjs";\n` +
        `test("${name}", () => expect(existsSync(make("d-"))).toBe(true));\n`,
    );
  }
  const setups = setupFiles.map((rel) => join(repoRoot, rel));
  // vitest のデフォルトの exclude は node_modules を含むパスをすべて外すので、置き場所に合わせて書き直す。
  writeFileSync(
    join(root, "vitest.config.mjs"),
    `export default { test: { include: ["tests/**/*.test.mjs"], exclude: [], isolate: false, maxWorkers: 1, ` +
      `experimental: { viteModuleRunner: false }, setupFiles: ${JSON.stringify(setups)} } };\n`,
  );
  const r = spawnSync(process.execPath, [join(repoRoot, "node_modules/vitest/vitest.mjs"), "run"], {
    cwd: root,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  expect(r.stdout).toMatch(/2 passed/);
  return readdirSync(base);
}

test("setupFiles に入っている", () => {
  expect(config.test?.setupFiles).toContain(SETUP);
});

test("isolate: false で後のテストファイルが作り直した共有の一時ディレクトリを、テストファイルの終わりに消す", () => {
  expect(leftoversAfterChildRun([SETUP])).toEqual([]);
});

test("setupFiles に無ければ、作り直した共有の一時ディレクトリが残る（上のテストが作り直しの分岐に届いていることの確認）", () => {
  expect(leftoversAfterChildRun([])).toHaveLength(1);
});
