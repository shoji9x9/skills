// 後で直す違反の一覧（oxlint-pending.ts）のテスト（Issue #658）。
//
// 一覧は、直したものから外していく。直したのに残った組は、そのファイルで新しく入った同じ種類の違反を見逃すので、失敗にする。
// 実リポジトリの一覧は、oxlint.config.ts から一覧の除外だけを外した oxlint（OXLINT_IGNORE_PENDING=1）で確かめる。
import { expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import {
  PENDING_FIXES,
  PENDING_SOURCES,
  pendingOverrides,
  pendingTargets,
  stalePending,
} from "./oxlint-pending.ts";
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

test("pendingOverrides: ルールが空の組は、外すものが無いので例外にする", () => {
  expect(() => pendingOverrides({ "a.ts": [] })).toThrow(/ルールが空/);
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

test("pendingTargets: staged が無ければすべてを、一覧の外し方を変えるファイルがあればすべてを、それ以外は重なるファイルだけを返す", () => {
  const pending = { "a.ts": ["complexity"], "b.ts": ["max-depth"] } as const;
  expect(pendingTargets(pending, null)).toEqual(["a.ts", "b.ts"]);
  expect(pendingTargets(pending, ["b.ts", "c.ts"])).toEqual(["b.ts"]);
  expect(pendingTargets(pending, ["c.ts"])).toEqual([]);
  expect(pendingTargets(pending, ["oxlint.config.ts"])).toEqual(["a.ts", "b.ts"]);
  expect(pendingTargets(pending, ["pnpm-lock.yaml"])).toEqual(["a.ts", "b.ts"]);
  expect(pendingTargets(pending, ["scripts/gates/code/oxlint-pending.ts"])).toEqual([
    "a.ts",
    "b.ts",
  ]);
  expect(pendingTargets(pending, ["scripts/gates/code/oxlint-plugin/plugin.ts"])).toEqual([
    "a.ts",
    "b.ts",
  ]);
});

test("実リポジトリ: oxlint.config.ts とプラグインが import するファイルは、すべて PENDING_SOURCES に当たる", () => {
  const seen = new Set<string>();
  const queue = ["oxlint.config.ts", "scripts/gates/code/oxlint-plugin/plugin.ts"];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(join(REPO_DIR, file), "utf8");
    for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles)
      if (fileName.startsWith(".")) queue.push(normalize(join(dirname(file), fileName)));
  }
  expect(seen.size).toBeGreaterThan(5);
  const missing = [...seen].filter((f) => !PENDING_SOURCES.some((re) => re.test(f)));
  expect(missing, "PENDING_SOURCES に足す").toEqual([]);
});

// pre-commit は OXLINT_PENDING_STAGED に staged のファイルを空白区切りで渡し、一覧と重なるファイルだけを検査させる。
const staged = process.env.OXLINT_PENDING_STAGED?.split(/\s+/).filter((f) => f !== "") ?? null;
const targets = pendingTargets(PENDING_FIXES, staged);

test.skipIf(targets.length === 0)(
  "実リポジトリ: 一覧の組はすべて、一覧を外すと違反になる（直したものが残っていない）",
  () => {
    const violations = runOxlint(targets, { env: { OXLINT_IGNORE_PENDING: "1" } });
    const target = Object.fromEntries(targets.map((f) => [f, PENDING_FIXES[f] ?? []]));
    const stale = stalePending(target, violations).map((s) => `${s.file} [${s.rule}]`);
    expect(stale, "直したルールは scripts/gates/code/oxlint-pending.ts から消す").toEqual([]);
  },
);
