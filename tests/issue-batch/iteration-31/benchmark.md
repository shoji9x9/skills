# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-29
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #823 で、ローカルレビューの上限（`max_local_review_iterations`）を、push の前に手元でレビューする回数の上限にした。
最初のレビューも 1 回に数え、上限に達した後の直しは、手元でレビューせずに `pr-finalize-loop` のレビューに任せる。
eval 8 の assertion「妥当な指摘だけ修正し、検証後に上限内で再レビューする」を、この取り決めに合わせて書き換え、`reachability` を足した。入力が変わったのはこの eval だけである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 8 | assertion（1 本） | 4/4 | 0/4 | iteration-3 で 4/4（書き換えた 1 本は前の文） |

with_skill は、上限 1 なので直した分は手元でレビューし直さず、`unreviewed_range` を記録して PR のレビューに任せると答えた。
without_skill は、再レビューしないとは答えたが、直した変更を `pr-finalize-loop` に任せるとは答えず、残った指摘を Kaizen と PR の本文に引き継ぐとした。
