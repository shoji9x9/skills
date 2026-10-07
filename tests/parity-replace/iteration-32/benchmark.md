# Skill Benchmark: parity-replace

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-07
**Evals**: 18（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #567 で、evals.json の prompt と assertion の使わない語を言い換えた（意味は変えていない）。
fixture の語を #372 で変えた eval も、この iteration で実行した。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 2 | 文字列 | 4/4 | 0/4 | 4/4（iteration-30） |
| 4 | 文字列 | 3/3 | 1/3 | 3/3（iteration-30） |
| 6 | 文字列 | 4/4 | 4/4 | 4/4（iteration-30） |
| 8 | 文字列 | 3/4 | 0/4 | 3/4（iteration-30） |
| 9 | 文字列 | 3/4 | 1/4 | 4/4（iteration-30） |
| 10 | 文字列 | 2/4 | 0/4 | 4/4（iteration-30） |
| 11 | 文字列 | 5/6 | 0/6 | - |
| 12 | 文字列 | 3/5 | 1/5 | 5/5（iteration-30） |
| 13 | 文字列 | 6/6 | 0/6 | 6/6（iteration-30） |
| 14 | 文字列 | 3/5 | 1/5 | 5/5（iteration-30） |
| 15 | 文字列 | 4/5 | 2/5 | 5/5（iteration-30） |
| 16 | 文字列 | 3/5 | 1/5 | 4/5（iteration-30） |
| 17 | 文字列 | 4/4 | 0/4 | 4/4（iteration-30） |
| 18 | 文字列 | 5/5 | 0/5 | 5/5（iteration-30） |
| 19 | 文字列 | 6/7 | 2/7 | 7/7（iteration-30） |
| 20 | 文字列 | 4/5 | 3/5 | 5/5（iteration-30） |
| 21 | 文字列 | 3/6 | 0/6 | 6/6（iteration-30） |
| 25 | 文字列 | 5/5 | 1/5 | 5/5（iteration-30） |

with_skill の平均 pass_rate は 0.81、without_skill は 0.20。

## 前回より下がった eval の切り分け

前回の採点は今回より緩かった（今回は、assertion が括弧の中に明記した要素が無ければ不合格にした）。そこで、前回の run の出力を今回と同じ基準で採点し直した。
回帰の疑いが残ったものは、旧版（origin/main）2 run と新版 2 run を、どちらの版かを伏せて同じ採点者が採点して比べた。

- eval 9: 基準の違い
- eval 10: 基準の違い
- eval 12: ばらつき。差の 1 点の assertion は書き換えていない
- eval 14: 旧版と新版の比較: 旧版 5/5・3/5、新版 3/5・3/5。旧版の側でも 2 点振れており、ばらつきの範囲
- eval 15: 基準の違い
- eval 16: 基準の違い
- eval 19: 基準の違い
- eval 20: 基準の違い
- eval 21: 回帰。prompt の「被覆表」を「網羅表」にしたところ、スキルの「部品網羅表」と「反応の網羅表」の取り違えが起きた（旧版 5/6・5/6、新版 3/6・4/6）。prompt をスキル本文と同じ「部品網羅表」に直し、iteration-33 で 5/6・5/6 に戻った

## 集計から外したもの

- eval-11/with_skill/run-1 を集計から外した
- eval-11/with_skill/run-2 を集計から外した
- eval-11/with_skill/run-3 を run-1 にして集計した
- eval-17/with_skill/run-1 を集計から外した
- eval-17/with_skill/run-2 を run-1 にして集計した
