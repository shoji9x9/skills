// 後で直す違反の一覧（oxlint-pending.ts）のテスト（Issue #658）。
//
// 一覧は、直したものから外していく。直したのに残った組は、そのファイルで新しく入った同じ種類の違反を見逃すので、失敗にする。
// 実リポジトリの一覧は、oxlint.config.ts から一覧の除外だけを外した oxlint（OXLINT_IGNORE_PENDING=1）で確かめる。
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type CheckPlan,
  checkPlan,
  importClosure,
  parsePlan,
  pendingSources,
} from "./oxlint-pending-check.ts";
import {
  PENDING_FIXES,
  pendingOverrides,
  stalePending,
  unlistedViolations,
} from "./oxlint-pending.ts";
import { REPO_DIR, runOxlint } from "./oxlint-plugin/run-oxlint.ts";
import { CHILD_TIMEOUT_MS } from "../../lib/testing/child-timeout.ts";
import { makeTempDir } from "../../lib/testing/test-tmpdir.ts";

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

test("unlistedViolations: 一覧で外していない違反を、ルールに依らずすべて返す", () => {
  const pending = { "a.ts": ["complexity"] } as const;
  const violations = [
    { file: "a.ts", rule: "complexity", line: 1 },
    { file: "a.ts", rule: "max-params", line: 2 },
    { file: "b.ts", rule: "complexity", line: 3 },
    { file: "b.ts", rule: "no-unused-vars", line: 4 },
  ];
  expect(unlistedViolations(pending, violations)).toEqual([
    { file: "a.ts", rule: "max-params", line: 2 },
    { file: "b.ts", rule: "complexity", line: 3 },
    { file: "b.ts", rule: "no-unused-vars", line: 4 },
  ]);
});

test("checkPlan: staged が無ければ全体、きっかけのファイルかスキルの SKILL.md があれば全体、一覧と重なればそのファイル、どれでもなければ検査しない", () => {
  const pending = { "a.ts": ["complexity"], "b.ts": ["max-depth"] } as const;
  const sources = new Set(["oxlint.config.ts", "pnpm-lock.yaml"]);
  expect(checkPlan(pending, null, sources)).toEqual({ mode: "all" });
  expect(checkPlan(pending, ["pnpm-lock.yaml", "a.ts"], sources)).toEqual({ mode: "all" });
  expect(checkPlan(pending, ["b.ts", "c.ts"], sources)).toEqual({ mode: "files", files: ["b.ts"] });
  expect(checkPlan(pending, ["c.ts"], sources)).toEqual({ mode: "none" });
  expect(checkPlan(pending, ["skills/new/SKILL.md"], sources)).toEqual({ mode: "all" });
  expect(checkPlan(pending, [".agents/skills/new/SKILL.md"], sources)).toEqual({ mode: "all" });
  expect(checkPlan(pending, ["skills/new/references/a.md"], sources)).toEqual({ mode: "none" });
});

test("importClosure: 相対 import をたどり、パッケージの import はたどらない", () => {
  const root = makeTempDir("oxlint-pending-closure-");
  const files: Record<string, string> = {
    "entry.ts": 'import "./lib/a.ts";\nimport "typescript";\n',
    "lib/a.ts": 'export * from "../shared/b.ts";\n',
    "shared/b.ts": "export const b = 1;\n",
    "unused.ts": "export {};\n",
  };
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  expect([...importClosure(root, ["entry.ts"])].sort()).toEqual([
    "entry.ts",
    "lib/a.ts",
    "shared/b.ts",
  ]);
});

test("parsePlan: CLI の出力を範囲に戻す", () => {
  expect(parsePlan("")).toEqual({ mode: "none" });
  expect(parsePlan("all\n")).toEqual({ mode: "all" });
  expect(parsePlan("a.ts\nb.ts\n")).toEqual({ mode: "files", files: ["a.ts", "b.ts"] });
});

test("CLI: stdin の staged のファイルから範囲を出し、検査しないなら何も出さない", () => {
  const listed = Object.keys(PENDING_FIXES)[0];
  const run = (input: string) => {
    const r = spawnSync(
      process.execPath,
      [join(REPO_DIR, "scripts/gates/code/oxlint-pending-check.ts")],
      {
        input,
        encoding: "utf8",
        timeout: CHILD_TIMEOUT_MS,
      },
    );
    expect(r.status, r.stderr).toBe(0);
    return r.stdout;
  };
  expect(run("docs/tooling.md\n")).toBe("");
  // 一覧が空なら、一覧と重なるファイルは無い。一覧と重なるときの範囲は、checkPlan のテストが合成した一覧で確かめる
  if (listed !== undefined) expect(run(`docs/tooling.md\n${listed}\n`)).toBe(`${listed}\n`);
  expect(run("pnpm-lock.yaml\n")).toBe("all\n");
});

test("実リポジトリ: きっかけのファイルに、設定・プラグイン・それらが import するファイル・版を決めるファイルが入る", () => {
  const sources = pendingSources(REPO_DIR);
  for (const f of [
    "scripts/gates/code/oxlint-pending.test.ts",
    "oxlint.config.ts",
    "scripts/gates/code/oxlint-pending.ts",
    "scripts/lib/guards.ts",
    "pnpm-lock.yaml",
  ])
    expect(sources.has(f), f).toBe(true);
});

// pre-commit は、oxlint-pending-check.ts の出力（範囲）を OXLINT_PENDING_PLAN で渡す。渡されなければ（CI）全体を検査する。
const planEnv = process.env.OXLINT_PENDING_PLAN;

test("実リポジトリ: 一覧と、一覧を外した oxlint の違反が一致する（直したのに残った組も、直さずに消した組も無い）", (ctx) => {
  const plan: CheckPlan = planEnv === undefined ? { mode: "all" } : parsePlan(planEnv);
  if (plan.mode === "none") ctx.skip();
  // 削除したファイルは検査できないので除く（在ることは別のテストが確かめる）。残りが無ければ、全体を検査せずに終える。
  const files =
    plan.mode === "files" ? plan.files.filter((f) => existsSync(join(REPO_DIR, f))) : [];
  if (plan.mode === "files" && files.length === 0) ctx.skip();
  // 全体を検査するときは引数を渡さず、oxlint.config.ts の対象の範囲（ignorePatterns）に任せる。
  const violations = runOxlint(files, {
    env: { OXLINT_IGNORE_PENDING: "1" },
    timeout: CHILD_TIMEOUT_MS,
  });
  const scope = plan.mode === "files" ? files : Object.keys(PENDING_FIXES);
  const pending = Object.fromEntries(scope.map((f) => [f, PENDING_FIXES[f] ?? []]));
  const stale = stalePending(pending, violations).map((s) => `${s.file} [${s.rule}]`);
  expect(stale, "直したルールは scripts/gates/code/oxlint-pending.ts から消す").toEqual([]);
  const unlisted = unlistedViolations(PENDING_FIXES, violations).map(
    (v) => `${v.file}:${v.line} [${v.rule}]`,
  );
  expect(unlisted, "一覧から消した組の違反を直す（新しいコードの違反は直す）").toEqual([]);
});
