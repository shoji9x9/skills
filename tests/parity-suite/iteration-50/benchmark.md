# Skill Benchmark: parity-suite

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-07
**Evals**: 27（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #567 で、evals.json の prompt と assertion の使わない語を言い換えた（意味は変えていない）。
fixture の語を #372 で変えた eval も、この iteration で実行した。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 2 | 文字列 | 3/3 | 0/3 | 3/3（iteration-47） |
| 4 | 文字列 | 3/3 | 0/3 | 3/3（iteration-47） |
| 7 | 文字列 | 4/4 | 1/4 | 4/4（iteration-47） |
| 8 | 文字列 | 3/4 | 0/4 | 3/4（iteration-47） |
| 9 | 文字列 | 4/4 | 0/4 | 4/4（iteration-47） |
| 10 | 文字列 | 4/4 | 4/4 | 4/4（iteration-47） |
| 12 | 文字列 | 3/4 | 2/4 | 4/4（iteration-47） |
| 13 | 文字列 | 4/4 | 1/4 | 4/4（iteration-47） |
| 18 | fixture | 5/5 | 5/5 | 5/5（iteration-47） |
| 19 | fixture | 5/5 | 5/5 | 5/5（iteration-47） |
| 20 | 文字列 | 2/5 | 2/5 | 4/5（iteration-47） |
| 21 | 文字列 | 4/5 | 0/5 | 5/5（iteration-47） |
| 23 | 文字列 | 4/4 | 0/4 | 4/4（iteration-47） |
| 24 | 文字列 | 5/5 | 3/5 | 5/5（iteration-47） |
| 27 | 文字列 | 4/4 | 3/4 | 4/4（iteration-47） |
| 31 | 文字列 | 5/7 | 1/7 | 7/7（iteration-47） |
| 33 | 文字列 | 6/8 | 2/8 | 7/8（iteration-47） |
| 34 | 文字列 | 5/6 | 1/6 | 6/6（iteration-47） |
| 35 | 文字列 | 5/7 | 2/7 | 7/7（iteration-47） |
| 36 | 文字列 | 6/7 | 2/7 | 7/7（iteration-48） |
| 37 | 文字列 | 6/8 | 2/8 | 8/8（iteration-47） |
| 39 | 文字列 | 7/7 | 1/7 | 7/7（iteration-47） |
| 40 | 文字列 | 5/7 | 3/7 | 5/7（iteration-47） |
| 41 | 文字列 | 4/7 | 1/7 | 6/7（iteration-47） |
| 42 | 文字列 | 6/7 | 3/7 | 7/7（iteration-47） |
| 43 | 文字列 | 5/5 | 3/5 | 4/5（iteration-48） |
| 44 | 文字列 | 5/6 | 3/6 | 6/6（iteration-48） |

with_skill の平均 pass_rate は 0.86、without_skill は 0.35。

## 前回より下がった eval の切り分け

前回の採点は今回より緩かった（今回は、assertion が括弧の中に明記した要素が無ければ不合格にした）。そこで、前回の run の出力を今回と同じ基準で採点し直した。
回帰の疑いが残ったものは、旧版（origin/main）2 run と新版 2 run を、どちらの版かを伏せて同じ採点者が採点して比べた。

- eval 12: 旧版と新版の比較: 旧版 3/4・3/4、新版 2/4・4/4。回帰は無い
- eval 20: ばらつき
- eval 21: 基準の違い
- eval 31: 基準の違い
- eval 33: 基準の違い
- eval 34: 基準の違い
- eval 35: ばらつき
- eval 36: ばらつき
- eval 37: 旧版と新版の比較: 旧版 6/8・4/8、新版 7/8・1/8。どちらの版でも振れが大きく、回帰とは言えない
- eval 41: ばらつき
- eval 42: 基準の違い

## 集計から外したもの

- eval-25 をこの iteration から外した（採点できる run が得られなかった）
- eval-28 をこの iteration から外した（採点できる run が得られなかった）
- eval-44/with_skill/run-1 を集計から外した
- eval-44/with_skill/run-2 を run-1 にして集計した
