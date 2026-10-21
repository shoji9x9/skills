// 関数の大きさのルール（oxlint.config.ts）を有効にしたときに既にあった違反のうち、後で直すもの（Issue #658）。
// 直す作業は、ファイルの種類ごとに Issue #756〜#760 で扱う。
//
// ファイルごとに、外すルールを挙げる。oxlint.config.ts は、この一覧から overrides を作り、そのファイルでだけルールを外す。
// 行の disable コメントで外さないのは、配布スキルのファイルが利用者のプロジェクトへ入り、そこでは使われない disable になるためである。
// 新しいファイルと、ここに無いルールは外さない。直したら、そのルールを一覧から消す（残っていると oxlint-pending.test.ts が失敗する）。
// 一覧はリポジトリのルートからのパスで、ルールの名前は oxlint.config.ts の rules のキーと同じ字面にする。

export const PENDING_RULES = [
  "complexity",
  "max-lines-per-function",
  "max-depth",
  "max-params",
  "skills-repo/max-lines-per-function-except-describe",
] as const;
export type PendingRule = (typeof PENDING_RULES)[number];

export const PENDING_FIXES: Readonly<Record<string, readonly PendingRule[]>> = {
  ".agents/skills/pnpm-audit-alert-issue/scripts/normalize-pnpm-audit.ts": ["max-params"],
  "scripts/coverage/run-coverage.ts": ["complexity", "max-lines-per-function", "max-params"],
  "scripts/coverage/shell-coverage.ts": ["max-lines-per-function"],
  "scripts/eval/build-skill-eval-benchmark.test.ts": [
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/eval/build-skill-eval-benchmark.ts": ["complexity", "max-lines-per-function"],
  "scripts/eval/eval-sandbox.test.ts": ["skills-repo/max-lines-per-function-except-describe"],
  "scripts/eval/generate-parity-component-fixtures.ts": [
    "max-lines-per-function",
    "max-depth",
    "max-params",
  ],
  "scripts/eval/normalize-skill-eval-result.ts": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
    "max-params",
  ],
  "scripts/eval/parity-component-fixtures.test.ts": [
    "complexity",
    "max-depth",
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/eval/reuse-skill-eval-baseline.ts": ["complexity", "max-lines-per-function"],
  "scripts/eval/run-skill-eval.test.ts": [
    "max-params",
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/eval/skill-eval-fingerprint.test.ts": ["max-params"],
  "scripts/gates/code/lint-pagination.ts": ["max-lines-per-function"],
  "scripts/gates/code/lint-yaml.ts": ["max-lines-per-function"],
  "scripts/gates/docs/check-doc-refs.test.ts": ["max-params"],
  "scripts/gates/docs/check-doc-refs.ts": ["complexity", "max-lines-per-function", "max-params"],
  "scripts/gates/docs/check-kaizen-refs.test.ts": ["max-params"],
  "scripts/gates/docs/check-kaizen-refs.ts": ["max-lines-per-function"],
  "scripts/gates/packaging/check-eval-reachability.ts": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "scripts/gates/packaging/check-skill-checks.ts": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "scripts/gates/packaging/check-skill-config-vendor.ts": ["max-lines-per-function"],
  "scripts/gates/packaging/check-skill-configs.ts": ["max-lines-per-function"],
  "scripts/gates/packaging/check-skill-frontmatter.ts": ["max-lines-per-function"],
  "scripts/gates/packaging/check-skill-index.ts": ["max-lines-per-function"],
  "scripts/gates/packaging/copies/check-rule-symlinks.ts": ["max-lines-per-function"],
  "scripts/gates/prose/check-time-sensitive-prose.test.ts": ["max-params"],
  "scripts/gates/prose/check-time-sensitive-prose.ts": ["max-lines-per-function"],
  "scripts/gates/prose/lint-prose.ts": ["max-lines-per-function", "max-params"],
  "scripts/gates/tooling/lint-scope.test.ts": ["max-params"],
  "scripts/gates/types/check-jsdoc-types.ts": ["complexity"],
  "scripts/gates/types/check-type-guard-brands.test.ts": ["max-params"],
  "scripts/gates/types/check-type-guard-brands.ts": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "scripts/lib/errors.test.ts": ["max-params"],
  "scripts/lib/testing/child-timeout.ts": ["complexity", "max-lines-per-function"],
  "scripts/lib/text/code-comments.ts": ["max-lines-per-function", "max-params"],
  "scripts/lib/text/code-strings.ts": ["max-lines-per-function", "max-depth"],
  "scripts/mutation/check-mutation-proof.ts": ["complexity", "max-lines-per-function"],
  "scripts/skills/_cross/coverage-record-judge-parity.test.ts": [
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/_cross/guards-brand.test.ts": ["max-params"],
  "scripts/skills/_cross/skill-config.test.ts": [
    "max-params",
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/agent-usage/aggregate.test.ts": [
    "max-params",
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/agent-usage/cli.test.ts": [
    "max-params",
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/agent-usage/github.test.ts": [
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/agent-usage/logs.test.ts": ["max-params"],
  "scripts/skills/aws-architecture-diagram/fetch-aws-icons.test.ts": [
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/aws-architecture-diagram/preview-diagram.test.ts": [
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/box/box-folder.test.ts": ["max-params"],
  "scripts/skills/box/box-token.test.ts": ["max-params"],
  "scripts/skills/golden-dataset/predicate-coverage-check.test.ts": [
    "max-params",
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/kaizen/frontmatter/kaizen-frontmatter-values.test.ts": ["max-params"],
  "scripts/skills/kaizen/kaizen-archive.test.ts": ["max-params"],
  "scripts/skills/kaizen/kaizen-candidate-scan.test.ts": ["max-params"],
  "scripts/skills/kaizen/kaizen-kedb-match.test.ts": ["max-params"],
  "scripts/skills/kaizen/kaizen-precommit-gate.test.ts": ["max-params"],
  "scripts/skills/kaizen/tracking-issue-title.test.ts": [
    "max-params",
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/parity-component/css-rules-capture.test.ts": ["max-params"],
  "scripts/skills/parity-component/motion-probe.test.ts": [
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/parity-diff/amend-verify.test.ts": ["max-params"],
  "scripts/skills/parity-diff/coverage-check.test.ts": [
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/parity-diff/pending-triage-check.test.ts": ["max-params"],
  "scripts/skills/parity-diff/pixel-crops.test.ts": ["max-params"],
  "scripts/skills/parity-suite/checks/artifact-health-check.test.ts": ["max-params"],
  "scripts/skills/parity-suite/checks/capture-scope-check.test.ts": [
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/parity-suite/checks/component-comparison-check.test.ts": ["max-params"],
  "scripts/skills/parity-suite/checks/reaction-check.test.ts": [
    "complexity",
    "max-params",
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/parity-suite/evidence/coverage-expand.test.ts": [
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/parity-suite/evidence/evidence-carry-fixture.ts": ["max-lines-per-function"],
  "scripts/skills/parity-suite/evidence/evidence-carry.test.ts": [
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/parity-suite/evidence/table-upsert.test.ts": ["max-params"],
  "scripts/skills/parity-suite/visual/dimension-fit.test.ts": ["max-params"],
  "scripts/skills/parity-suite/visual/pixel-strict-count-cli.test.ts": ["max-params"],
  "scripts/skills/parity-suite/visual/trait-capture.test.ts": [
    "max-params",
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/parity-suite/visual/trait-compare.test.ts": ["max-params"],
  "scripts/skills/replace-strategy/append-only-check.test.ts": ["max-params"],
  "scripts/skills/replace-strategy/asset-delivery-check.test.ts": [
    "max-params",
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/skills/replace-strategy/markdown-lib.test.ts": ["max-params"],
  "scripts/skills/replace-strategy/procedure-staleness-check.test.ts": [
    "skills-repo/max-lines-per-function-except-describe",
  ],
  "scripts/tools/reinstall-skill.test.ts": ["max-params"],
  "skills/agent-usage/scripts/agent-usage.mjs": ["complexity", "max-lines-per-function"],
  "skills/agent-usage/scripts/lib/collect.mjs": ["complexity", "max-lines-per-function"],
  "skills/agent-usage/scripts/lib/config.mjs": ["complexity", "max-params"],
  "skills/agent-usage/scripts/lib/csv.mjs": ["max-lines-per-function"],
  "skills/agent-usage/scripts/lib/decisions.mjs": ["max-params"],
  "skills/agent-usage/scripts/lib/dedupe.mjs": ["max-lines-per-function"],
  "skills/agent-usage/scripts/lib/gate.mjs": ["complexity", "max-lines-per-function", "max-params"],
  "skills/agent-usage/scripts/lib/merged.mjs": ["max-params"],
  "skills/agent-usage/scripts/lib/report/html.mjs": ["complexity", "max-lines-per-function"],
  "skills/agent-usage/scripts/lib/report/report.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/agent-usage/scripts/lib/run-collect.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/agent-usage/scripts/lib/sources/claude-log.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
  ],
  "skills/agent-usage/scripts/lib/sources/codex-log.mjs": ["complexity", "max-lines-per-function"],
  "skills/agent-usage/scripts/lib/sources/discover.mjs": ["max-params"],
  "skills/agent-usage/scripts/lib/sources/github.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/agent-usage/scripts/lib/sources/timeline.mjs": ["complexity", "max-lines-per-function"],
  "skills/agent-usage/scripts/lib/sources/usage.mjs": ["max-lines-per-function"],
  "skills/agent-usage/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/aws-architecture-diagram/assets/starter/environments.mjs": ["max-lines-per-function"],
  "skills/aws-architecture-diagram/scripts/diagram-engine.mjs": ["max-lines-per-function"],
  "skills/aws-architecture-diagram/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/box/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/browser-test/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/current-environment-bootstrap/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/dependabot-alert-issue/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/dependabot-merge/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/git-worktree/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/golden-dataset/scripts/predicate-coverage-check.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
  ],
  "skills/golden-dataset/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/issue-batch/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/issue-start/scripts/acceptance-check.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/issue-start/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/kaizen/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-component/scripts/axis-diff.mjs": ["complexity", "max-lines-per-function"],
  "skills/parity-component/scripts/behavior-compare.mjs": ["complexity", "max-lines-per-function"],
  "skills/parity-component/scripts/cascade-resolve.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
  ],
  "skills/parity-component/scripts/css-rules-capture.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-component/scripts/lifecycle-check.mjs": ["complexity", "max-lines-per-function"],
  "skills/parity-component/scripts/motion-compare.mjs": ["complexity", "max-lines-per-function"],
  "skills/parity-component/scripts/motion-probe.mjs": ["max-lines-per-function"],
  "skills/parity-component/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-diff/assets/capture-new.spec.template.ts": ["max-lines-per-function"],
  "skills/parity-diff/scripts/amend-verify.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-diff/scripts/coverage-check.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-diff/scripts/diff-normalize.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-diff/scripts/json-normalize-diff.mjs": ["max-params"],
  "skills/parity-diff/scripts/pending-triage-check.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-diff/scripts/pixel-crops.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
    "max-params",
  ],
  "skills/parity-diff/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-replace/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-suite/assets/perf-capture.spec.template.ts": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
  ],
  "skills/parity-suite/scripts/artifact-health-check.mjs": ["complexity", "max-lines-per-function"],
  "skills/parity-suite/scripts/auto-wait-check.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-suite/scripts/capture-scope-check.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
  ],
  "skills/parity-suite/scripts/checkpoint.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-suite/scripts/component-comparison-check.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
  ],
  "skills/parity-suite/scripts/component-impact.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-suite/scripts/coverage-expand.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
    "max-params",
  ],
  "skills/parity-suite/scripts/dimension-fit.mjs": ["complexity", "max-lines-per-function"],
  "skills/parity-suite/scripts/element-shot.mjs": ["complexity", "max-lines-per-function"],
  "skills/parity-suite/scripts/evidence-carry.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-suite/scripts/header-normalize.mjs": ["complexity", "max-lines-per-function"],
  "skills/parity-suite/scripts/page-identity.mjs": ["complexity", "max-lines-per-function"],
  "skills/parity-suite/scripts/perf-stats.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-suite/scripts/pixel-strict-count.mjs": ["max-lines-per-function", "max-params"],
  "skills/parity-suite/scripts/reaction-check.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
    "max-params",
  ],
  "skills/parity-suite/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-suite/scripts/table-upsert.mjs": ["complexity", "max-lines-per-function"],
  "skills/parity-suite/scripts/trait-capture.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/parity-suite/scripts/trait-compare.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/pr-finalize-loop/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/pr-review-handle/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/replace-strategy/scripts/append-only-check.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
    "max-params",
  ],
  "skills/replace-strategy/scripts/asset-delivery-check.mjs": [
    "complexity",
    "max-lines-per-function",
  ],
  "skills/replace-strategy/scripts/asset-probe.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-depth",
    "max-params",
  ],
  "skills/replace-strategy/scripts/evidence-gap-check.mjs": [
    "complexity",
    "max-lines-per-function",
  ],
  "skills/replace-strategy/scripts/pending-decisions-check.mjs": [
    "complexity",
    "max-lines-per-function",
  ],
  "skills/replace-strategy/scripts/procedure-staleness-check.mjs": [
    "complexity",
    "max-lines-per-function",
  ],
  "skills/replace-strategy/scripts/role-probe.mjs": ["max-lines-per-function"],
  "skills/replace-strategy/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
  ],
  "skills/writing-style/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
    "max-params",
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
 * 一覧に無い違反（直さずに一覧から消した組と、新しい違反）。violations は一覧を外して実行した oxlint の違反で、
 * 一覧で外せるルール（PENDING_RULES）の違反だけを数える。
 */
export function unlistedViolations(
  pending: Readonly<Record<string, readonly PendingRule[]>>,
  violations: readonly { file: string; rule: string; line: number }[],
): { file: string; rule: string; line: number }[] {
  const rules: readonly string[] = PENDING_RULES;
  return violations.filter(
    (v) => rules.includes(v.rule) && !(pending[v.file] ?? []).some((r) => r === v.rule),
  );
}
