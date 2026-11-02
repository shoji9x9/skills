# Skill Benchmark: agent-usage

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-14
**Evals**: 3（`with_skill` と `without_skill` を 1 run ずつ）

## 記録の経緯

Issue #625（PR #703）の作業中に実行した変更確認の記録である。
run と採点は手元に残っていたが、`benchmark.json` を作っておらず、commit されていなかった。
Issue #705 で、残っていた `grading.json` から `build-skill-eval-benchmark.ts` で集計した。
このときに何を変えたかの説明は残っていない。

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 1 | 4/5 | 1/5 |
| 2 | 4/5 | 0/5 |
| 3 | 4/4 | 1/4 |

## with_skill で満たさなかった assertion

- eval 1: 利用者に確かめられない無人の実行では、記録しない側を選ばずに止まって報告すると答えている
- eval 2: gh が無い・認証できない・取得に失敗した期間も判定不能になり、collect の出力に失敗した段が出ると説明している
