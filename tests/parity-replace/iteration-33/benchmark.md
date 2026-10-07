# Skill Benchmark: parity-replace

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-07
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #567 で、eval 21 の prompt の「網羅表」を、スキル本文と同じ「部品網羅表」に直した（iteration-32 で起きた取り違えへの対処）。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 21 | 文字列 | 5/6 | 0/6 | 3/6（iteration-32） |

with_skill の平均 pass_rate は 0.83、without_skill は 0.00。

## 前回より下がった eval の切り分け

- iteration-32 の eval 21 の取り違えは、この iteration で解消した

## 集計から外したもの

- eval-21/with_skill/run-2 を集計から外した
