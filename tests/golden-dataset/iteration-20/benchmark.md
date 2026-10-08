# Skill Benchmark: golden-dataset

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-07
**Evals**: 13（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #567 で、evals.json の prompt と assertion の使わない語を言い換えた（意味は変えていない）。
fixture の語を #372 で変えた eval も、この iteration で実行した。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 2 | 文字列 | 4/4 | 1/4 | 4/4（iteration-19） |
| 4 | 文字列 | 3/3 | 0/3 | 3/3（iteration-19） |
| 6 | 文字列 | 4/4 | 4/4 | 4/4（iteration-19） |
| 8 | fixture | 5/9 | 5/9 | 4/9（iteration-19） |
| 9 | 文字列 | 4/4 | 0/4 | 4/4（iteration-19） |
| 10 | 文字列 | 2/4 | 0/4 | 3/4（iteration-19） |
| 12 | 文字列 | 4/4 | 2/4 | 4/4（iteration-19） |
| 13 | fixture | 3/5 | 1/5 | 3/5（iteration-19） |
| 14 | 文字列 | 4/4 | 1/4 | 4/4（iteration-19） |
| 16 | 文字列 | 3/3 | 1/3 | 2/3（iteration-19） |
| 19 | 文字列 | 5/6 | 2/6 | 6/6（iteration-19） |
| 20 | 文字列 | 5/6 | 2/6 | 5/6（iteration-19） |
| 22 | 文字列 | 6/6 | 1/6 | 6/6（iteration-19） |

with_skill の平均 pass_rate は 0.87、without_skill は 0.30。

## 前回より下がった eval の切り分け

前回の採点は今回より緩かった（今回は、assertion が括弧の中に明記した要素が無ければ不合格にした）。そこで、前回の run の出力を今回と同じ基準で採点し直した。
回帰の疑いが残ったものは、旧版（origin/main）2 run と新版 2 run を、どちらの版かを伏せて同じ採点者が採点して比べた。

- eval 10: 基準の違い。前回の出力は今回の基準では 1/4
- eval 19: 基準の違い。前回の出力も今回の基準では 5/6

## 集計から外したもの

- 無し
