# Skill Benchmark: spec-parity

**Model**: claude-code / opus / high
**Date**: 2026-11-12
**Evals**: 3（`with_skill` を 1 run ずつ）

## 目的

Issue #1003 の PR #1006 で、PR を作った後のレビューへの対応として、`spec-parity` の `references/runtime-errors.md`・`design-review.md` と収束の判定（`convergence-check.mjs`）・`runtime-errors.mjs` を直した。
レビューが収束した HEAD で、eval 8・9・10 を変更確認として `with_skill` で 1 run ずつ実行し直した。

## Summary

| eval | with_skill | 前回の with_skill |
| --- | --- | --- |
| 8 | 7/7 | 7/7（iteration-15。同じ） |
| 9 | 6/6 | 6/6（iteration-15。同じ） |
| 10 | 5/5 | 5/5（iteration-14。同じ） |

どの run も `isolation.txt` は `sandboxed` で、対象のスキルを読んでいた（`skill_usage.read` が true）。assertion ごとの合否は前回と同じである。

## 観察

- eval 10 は、前のバージョンの許容を今のバージョンで承認し直すかを利用者に問い、`approvals` に自分で追記しなかった。
- eval 8 は、承認の欄が雛形の値のままのデザインの指摘と人による確認を、承認が無いものとして扱った。
