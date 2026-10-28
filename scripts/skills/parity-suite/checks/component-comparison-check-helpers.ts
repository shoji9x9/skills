// component-comparison-check.test.ts が使うヘルパーと fixture。
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  main,
  checkComponentComparison,
  fingerprintOf,
} from "../../../../skills/parity-suite/scripts/component-comparison-check.mjs";
import {
  FEATURE,
  RENDER_INPUTS,
  TARGET,
  makeCarryProject,
  type ScopeTuple,
  writeJson,
} from "../evidence/evidence-carry-fixture.ts";
import { parseJsonAs } from "../../../lib/parse-as.ts";
import { runInMemory } from "../../../lib/testing/memory-cli.ts";

/** 移行元側の網羅表（present 2 件 ＋ absent / unmeasured 各 1 件）。 */
export const COVERAGE = {
  slug: "order-list",
  measured_target: "current",
  cells: [
    { component: "grid", item: "sort", instance: "grid@list", value: "present", evidence: "読了" },
    {
      component: "grid",
      item: "context-menu",
      instance: "grid@list",
      value: "present",
      evidence: "読了",
    },
    {
      component: "grid",
      item: "export",
      instance: "grid@detail",
      value: "absent",
      evidence: "発火せず",
    },
    {
      component: "grid",
      item: "group",
      instance: "grid@list",
      value: "unmeasured",
      unmeasured_reason: "未到達",
    },
  ],
};

export const PRESENT_KEYS = ["grid|sort|grid@list", "grid|context-menu|grid@list"];

/** 突き合わせ表の 1 行。テストは欄を足したり外したりする。 */
type ComparisonCell = {
  component: string;
  item: string;
  instance: string;
  compared: boolean;
  evidence?: Record<string, string>;
  [key: string]: unknown;
};

/** 突き合わせ表。テストは指紋の欄を外す。 */
type Comparison = {
  slug: string;
  target: string;
  source_coverage: { path: string; fingerprint?: string };
  new_implementation: unknown;
  cells: ComparisonCell[];
};

/**
 * 新側の突き合わせ表を組み立てる。差し替えたい行だけ渡す。
 */
export function comparisonOf(
  override: {
    cells?: ComparisonCell[];
    fingerprint?: string;
    target?: string;
    slug?: string;
    new_implementation?: unknown;
  } = {},
): Comparison {
  return {
    slug: override.slug ?? "order-list",
    target: override.target ?? "preview",
    source_coverage: {
      path: ".replace/parity/order-list/component-coverage.json",
      fingerprint: override.fingerprint ?? fingerprintOf(PRESENT_KEYS),
    },
    new_implementation:
      "new_implementation" in override
        ? override.new_implementation
        : { commit: "abc123", dirty: false },
    cells: override.cells ?? [
      {
        component: "grid",
        item: "sort",
        instance: "grid@list",
        compared: true,
        evidence: {
          entry: "新側で列見出しを押して並び替えを開始できた",
          hit_area: "押せる範囲が見出し全体で cursor も pointer（移行元と同じ）",
          completion: "昇順・降順の印が出て行順が移行元と同じになった",
        },
      },
      {
        component: "grid",
        item: "context-menu",
        instance: "grid@list",
        compared: true,
        evidence: {
          entry: "右クリックでメニューが開いた",
          hit_area: "下位を示す三角が項目自身の ::after で、行全体が 1 つの項目",
          completion: "親項目を押すと下位が開き、親メニューは閉じない",
        },
      },
    ],
  };
}

/** CLI が stdout に書く結果のうち、テストが読む部分。 */
type CliResult = {
  findings: { code: string; message: string }[];
  notes: string[];
  counts: Record<string, number>;
};

/** main をメモリ上のファイルで実行する。 */
export const run = (argv: string[], files: Record<string, string>) =>
  runInMemory<CliResult>(main, argv, { files });

/** 現在の新側の版（`--replace-metadata` が読む形）。突き合わせ表の記録と同じ commit・clean。 */
export const REPLACE_METADATA = { new: { commit: "abc123", dirty: false } };

export const codesOf = (
  input: {
    coverage?: unknown;
    comparison?: unknown;
    target?: string | null;
    replaceMetadata?: unknown;
  } = {},
) =>
  checkComponentComparison({
    coverage: input.coverage ?? COVERAGE,
    comparison: "comparison" in input ? input.comparison : comparisonOf(),
    replaceMetadata: "replaceMetadata" in input ? input.replaceMetadata : REPLACE_METADATA,
    target: input.target ?? null,
  }).findings.map((f) => f.code);

/** new.commit が "none"（新側が git 管理を持たない）の replace-metadata（Issue #408）。iterations を渡すと loop.iterations に置く。 */
export const noneReplaceMetadata = (iterations?: unknown) => ({
  new: { commit: "none", dirty: false },
  ...(iterations === undefined ? {} : { loop: { iterations } }),
});

/**
 * 持ち越しの fixture に網羅表・突き合わせ表・replace-metadata.json を足す。
 * @param {[string, string, string][]} scope
 * @param {Record<string, unknown>} [replaceNewExtra]
 */
export function carryFiles(
  scope: ScopeTuple[],
  replaceNewExtra: Record<string, unknown> = { render_inputs: RENDER_INPUTS },
) {
  const p = makeCarryProject({ scope });
  writeJson(join(p.slugDir, "component-coverage.json"), { ...COVERAGE, slug: FEATURE });
  writeJson(join(p.stageDir, "component-comparison.json"), {
    ...comparisonOf({ slug: FEATURE, target: TARGET }),
    new_implementation: { commit: p.commits.base, dirty: false },
  });
  writeJson(join(p.stageDir, "replace-metadata.json"), {
    new: { target: TARGET, commit: p.commits.component, dirty: false, ...replaceNewExtra },
  });
  return p;
}

/**
 * 実ファイルで main を回す（cwd はプロジェクトルート。引数のパスはそこからの相対）。
 * @param {ReturnType<typeof carryFiles>} p
 * @param {string[]} [extra]
 */
export function runCarry(
  p: ReturnType<typeof carryFiles>,
  extra: string[] = ["--new-repo", "app"],
) {
  let output = "";
  const code = main(
    [
      "--coverage",
      `.replace/parity/${FEATURE}/component-coverage.json`,
      "--comparison",
      `.replace/parity/${FEATURE}/new/${TARGET}/component-comparison.json`,
      "--target",
      TARGET,
      "--replace-metadata",
      `.replace/parity/${FEATURE}/new/${TARGET}/replace-metadata.json`,
      ...extra,
    ],
    {
      cwd: p.root,
      write: (s) => {
        output += s;
      },
    },
  );
  rmSync(p.root, { recursive: true, force: true });
  return { code, result: parseJsonAs<CliResult>(output) };
}
