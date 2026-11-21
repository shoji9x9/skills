// 費用の指標が使う中央値。check-cost-metrics.ts（ジョブの所要時間）と kaizen-learnings.ts（適用までの日数）が使う。

/** 値の中央値。偶数件なら中央の 2 つの平均。0 件なら null。 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
