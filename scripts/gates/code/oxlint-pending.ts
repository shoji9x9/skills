// 関数の大きさのルール（oxlint.config.ts）を有効にしたときに既にあった違反のうち、後で直すもの（Issue #658）。
// 一覧が空でも、仕組みは残す。関数の大きさのルールを足したり厳しくしたりして、既存の違反をすぐに直せないときに使う。
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

export const PENDING_FIXES: Readonly<Record<string, readonly PendingRule[]>> = {};

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
