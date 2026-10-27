// ルールを有効にしたときに既にあった違反のうち、後で直すもの。関数の大きさのルール（Issue #658）と、
// 型の情報を使うルール（options の typeAware で有効になる correctness の分類のルールと no-deprecated。Issue #659）に使う。
// 一覧が空でも、仕組みは残す。ルールを足したり厳しくしたりして、既存の違反をすぐに直せないときに使う。
//
// ファイルごとに、外すルールを挙げる。oxlint.config.ts は、この一覧から overrides を作り、そのファイルでだけルールを外す。
// 行の disable コメントで外さないのは、配布スキルのファイルが利用者のプロジェクトへ入り、そこでは使われない disable になるためである。
// 新しいファイルと、ここに無いルールは外さない。直したら、そのルールを一覧から消す（残っていると oxlint-pending.test.ts が失敗する）。
// 一覧はリポジトリのルートからのパスで、ルールの名前は oxlint.config.ts の rules のキー（分類で有効にしたルールは、診断の名前）と同じ字面にする。

export const PENDING_RULES = [
  "max-lines-per-function",
  "max-depth",
  "max-params",
  "skills-repo/max-lines-per-function-except-describe",
  "typescript/no-base-to-string",
  "typescript/no-deprecated",
  "typescript/no-misused-spread",
  "typescript/no-redundant-type-constituents",
  "typescript/no-useless-default-assignment",
  "typescript/require-array-sort-compare",
  "typescript/restrict-template-expressions",
  "typescript/unbound-method",
] as const;
export type PendingRule = (typeof PENDING_RULES)[number];

export const PENDING_FIXES: Readonly<Record<string, readonly PendingRule[]>> = {
  ".agents/skills/pnpm-audit-alert-issue/scripts/normalize-pnpm-audit.ts": [
    "typescript/no-base-to-string",
  ],
  "scripts/eval/build-skill-eval-benchmark.ts": ["typescript/restrict-template-expressions"],
  "scripts/eval/fixtures/parity-component-fixtures-helpers.ts": [
    "typescript/restrict-template-expressions",
  ],
  "scripts/eval/reuse-skill-eval-baseline.ts": [
    "typescript/no-base-to-string",
    "typescript/restrict-template-expressions",
  ],
  "scripts/gates/packaging/check-eval-reachability.ts": [
    "typescript/no-base-to-string",
    "typescript/restrict-template-expressions",
  ],
  "scripts/gates/packaging/copies/check-rule-symlinks.test.ts": ["typescript/no-misused-spread"],
  "scripts/gates/packaging/copies/check-rule-symlinks.ts": ["typescript/no-misused-spread"],
  "scripts/gates/prose/lint-prose.ts": ["typescript/no-deprecated"],
  "scripts/gates/tooling/lint-scope.test.ts": ["typescript/require-array-sort-compare"],
  "scripts/lib/text/code-comments.ts": ["typescript/no-base-to-string"],
  "scripts/mutation/check-mutation-proof.ts": [
    "typescript/no-base-to-string",
    "typescript/restrict-template-expressions",
  ],
  "scripts/skills/kaizen/kaizen-archive.test.ts": ["typescript/no-misused-spread"],
  "scripts/skills/kaizen/kaizen-context-inject.test.ts": ["typescript/no-misused-spread"],
  "scripts/skills/kaizen/schedule/tracking-issue-title-helpers.ts": [
    "typescript/no-base-to-string",
  ],
  "scripts/skills/parity-component/cascade-resolve.test.ts": [
    "typescript/require-array-sort-compare",
  ],
  "scripts/skills/parity-diff/amend-verify-helpers.ts": ["typescript/unbound-method"],
  "scripts/skills/parity-suite/visual/dimension-fit-helpers.ts": ["typescript/unbound-method"],
  "scripts/skills/parity-suite/visual/pixel-strict-count.test.ts": ["typescript/unbound-method"],
  "scripts/skills/pnpm-audit-alert-issue/normalize-pnpm-audit.test.ts": [
    "typescript/require-array-sort-compare",
  ],
  "scripts/tools/generate-word-list.test.ts": ["typescript/no-useless-default-assignment"],
  "scripts/tools/generate-word-list.ts": ["typescript/restrict-template-expressions"],
  "skills/aws-architecture-diagram/scripts/diagram-engine.mjs": ["typescript/no-misused-spread"],
  "skills/aws-architecture-diagram/scripts/preview-diagram.mjs": [
    "typescript/no-base-to-string",
    "typescript/restrict-template-expressions",
  ],
  "skills/golden-dataset/scripts/predicate-coverage-check.mjs": [
    "typescript/restrict-template-expressions",
  ],
  "skills/issue-start/scripts/acceptance-check.mjs": ["typescript/restrict-template-expressions"],
  "skills/parity-component/scripts/axis-diff.mjs": ["typescript/restrict-template-expressions"],
  "skills/parity-component/scripts/behavior-compare.mjs": [
    "typescript/restrict-template-expressions",
  ],
  "skills/parity-component/scripts/cascade-resolve.mjs": [
    "typescript/no-base-to-string",
    "typescript/require-array-sort-compare",
    "typescript/restrict-template-expressions",
  ],
  "skills/parity-component/scripts/lifecycle-check.mjs": [
    "typescript/restrict-template-expressions",
  ],
  "skills/parity-component/scripts/motion-compare.mjs": [
    "typescript/restrict-template-expressions",
  ],
  "skills/parity-component/scripts/motion-probe.mjs": [
    "typescript/no-base-to-string",
    "typescript/no-redundant-type-constituents",
    "typescript/restrict-template-expressions",
  ],
  "skills/parity-component/scripts/page/css-rules-capture.page.mjs": [
    "typescript/no-base-to-string",
    "typescript/no-redundant-type-constituents",
    "typescript/restrict-template-expressions",
  ],
  "skills/parity-diff/scripts/amend-verify.mjs": [
    "typescript/no-base-to-string",
    "typescript/restrict-template-expressions",
  ],
  "skills/parity-diff/scripts/diff-normalize.mjs": [
    "typescript/no-base-to-string",
    "typescript/restrict-template-expressions",
  ],
  "skills/parity-diff/scripts/pending-triage-check.mjs": ["typescript/no-base-to-string"],
  "skills/parity-suite/assets/perf-capture.spec.template.ts": [
    "typescript/no-base-to-string",
    "typescript/require-array-sort-compare",
    "typescript/restrict-template-expressions",
  ],
  "skills/parity-suite/scripts/artifact-health-check.mjs": ["typescript/no-base-to-string"],
  "skills/parity-suite/scripts/capture-scope-check.mjs": [
    "typescript/no-base-to-string",
    "typescript/restrict-template-expressions",
  ],
  "skills/parity-suite/scripts/checkpoint.mjs": ["typescript/restrict-template-expressions"],
  "skills/parity-suite/scripts/component-comparison-check.mjs": ["typescript/no-base-to-string"],
  "skills/parity-suite/scripts/component-impact.mjs": ["typescript/restrict-template-expressions"],
  "skills/parity-suite/scripts/coverage-expand.mjs": ["typescript/no-base-to-string"],
  "skills/parity-suite/scripts/evidence-carry.mjs": ["typescript/require-array-sort-compare"],
  "skills/parity-suite/scripts/page/element-shot.page.mjs": [
    "typescript/no-redundant-type-constituents",
  ],
  "skills/parity-suite/scripts/page/trait-capture.page.mjs": [
    "typescript/no-redundant-type-constituents",
  ],
  "skills/parity-suite/scripts/perf-stats.mjs": ["typescript/restrict-template-expressions"],
  "skills/parity-suite/scripts/reaction-check.mjs": [
    "typescript/no-base-to-string",
    "typescript/no-useless-default-assignment",
    "typescript/restrict-template-expressions",
  ],
  "skills/replace-strategy/scripts/page/asset-probe.page.mjs": [
    "typescript/no-redundant-type-constituents",
  ],
  "skills/replace-strategy/scripts/page/role-probe.page.mjs": [
    "typescript/no-redundant-type-constituents",
  ],
  "skills/replace-strategy/scripts/procedure-staleness-check.mjs": [
    "typescript/restrict-template-expressions",
  ],
};

/** 一覧から oxlint.config.ts の overrides を作る。同じルールの組を持つファイルを 1 つの override にまとめる。 */
export function pendingOverrides(
  pending: Readonly<Record<string, readonly PendingRule[]>>,
): { files: string[]; rules: Record<string, "off"> }[] {
  const groups = new Map<string, string[]>();
  for (const [file, rules] of Object.entries(pending)) {
    // 空の組は何も外さず、名前が空のルールの override になるので、直したものとして一覧から消させる。
    if (rules.length === 0)
      throw new Error(`oxlint-pending.ts: ${file} のルールが空（直したなら一覧から消す）`);
    const key = [...rules].sort().join(" ");
    const files = groups.get(key) ?? [];
    files.push(file);
    groups.set(key, files);
  }
  return [...groups].map(([key, files]) => ({
    files,
    rules: Object.fromEntries(key.split(" ").map((rule) => [rule, "off"])),
  }));
}

/** 一覧に載っているのに違反が無い組（直したので一覧から消すもの）。violations は一覧を外して実行した oxlint の違反。 */
export function stalePending(
  pending: Readonly<Record<string, readonly PendingRule[]>>,
  violations: readonly { file: string; rule: string }[],
): { file: string; rule: PendingRule }[] {
  const found = new Set(violations.map((v) => `${v.file}\u0000${v.rule}`));
  return Object.entries(pending).flatMap(([file, rules]) =>
    rules.filter((rule) => !found.has(`${file}\u0000${rule}`)).map((rule) => ({ file, rule })),
  );
}

/**
 * 一覧で外していない違反（直さずに一覧から消した組と、それ以外のすべての違反）。violations は一覧を外して実行した oxlint の違反。
 * ルールに依らず数える。設定やプラグインを厳しくした commit で、staged でないファイルに出た違反も見つけるためである。
 */
export function unlistedViolations(
  pending: Readonly<Record<string, readonly PendingRule[]>>,
  violations: readonly { file: string; rule: string; line: number }[],
): { file: string; rule: string; line: number }[] {
  return violations.filter((v) => !(pending[v.file] ?? []).some((r) => r === v.rule));
}
