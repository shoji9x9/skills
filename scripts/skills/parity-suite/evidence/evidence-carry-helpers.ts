// evidence-carry.test.ts のヘルパー（fixture の作成・judgeCarry の呼び出し・記録の書き換え・両チェックの CLI の実行）。

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeCarry } from "../../../../skills/parity-suite/scripts/evidence-carry.mjs";
import { fingerprintOf } from "../../../../skills/parity-suite/scripts/component-comparison-check.mjs";
import {
  FEATURE,
  RENDER_INPUTS,
  TARGET,
  amendVerifyPair,
  type FeatureMetadata,
  makeCarryProject,
  writeJson,
} from "./evidence-carry-fixture.ts";
import { makeTempDirFactory } from "../../../lib/testing/test-tmpdir.ts";
import { write } from "../../../lib/testing/repo-file.ts";
import { spawnAsync } from "../../../lib/spawn-async.ts";
import { parseJsonAs } from "../../../lib/parse-as.ts";
import { CHILD_TIMEOUT_MS } from "../../../lib/testing/child-timeout.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// fixture をテストごとに別の一時ディレクトリに作り、テストのファイルの終わり（afterAll）でまとめて消す。
const tempDir = makeTempDirFactory("evidence-carry-");

/**
 * fixture を作る。
 * @param {Parameters<typeof makeCarryProject>[0]} [options]
 */
export function project(options?: Parameters<typeof makeCarryProject>[0]) {
  return makeCarryProject({ ...options, makeDir: tempDir });
}

export type Project = ReturnType<typeof project>;

/** amend-verify の記録の 1 組。 */
export type RecordPair = ReturnType<typeof amendVerifyPair>;

/** amend-verify の記録のうち、テストが書き換える欄。 */
export type AmendRecord = { tool: string; change_id: string; pairs: RecordPair[] };

/** 機能の metadata.json のうち、テストが消す欄を持つ形。 */
export type FeatureMetadataFile = FeatureMetadata & { suite: Record<string, unknown> };

/** component-comparison-check の CLI が stdout に書く結果のうち、テストが読む部分。 */
export type ComparisonResult = { findings: { code: string; message: string }[]; notes: string[] };

/**
 * judgeCarry を fixture の既定値で呼ぶ。
 * @param {ReturnType<typeof project>} p
 * @param {Partial<Parameters<typeof judgeCarry>[0]>} [override]
 */
export function judge(p: Project, override: Partial<Parameters<typeof judgeCarry>[0]> = {}) {
  return judgeCarry({
    recordedCommit: p.commits.base,
    wantedCommit: p.commits.component,
    renderInputs: RENDER_INPUTS,
    repo: p.repo,
    evidenceCarryPath: p.evidenceCarryPath,
    featureSlug: FEATURE,
    replaceRoot: p.replaceRoot,
    ...override,
  });
}

/** 記録の組を書き換える。 */
export function editRecordPair(p: Project, edit: (entry: RecordPair) => void) {
  const record = parseJsonAs<AmendRecord>(readFileSync(join(p.root, p.recordPath), "utf8"));
  edit(record.pairs[0]);
  writeJson(join(p.root, p.recordPath), record);
}

/**
 * 記録の current を現側の基準の下の別のパスへ置き直す（ファイルも作り、sha256 を合わせる）。
 * @param {ReturnType<typeof project>} p
 * @param {string} rel `.replace/parity/<slug>/baseline/` からの相対パス
 */
export function moveCurrent(p: Project, rel: string) {
  const path = `.replace/parity/${FEATURE}/baseline/${rel}`;
  const body = `PNG current ${rel}\n`;
  write(p.root, path, body);
  editRecordPair(p, (entry) => {
    entry.inputs.current = { path, sha256: createHash("sha256").update(body).digest("hex") };
  });
}

export const healthCheck = join(repoRoot, "skills/parity-suite/scripts/artifact-health-check.mjs");
export const comparisonCheck = join(
  repoRoot,
  "skills/parity-suite/scripts/component-comparison-check.mjs",
);

/**
 * 両方のチェックが読む成果物を、記録の版 recorded・今の版 wanted で書く。
 * @param {ReturnType<typeof project>} p
 * @param {string} recorded
 * @param {string} wanted
 */
export function writeCheckerInputs(p: Project, recorded: string, wanted: string) {
  // artifact-health-check の他の節（採取物・反復実行・未測定）はキーごと持たない旧成果物として判定させない
  // （雛形のプレースホルダで落ちると、持ち越しの判定と区別できない）。
  const metadata = parseJsonAs<FeatureMetadataFile>(
    readFileSync(join(p.slugDir, "metadata.json"), "utf8"),
  );
  delete metadata.artifact_health;
  delete metadata.unmeasured;
  delete metadata.suite.state_mutating;
  writeJson(join(p.slugDir, "metadata.json"), metadata);
  writeJson(join(p.stageDir, "replace-metadata.json"), {
    suite: { new_green: true },
    new: { target: TARGET, commit: wanted, dirty: false, render_inputs: RENDER_INPUTS },
    loop: { iterations: 2 },
  });
  writeJson(join(p.stageDir, "diff-metadata.json"), {
    new: { target: TARGET, commit: recorded },
    iteration: 2,
    dataset_version: null,
    dataset_version_exempt: "投入対象でない target",
    converged: true,
  });
  writeComparisonInputs(p, recorded);
}

/**
 * component-comparison-check が読む部品の網羅表と比較の記録を、記録の版 recorded で書く。
 * @param {ReturnType<typeof project>} p
 * @param {string} recorded
 */
function writeComparisonInputs(p: Project, recorded: string) {
  const keys = ["grid|sort|grid@list"];
  writeJson(join(p.slugDir, "component-coverage.json"), {
    slug: FEATURE,
    measured_target: "current",
    cells: [
      {
        component: "grid",
        item: "sort",
        instance: "grid@list",
        value: "present",
        evidence: "読了",
      },
    ],
  });
  writeJson(join(p.stageDir, "component-comparison.json"), {
    slug: FEATURE,
    target: TARGET,
    source_coverage: { path: "component-coverage.json", fingerprint: fingerprintOf(keys) },
    new_implementation: { commit: recorded, dirty: false },
    cells: [
      {
        component: "grid",
        item: "sort",
        instance: "grid@list",
        compared: true,
        evidence: { entry: "押せた", hit_area: "見出し全体", completion: "並んだ" },
      },
    ],
  });
}

/**
 * 両方のチェックを CLI として回す。
 * @param {ReturnType<typeof project>} p
 * @param {{ carryTo?: string, newRepo?: boolean }} [options] carryTo は両方へ --carry-to で渡す。newRepo: false で --new-repo を渡さない
 */
export async function runBoth(p: Project, options: { carryTo?: string; newRepo?: boolean } = {}) {
  const extra = [
    ...(options.newRepo === false ? [] : ["--new-repo", p.repo]),
    ...(options.carryTo === undefined ? [] : ["--carry-to", options.carryTo]),
  ];
  // 2 つのチェックは互いに独立なので、並べて起動する。
  const [health, comparison] = await Promise.all([
    spawnAsync(
      process.execPath,
      [healthCheck, "--metadata", join(p.slugDir, "metadata.json"), "--target", TARGET, ...extra],
      { timeout: CHILD_TIMEOUT_MS },
    ),
    spawnAsync(
      process.execPath,
      [
        comparisonCheck,
        "--coverage",
        join(p.slugDir, "component-coverage.json"),
        "--comparison",
        join(p.stageDir, "component-comparison.json"),
        "--target",
        TARGET,
        "--replace-metadata",
        join(p.stageDir, "replace-metadata.json"),
        ...extra,
      ],
      { timeout: CHILD_TIMEOUT_MS },
    ),
  ]);
  return {
    health,
    comparison,
    // stdout が空なら null。使う側は assert.exists で絞ってから読む
    comparisonResult:
      comparison.stdout === "" ? null : parseJsonAs<ComparisonResult>(comparison.stdout),
  };
}
