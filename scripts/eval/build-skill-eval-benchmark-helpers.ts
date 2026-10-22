// build-skill-eval-benchmark.test.ts のヘルパー（iteration の成果物を書き、集計スクリプトを子プロセスで起動する）。
import { expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTempDirFactory } from "../lib/testing/test-tmpdir.ts";
import { spawnAsync } from "../lib/spawn-async.ts";
import { CHILD_TIMEOUT_MS } from "../lib/testing/child-timeout.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SCRIPT = "scripts/eval/build-skill-eval-benchmark.ts";

export const ASSERTIONS = ["最初の assertion", "2 番目の assertion", "3 番目の assertion"];

// **テストは `describe.concurrent` で並べて実行する**（Issue #590）。どのテストも集計スクリプトの子プロセスの終了を
// 待つだけなので、並べた分だけ 1 回の実行が縮み、ミューテーションテストでは変異の数だけ反映される。
// そのため、テストの間で状態を共有しない。iteration はテストごとに別の一時ディレクトリに作る（`tempDir`）。
export const tempDir = makeTempDirFactory("benchmark-build-");

// The parts of benchmark.json these tests read.
export type Benchmark = {
  metadata: Record<string, unknown>;
  runs: {
    eval_id: number;
    configuration: string;
    result: Record<string, unknown>;
    expectations: { text: string }[];
    notes: unknown;
  }[];
  run_summary: Record<string, Record<string, Record<string, number>>>;
  notes: unknown;
};

// Fields are `unknown` where a test writes a malformed value on purpose.
export type RunSpec = {
  evalDir: string;
  evalId: unknown;
  configuration: string;
  runNumber?: number | string;
  assertions?: unknown[];
  passed?: unknown[];
  grading?: unknown;
  timing?: { total_tokens?: unknown; total_duration_seconds?: unknown };
  metrics?: unknown;
  omitGrading?: boolean;
  omitTiming?: boolean;
  executor?: unknown;
};

export function makeIteration() {
  return tempDir("benchmark-build-");
}

/** assertion ごとの判定から、eval_metadata と整合する grading.json の中身を作る。 */
function consistentGrading(assertions: unknown[], passed: unknown[]) {
  const expectations = assertions.map((text, i) => ({
    text,
    passed: passed[i],
    evidence: `根拠 ${i + 1}`,
  }));
  const ok = expectations.filter((e) => e.passed).length;
  return {
    summary: {
      pass_rate: Number((ok / expectations.length).toFixed(4)),
      passed: ok,
      failed: expectations.length - ok,
      total: expectations.length,
    },
    expectations,
  };
}

/** run 1 件ぶんの成果物を書く（既定は eval_metadata と整合する採点）。 */
export function writeRun(
  root: string,
  {
    evalDir,
    evalId,
    configuration,
    runNumber = 1,
    assertions = ASSERTIONS,
    passed = assertions.map(() => true),
    grading, // 明示すると grading.json をそのまま置く（不正な形の検査用）
    timing = {},
    metrics = { total_tool_calls: 0, errors_encountered: 0 },
    omitGrading = false,
    omitTiming = false,
    executor = { name: "claude-code", model: "opus", reasoning_effort: null },
  }: RunSpec,
) {
  const dir = join(root, evalDir, configuration, `run-${runNumber}`);
  mkdirSync(join(dir, "outputs"), { recursive: true });
  writeFileSync(
    join(dir, "eval_metadata.json"),
    JSON.stringify({ eval_id: evalId, eval_name: evalDir, prompt: "p", assertions }),
  );
  if (!omitTiming) {
    writeFileSync(
      join(dir, "timing.json"),
      JSON.stringify({
        schema_version: 1,
        executor,
        total_tokens: timing.total_tokens ?? 1000,
        total_duration_seconds: timing.total_duration_seconds ?? 10.5,
      }),
    );
  }
  if (metrics) writeFileSync(join(dir, "outputs", "metrics.json"), JSON.stringify(metrics));
  if (omitGrading) return dir;
  const body = grading ?? consistentGrading(assertions, passed);
  writeFileSync(join(dir, "grading.json"), JSON.stringify(body));
  return dir;
}

export async function run(root: string, extra: string[] = []) {
  const res = await spawnAsync(
    "node",
    [
      SCRIPT,
      root,
      "--skill-name",
      "demo",
      "--skill-path",
      "<repo>/skills/demo",
      "--executor-model",
      "claude-opus-5",
      "--analyzer-model",
      "manual",
      "--stdout",
      ...extra,
    ],
    { timeout: CHILD_TIMEOUT_MS, cwd: repoRoot },
  );
  return { ...res, out: `${res.stdout}${res.stderr}` };
}

/** 2 eval × 2 configuration の揃った iteration（数値の境界を踏む値で作る）。 */
export function completeIteration() {
  const root = makeIteration();
  writeRun(root, {
    evalDir: "eval-2",
    evalId: 2,
    configuration: "with_skill",
    passed: [true, true, false],
    timing: { total_duration_seconds: 10.5, total_tokens: 1000 },
  });
  writeRun(root, {
    evalDir: "eval-10",
    evalId: 10,
    configuration: "with_skill",
    passed: [true, true, true],
    timing: { total_duration_seconds: 21.25, total_tokens: 2001 },
  });
  writeRun(root, {
    evalDir: "eval-2",
    evalId: 2,
    configuration: "without_skill",
    passed: [true, false, false],
    timing: { total_duration_seconds: 5.125, total_tokens: 400 },
  });
  writeRun(root, {
    evalDir: "eval-10",
    evalId: 10,
    configuration: "without_skill",
    passed: [false, false, false],
    timing: { total_duration_seconds: 7.875, total_tokens: 610 },
  });
  return root;
}

/** completeIteration() を集計した run_summary を確かめる。 */
export function expectCompleteRunSummary(b: Benchmark) {
  // 標本標準偏差（n-1）・Python 互換の 4 桁丸め・min/max も 4 桁。
  expect(b.run_summary.with_skill).toStrictEqual({
    pass_rate: { mean: 0.8334, stddev: 0.2357, min: 0.6667, max: 1 },
    time_seconds: { mean: 15.875, stddev: 7.6014, min: 10.5, max: 21.25 },
    tokens: { mean: 1500.5, stddev: 707.8139, min: 1000, max: 2001 },
  });
  expect(b.run_summary.without_skill).toStrictEqual({
    pass_rate: { mean: 0.1666, stddev: 0.2357, min: 0, max: 0.3333 },
    time_seconds: { mean: 6.5, stddev: 1.9445, min: 5.125, max: 7.875 },
    tokens: { mean: 505, stddev: 148.4924, min: 400, max: 610 },
  });
  // Delta は桁を変えて符号つきの文字列（pass_rate 2 桁 / 秒 1 桁 / トークン 0 桁）。
  expect(b.run_summary.delta).toStrictEqual({
    pass_rate: "+0.67",
    time_seconds: "+9.4",
    tokens: "+996",
  });
}
