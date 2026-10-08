# Skill Benchmark: issue-start

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-07
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #567 で、evals.json の prompt と assertion の使わない語を言い換えた（意味は変えていない）。
fixture の語を #372 で変えた eval も、この iteration で実行した。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 14 | 文字列 | 5/6 | 2/6 | 6/6（iteration-15） |
| 17 | 文字列 | 4/5 | 3/5 | 5/5（iteration-18） |

with_skill の平均 pass_rate は 0.82、without_skill は 0.47。

## 前回より下がった eval の切り分け

前回の採点は今回より緩かった（今回は、assertion が括弧の中に明記した要素が無ければ不合格にした）。そこで、前回の run の出力を今回と同じ基準で採点し直した。
回帰の疑いが残ったものは、旧版（origin/main）2 run と新版 2 run を、どちらの版かを伏せて同じ採点者が採点して比べた。

- eval 14: ばらつき。今回だけ落ちた assertion（gh api search/issues の名前）も prompt も書き換えていない
- eval 17: 基準の違い。前回の出力も今回の基準では 4/5

## 集計から外したもの

- 無し
