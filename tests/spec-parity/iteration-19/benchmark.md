# Skill Benchmark: spec-parity

**Model**: claude-code / opus / high
**Date**: 2026-11-13
**Evals**: 4（`with_skill` を 1 run ずつ）

## 目的

Issue #1007 の PR #1009 で、PR を作った後のレビューへの対応として、収束の判定（`convergence-check.mjs`・`runtime-errors.mjs`）と文書を直した。
レビューが収束した HEAD で、eval 8・9・10・11 を変更確認として `with_skill` で 1 run ずつ実行し直した。

## Summary

| eval | with_skill | 前回の with_skill |
| --- | --- | --- |
| 8 | 7/7 | 7/7（iteration-17。同じ） |
| 9 | 6/6 | 6/6（iteration-17。同じ） |
| 10 | 5/5 | 5/5（iteration-17。同じ） |
| 11 | 5/5 | 5/5（iteration-18。同じ） |

assertion ごとの合否は前回と同じである。
