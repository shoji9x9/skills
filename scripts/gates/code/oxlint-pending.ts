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
  "skills/parity-component/scripts/skill-config/skill-config.mjs": [
    "complexity",
    "max-lines-per-function",
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
 * 一覧で外していない違反（直さずに一覧から消した組と、それ以外のすべての違反）。violations は一覧を外して実行した oxlint の違反。
 * ルールに依らず数える。設定やプラグインを厳しくした commit で、staged でないファイルに出た違反も見つけるためである。
 */
export function unlistedViolations(
  pending: Readonly<Record<string, readonly PendingRule[]>>,
  violations: readonly { file: string; rule: string; line: number }[],
): { file: string; rule: string; line: number }[] {
  return violations.filter((v) => !(pending[v.file] ?? []).some((r) => r === v.rule));
}
