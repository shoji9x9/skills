// evals.json の eval が持つ `split` の値（docs/skill-development.md「改善に使うケースと判定に使うケース」）。
// improve は、失敗を読んでスキルを直すのに使うケース。judge は、直した後に退行が無いかを確かめるだけに使うケースである。
// 書いていない eval は improve として扱う。分け直していない既存の eval が、判定のケースとして数えられないようにするためである。
// evals.json のチェック（check-eval-reachability.ts）・eval_metadata.json の書き出し・集計が、同じ語彙を使う。
const EVAL_SPLITS = ["improve", "judge"] as const;
export type EvalSplit = (typeof EVAL_SPLITS)[number];
export const DEFAULT_EVAL_SPLIT: EvalSplit = "improve";

/** 値が split の語彙に入るかを返す。 */
export function isEvalSplit(value: unknown): value is EvalSplit {
  return EVAL_SPLITS.some((split) => split === value);
}

/**
 * eval の `split` を読む。書いていなければ improve を返す。
 * @returns 語彙の値。書いてあるのに語彙に無いときは null（呼び出し元が違反として扱う）
 */
export function evalSplitOf(ev: Record<string, unknown>): EvalSplit | null {
  if (!Object.hasOwn(ev, "split")) return DEFAULT_EVAL_SPLIT;
  return isEvalSplit(ev.split) ? ev.split : null;
}

/** 語彙に無い split の値を報告する文。evals.json・eval_metadata.json のどちらを読む側も、同じ文で報告する。 */
export function invalidSplitMessage(value: unknown): string {
  return `split が ${EVAL_SPLITS.join(" か ")} でない: ${JSON.stringify(value)}`;
}
