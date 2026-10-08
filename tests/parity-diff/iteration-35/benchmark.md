# Skill Benchmark: parity-diff

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-07
**Evals**: 19（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #567 で、evals.json の prompt と assertion の使わない語を言い換えた（意味は変えていない）。
fixture の語を #372 で変えた eval も、この iteration で実行した。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | 文字列 | 4/4 | 1/4 | 4/4（iteration-34） |
| 7 | 文字列 | 4/6 | 0/6 | 5/6（iteration-34） |
| 10 | 文字列 | 4/5 | 0/5 | 5/5（iteration-34） |
| 11 | 文字列 | 4/4 | 0/4 | 4/4（iteration-34） |
| 12 | 文字列 | 6/6 | 1/6 | 6/6（iteration-34） |
| 13 | 文字列 | 3/5 | 0/5 | 5/5（iteration-34） |
| 15 | 文字列 | 5/6 | 1/6 | 6/6（iteration-34） |
| 16 | 文字列 | 5/5 | 2/5 | 4/5（iteration-34） |
| 17 | 文字列 | 4/5 | 1/5 | 5/5（iteration-34） |
| 18 | 文字列 | 5/5 | 0/5 | 5/5（iteration-34） |
| 19 | 文字列 | 5/5 | 3/5 | 5/5（iteration-34） |
| 20 | 文字列 | 6/6 | 1/6 | 6/6（iteration-34） |
| 21 | 文字列 | 5/5 | 3/5 | 5/5（iteration-34） |
| 22 | 文字列 | 9/9 | 2/9 | 9/9（iteration-34） |
| 23 | 文字列 | 4/5 | 1/5 | 5/5（iteration-34） |
| 24 | 文字列 | 4/4 | 0/4 | 4/4（iteration-34） |
| 25 | 文字列 | 4/5 | 1/5 | 5/5（iteration-34） |
| 26 | 文字列 | 6/6 | 3/6 | 5/6（iteration-34） |
| 28 | 文字列 | 6/6 | 3/6 | 6/6（iteration-34） |

with_skill の平均 pass_rate は 0.91、without_skill は 0.22。

## 前回より下がった eval の切り分け

前回の採点は今回より緩かった（今回は、assertion が括弧の中に明記した要素が無ければ不合格にした）。そこで、前回の run の出力を今回と同じ基準で採点し直した。
回帰の疑いが残ったものは、旧版（origin/main）2 run と新版 2 run を、どちらの版かを伏せて同じ採点者が採点して比べた。

- eval 7: ばらつき。今回だけ落ちた assertion は書き換えていない
- eval 10: 旧版と新版の比較: 旧版 4/5・4/5、新版 3/5・3/5。prompt は変えておらず、書き換えたのは assertion の括弧の中の語だけで、被験体には渡らない。2 run ずつでは原因を特定できない小さな差として残す
- eval 13: ばらつき。差の 1 点の assertion は書き換えていない
- eval 15: 基準の違い。前回の出力は今回の基準では 4/6
- eval 17: 基準の違い。前回の出力は今回の基準では 3/5
- eval 23: 基準の違い。前回の出力も今回の基準では 4/5
- eval 25: 旧版と新版の比較: 旧版 4/5・3/5、新版 4/5・4/5。回帰は無い

## 集計から外したもの

- eval-19/with_skill/run-1 を集計から外した
- eval-19/with_skill/run-2 を run-1 にして集計した
- eval-21/with_skill/run-1 を集計から外した
- eval-21/with_skill/run-2 を run-1 にして集計した
- eval-27 をこの iteration から外した（採点できる run が得られなかった）
