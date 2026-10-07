# Skill Benchmark: dependabot-alert-issue

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-07
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #567 で、evals.json の prompt と assertion の使わない語を言い換えた（意味は変えていない）。
fixture の語を #372 で変えた eval も、この iteration で実行した。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 9 | 文字列 | 5/6 | 0/6 | - |

with_skill の平均 pass_rate は 0.83、without_skill は 0.00。

## 前回より下がった eval の切り分け

- 無し

## 集計から外したもの

- 無し
