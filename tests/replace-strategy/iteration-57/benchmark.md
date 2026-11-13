# Skill Benchmark: replace-strategy

**Model**: claude-code / opus / high
**Date**: 2026-11-13
**Evals**: 1（`with_skill` を 1 run）

## 目的

Issue #1007 で、`references/features-issues.md` の `spec-parity` 用の受け入れ条件の文に、操作中のエラーを許容か環境ノイズとした承認の記録を足した。
eval 42 の 3 つ目の assertion（`reachability` の同じ文を含む）を同じ文に直したので、既存の eval として `with_skill` を 1 run 実行した。

## Summary

| eval | with_skill |
| --- | --- |
| 42 | 5/5 |

文を変えた 3 つ目の assertion は、前回の記録と比べない。ほかの 4 つは前回（iteration-54 の with_skill）と同じ合否である。
