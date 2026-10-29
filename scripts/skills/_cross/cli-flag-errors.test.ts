// 配布スキルの CLI が、`--名前 値` の引数の 4 つの誤りを同じ文で報告し、終了コード 2 で止まることを確かめる（Issue #818）。
// 4 つの誤りは、未知の名前・値の無い名前（末尾）・`--` で始まる値・同じ名前の 2 回目である。文は lib/flags.mjs の parseFlags が作る。
// 各 CLI は自分の書き方（`error: ` などの接頭辞と usage）で stderr に出すので、文が含まれることだけを確かめる。
// CLI は子プロセスで起動する。どの CLI も、引数を読んでから入力を読むので、入力のファイルは置かない。

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");

/**
 * CLI と、フラグの前に要る引数（サブコマンド・位置引数）と、値を 1 つ取る名前。
 * flag が null の CLI は値を取る名前を持たないので、未知の名前だけを確かめる。repeat は、繰り返してよい名前なので重複を確かめない。
 */
type Cli = { path: string; prefix?: string[]; flag: string | null; repeat?: boolean };
const CLIS: Cli[] = [
  { path: "skills/agent-usage/scripts/agent-usage.mjs", prefix: ["setup"], flag: "--time-zone" },
  { path: "skills/aws-architecture-diagram/scripts/render-diagram.mjs", flag: "--env" },
  { path: "skills/aws-architecture-diagram/scripts/fetch-aws-icons.mjs", flag: "--out" },
  {
    path: "skills/aws-architecture-diagram/scripts/preview-diagram.mjs",
    prefix: ["prod"],
    flag: "--timeout-ms",
  },
  { path: "skills/golden-dataset/scripts/predicate-coverage-check.mjs", flag: "--design" },
  { path: "skills/issue-start/scripts/acceptance-check.mjs", flag: "--root" },
  {
    path: "skills/kaizen/scripts/skill-config/skill-config.mjs",
    prefix: ["get", "kaizen", "k"],
    flag: "--root",
  },
  { path: "skills/parity-component/scripts/axis-diff.mjs", flag: "--out" },
  { path: "skills/parity-component/scripts/behavior-compare.mjs", flag: "--target" },
  { path: "skills/parity-component/scripts/cascade-resolve.mjs", flag: "--css-rules" },
  { path: "skills/parity-component/scripts/lifecycle-check.mjs", flag: "--build-metadata" },
  { path: "skills/parity-component/scripts/motion-compare.mjs", flag: "--target" },
  { path: "skills/parity-diff/scripts/amend-verify.mjs", flag: "--pair" },
  { path: "skills/parity-diff/scripts/coverage-check.mjs", flag: "--metadata" },
  { path: "skills/parity-diff/scripts/diff-normalize.mjs", prefix: ["d.json"], flag: "--slug" },
  {
    path: "skills/parity-diff/scripts/json-normalize-diff.mjs",
    prefix: ["a.json", "b.json"],
    flag: "--ignore",
    repeat: true,
  },
  { path: "skills/parity-diff/scripts/pending-triage-check.mjs", flag: "--registries" },
  {
    path: "skills/parity-diff/scripts/pixel-crops.mjs",
    prefix: ["a.png", "b.png", "d.json"],
    flag: "--out",
  },
  { path: "skills/parity-suite/scripts/artifact-health-check.mjs", flag: "--metadata" },
  { path: "skills/parity-suite/scripts/capture-scope-check.mjs", flag: "--metadata" },
  { path: "skills/parity-suite/scripts/checkpoint.mjs", prefix: ["record"], flag: "--dir" },
  { path: "skills/parity-suite/scripts/component-comparison-check.mjs", flag: "--coverage" },
  { path: "skills/parity-suite/scripts/component-impact.mjs", flag: "--feature" },
  { path: "skills/parity-suite/scripts/coverage-expand.mjs", flag: "--coverage" },
  { path: "skills/parity-suite/scripts/dimension-fit.mjs", prefix: ["fit"], flag: "--samples" },
  { path: "skills/parity-suite/scripts/header-normalize.mjs", flag: "--header-list" },
  { path: "skills/parity-suite/scripts/perf-stats.mjs", prefix: ["summarize"], flag: "--metadata" },
  {
    path: "skills/parity-suite/scripts/pixel-strict-count.mjs",
    prefix: ["a.png", "b.png"],
    flag: "--diff",
  },
  { path: "skills/parity-suite/scripts/reaction-check.mjs", flag: "--metadata" },
  { path: "skills/parity-suite/scripts/table-upsert.mjs", prefix: ["upsert"], flag: "--file" },
  {
    path: "skills/parity-suite/scripts/trait-compare.mjs",
    prefix: ["a.json", "b.json"],
    flag: "--align-tolerance",
  },
  { path: "skills/replace-strategy/scripts/append-only-check.mjs", flag: "--root" },
  { path: "skills/replace-strategy/scripts/asset-delivery-check.mjs", flag: "--assets" },
  { path: "skills/replace-strategy/scripts/asset-probe.mjs", flag: null },
  { path: "skills/replace-strategy/scripts/evidence-gap-check.mjs", flag: "--slug" },
  { path: "skills/replace-strategy/scripts/pending-decisions-check.mjs", flag: "--file" },
  { path: "skills/replace-strategy/scripts/procedure-staleness-check.mjs", flag: "--revisions" },
  { path: "skills/replace-strategy/scripts/role-probe.mjs", flag: null },
];

const UNKNOWN = "--no-such-flag-818";

/** 誤りの入力と、stderr に含まれるはずの文。 */
type Case = [name: string, args: string[], message: string];
function cases({ flag, repeat }: Cli): Case[] {
  const unknown: Case = ["未知の名前", [UNKNOWN, "x"], `不明な引数: ${UNKNOWN}`];
  if (flag === null) return [unknown];
  const all: Case[] = [
    unknown,
    ["値の無い名前", [flag], `${flag} に値が無い`],
    ["`--` で始まる値", [flag, UNKNOWN], `${flag} に値が無い`],
  ];
  if (!repeat) all.push(["同じ名前の 2 回目", [flag, "v", flag, "v"], `${flag} が重複している`]);
  return all;
}

describe.each(CLIS)("$path", (cli) => {
  test.concurrent.each(cases(cli))("%s は同じ文で終了コード 2 になる", (_, args, message) => {
    const res = spawnSync(
      process.execPath,
      [join(ROOT, cli.path), ...(cli.prefix ?? []), ...args],
      {
        cwd: ROOT,
        encoding: "utf8",
        input: "",
        timeout: 20_000,
      },
    );
    expect(res.error).toBeUndefined();
    expect(res.stderr).toContain(message);
    expect(res.status).toBe(2);
  });
});
