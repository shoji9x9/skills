# Skill Benchmark: dependabot-merge

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-15
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #616 で、Dependabot が major の更新の PR を作るようにした。
`SKILL.md` に major の更新の扱い（破壊的な変更を使っている箇所に当て、当たればマージせずに確認する）を足し、それを確かめる eval 10 を新しく足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 10 | 新規 | 10/10 | 7/10 | - |

with_skill の平均 pass_rate は 1.00、without_skill は 0.70。

`without_skill` が落としたのは次の 3 つで、どれもスキルの取り決めに固有のものである。

- 使っている箇所に当たる破壊的な変更があれば、必要な修正を PR コメントに書く
- マージ方式を `.config/skills/shoji9x9/skills.yml` の `merge_method`（無ければ squash）から決める
- 判断の根拠を PR コメントに記録する

残りの 7 つは、major の更新を慎重に扱う一般的な方針で `without_skill` も満たした。後退を検出するための assertion である。

## 前回より下がった eval の切り分け

- 無し

## 集計から外したもの

- 無し
