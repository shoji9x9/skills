// behavior-compare と motion-compare のテストが共有する、突き合わせ表（lib/comparison.mjs が読む）のヘルパー。
import { expect } from "vitest";

/** オブジェクトでない突き合わせ表と、報告に書く値の型の組。 */
export const NON_OBJECT_COMPARISONS: [string, unknown, string][] = [
  ["文字列", "x", "string"],
  ["配列", [], "配列"],
];

/** 突き合わせ表がオブジェクトでないとき、値の型を書いて target と component の不一致を報告したかを確かめる。 */
export function expectNonObjectComparison(findings: unknown[], kind: string) {
  for (const code of ["comparison-target-mismatch", "comparison-component-mismatch"]) {
    expect(findings).toContainEqual(
      expect.objectContaining({ code, detail: `突き合わせ表がオブジェクトでない（${kind}）` }),
    );
  }
}
