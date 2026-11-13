# Skill Benchmark: spec-parity

**Model**: claude-code / opus / high
**Date**: 2026-11-13
**Evals**: 3（`with_skill` を 1 run ずつ）

## 目的

Issue #1007 の PR #1009 で、`spec-parity` の収束の判定（`convergence-check.mjs`）が環境ノイズも承認の記録（`approvals`）と照合するようにした。
eval 8・9・10 の fixture の `setup.sh` はコメントだけが変わった。既存の eval なので、変更確認として `with_skill` を 1 run ずつ実行した。

## Summary

| eval | with_skill | 前回の with_skill |
| --- | --- | --- |
| 8 | 7/7 | 7/7（iteration-16。同じ） |
| 9 | 6/6 | 6/6（iteration-16。同じ） |
| 10 | 5/5 | 5/5（iteration-16。同じ） |

assertion ごとの合否は前回と同じである。新しい eval 11 は、configuration の組が違うので iteration-18 に分けた。
