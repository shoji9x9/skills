// 後で直す違反の一覧（oxlint-pending.ts）のテスト（Issue #658）。
//
// 一覧は、直したものから外していく。直したのに残った組は、そのファイルで新しく入った同じ種類の違反を見逃すので、失敗にする。
// 実リポジトリの一覧は、oxlint.config.ts から一覧の除外だけを外した oxlint（OXLINT_IGNORE_PENDING=1）で確かめる。
import { expect, test } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PENDING_FIXES, pendingOverrides, stalePending } from "./oxlint-pending.ts";
import { REPO_DIR, runOxlint } from "./oxlint-plugin/run-oxlint.ts";

test("pendingOverrides: 同じルールの組を持つファイルを 1 つの override にまとめ、ルールを off にする", () => {
  const overrides = pendingOverrides({
    "a.ts": ["complexity", "max-params"],
    "b.ts": ["max-params", "complexity"],
    "c.ts": ["max-depth"],
  });
  expect(overrides).toEqual([
    { files: ["a.ts", "b.ts"], rules: { complexity: "off", "max-params": "off" } },
    { files: ["c.ts"], rules: { "max-depth": "off" } },
  ]);
});

test("stalePending: 違反の無い組だけを返し、別のファイルや別のルールの違反を取り違えない", () => {
  const pending = { "a.ts": ["complexity", "max-params"], "b.ts": ["max-depth"] } as const;
  const violations = [
    { file: "a.ts", rule: "complexity" },
    { file: "b.ts", rule: "max-params" },
    { file: "c.ts", rule: "max-depth" },
  ];
  expect(stalePending(pending, violations)).toEqual([
    { file: "a.ts", rule: "max-params" },
    { file: "b.ts", rule: "max-depth" },
  ]);
  expect(stalePending(pending, [])).toHaveLength(3);
});

test("実リポジトリ: 一覧のファイルはすべて在る", () => {
  const missing = Object.keys(PENDING_FIXES).filter((f) => !existsSync(join(REPO_DIR, f)));
  expect(missing).toEqual([]);
});

test("実リポジトリ: 一覧の組はすべて、一覧を外すと違反になる（直したものが残っていない）", () => {
  const files = Object.keys(PENDING_FIXES);
  expect(files.length).toBeGreaterThan(0);
  const violations = runOxlint(files, { env: { OXLINT_IGNORE_PENDING: "1" } });
  const stale = stalePending(PENDING_FIXES, violations).map((s) => `${s.file} [${s.rule}]`);
  expect(stale, "直したルールは scripts/gates/code/oxlint-pending.ts から消す").toEqual([]);
});
