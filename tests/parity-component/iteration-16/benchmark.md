# Skill Benchmark: parity-component

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-07
**Evals**: 8（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #567 で、evals.json の prompt と assertion の使わない語を言い換えた（意味は変えていない）。
fixture の語を #372 で変えた eval も、この iteration で実行した。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 2 | fixture | 6/6 | 3/6 | 6/6（iteration-13） |
| 3 | fixture と文字列 | 4/4 | 3/4 | 4/4（iteration-13） |
| 4 | fixture と文字列 | 2/5 | 4/5 | 4/5（iteration-13） |
| 5 | fixture と文字列 | 6/6 | 3/6 | 6/6（iteration-13） |
| 6 | fixture | 5/5 | 3/5 | 5/5（iteration-13） |
| 7 | fixture | 8/8 | 8/8 | 8/8（iteration-13） |
| 8 | fixture | 10/11 | 4/11 | 10/11（iteration-14） |
| 9 | fixture | 10/11 | 3/11 | 11/11（iteration-15） |

with_skill の平均 pass_rate は 0.90、without_skill は 0.60。

## 前回より下がった eval の切り分け

前回の採点は今回より緩かった（今回は、assertion が括弧の中に明記した要素が無ければ不合格にした）。そこで、前回の run の出力を今回と同じ基準で採点し直した。
回帰の疑いが残ったものは、旧版（origin/main）2 run と新版 2 run を、どちらの版かを伏せて同じ採点者が採点して比べた。

- eval 4: 基準の違い。前回の出力も今回の基準では 2/5（姉妹スキルが fixture に無く、前提確認で止まる）
- eval 9: 基準の違い。前回の出力も今回の基準では 10/11

## 集計から外したもの

- 無し
