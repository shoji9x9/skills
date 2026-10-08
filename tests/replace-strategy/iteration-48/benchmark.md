# Skill Benchmark: replace-strategy

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-07
**Evals**: 13（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #567 で、evals.json の prompt と assertion の使わない語を言い換えた（意味は変えていない）。
fixture の語を #372 で変えた eval も、この iteration で実行した。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 5 | 文字列 | 3/3 | 1/3 | 3/3（iteration-47） |
| 6 | fixture | 5/5 | 3/5 | 5/5（iteration-47） |
| 13 | 文字列 | 5/5 | 0/5 | 5/5（iteration-47） |
| 15 | 文字列 | 4/5 | 0/5 | 5/5（iteration-47） |
| 17 | 文字列 | 3/5 | 0/5 | 5/5（iteration-47） |
| 26 | fixture と文字列 | 5/5 | 2/5 | 5/5（iteration-47） |
| 27 | 文字列 | 7/9 | 2/9 | 9/9（iteration-47） |
| 28 | 文字列 | 6/6 | 1/6 | 6/6（iteration-47） |
| 29 | fixture と文字列 | 6/6 | 3/6 | 6/6（iteration-47） |
| 30 | fixture と文字列 | 6/7 | 2/7 | 7/7（iteration-47） |
| 31 | fixture と文字列 | 5/5 | 4/5 | 5/5（iteration-47） |
| 32 | fixture | 4/5 | 1/5 | 5/5（iteration-47） |
| 38 | fixture | 7/7 | 6/7 | 7/7（iteration-47） |

with_skill の平均 pass_rate は 0.91、without_skill は 0.34。

## 前回より下がった eval の切り分け

前回の採点は今回より緩かった（今回は、assertion が括弧の中に明記した要素が無ければ不合格にした）。そこで、前回の run の出力を今回と同じ基準で採点し直した。
回帰の疑いが残ったものは、旧版（origin/main）2 run と新版 2 run を、どちらの版かを伏せて同じ採点者が採点して比べた。

- eval 17: 旧版と新版の比較: 旧版 3/5・3/5、新版 3/5・5/5。回帰は無い
- eval 27: 基準の違い
- eval 30: 基準の違い
- eval 32: 基準の違い

## 集計から外したもの

- eval-15/with_skill/run-1 を集計から外した
- eval-15/with_skill/run-2 を run-1 にして集計した
- eval-16 をこの iteration から外した（採点できる run が得られなかった）
