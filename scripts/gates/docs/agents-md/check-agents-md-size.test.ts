// AGENTS.md のサイズのチェックの回帰テスト。
//
// 状態空間の軸（判定に使う全入力）と、各セルに置いた入力:
//
// | 軸             | 値                                           |
// | -------------- | -------------------------------------------- |
// | サイズ         | 上限より小さい / 上限ちょうど / 上限 + 1     |
// | AGENTS.md      | 在る / 無い                                  |
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIMIT_BYTES, main } from "./check-agents-md-size.ts";
import { write } from "../../../lib/testing/repo-file.ts";
import { makeTempDir } from "../../../lib/testing/test-tmpdir.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const script = join(repoRoot, "scripts/gates/docs/agents-md/check-agents-md-size.ts");

/** AGENTS.md を size バイトにした一時ディレクトリ。 */
function rootWith(size: number) {
  const root = makeTempDir("agents-md-size-");
  write(root, "AGENTS.md", "x".repeat(size));
  return root;
}

test("上限は Codex の project_doc_max_bytes のデフォルト（32 KiB）", () => {
  expect(LIMIT_BYTES).toBe(32768);
});

test.each([
  ["上限より小さい", LIMIT_BYTES - 1, 0],
  ["上限ちょうど", LIMIT_BYTES, 0],
  ["上限 + 1", LIMIT_BYTES + 1, 1],
])("サイズ %s は exit %i", (_name, size, code) => {
  expect(main([rootWith(size)])).toBe(code);
});

test("AGENTS.md が無ければ、判定できないので exit 2", () => {
  expect(main([makeTempDir("agents-md-size-")])).toBe(2);
});

test("CLI: 上限を超えたら、サイズと上限を出して exit 1", () => {
  const r = spawnSync(process.execPath, [script, rootWith(LIMIT_BYTES + 1)], {
    timeout: CHILD_TIMEOUT_MS,
    encoding: "utf8",
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(
    `${LIMIT_BYTES + 1} バイトで、Codex が読む上限の ${LIMIT_BYTES} バイト`,
  );
});

test("CLI: 実リポジトリの AGENTS.md は上限以下で exit 0", () => {
  const r = spawnSync(process.execPath, [script], {
    timeout: CHILD_TIMEOUT_MS,
    cwd: repoRoot,
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("agents-md-size: OK");
});
