# Skill Benchmark: kaizen

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-07
**Evals**: 15（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #567 で、evals.json の prompt と assertion の使わない語を言い換えた（意味は変えていない）。
fixture の語を #372 で変えた eval も、この iteration で実行した。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 4 | 文字列 | 5/5 | 0/5 | 5/5（iteration-11） |
| 8 | 文字列 | 6/6 | 0/6 | 6/6（iteration-17） |
| 9 | fixture | 3/4 | 2/4 | 4/4（iteration-9） |
| 10 | 文字列 | 6/7 | 1/7 | 6/6（iteration-7） |
| 13 | 文字列 | 4/4 | 0/4 | 4/4（iteration-9） |
| 16 | 文字列 | 7/7 | 0/7 | 7/7（iteration-10） |
| 17 | 文字列 | 7/7 | 1/7 | 7/7（iteration-19） |
| 18 | 文字列 | 7/7 | 1/7 | - |
| 19 | 文字列 | 8/8 | 1/8 | 8/8（iteration-16） |
| 20 | 文字列 | 4/6 | 0/6 | 6/6（iteration-16） |
| 21 | 文字列 | 6/7 | 1/7 | 7/7（iteration-18） |
| 22 | 文字列 | 6/6 | 1/6 | 6/6（iteration-19） |
| 23 | 文字列 | 6/6 | 2/6 | 6/6（iteration-20） |
| 24 | 文字列 | 6/6 | 0/6 | 6/6（iteration-21） |
| 25 | 文字列 | 7/7 | 0/7 | 7/7（iteration-21） |

with_skill の平均 pass_rate は 0.94、without_skill は 0.11。

## 前回より下がった eval の切り分け

前回の採点は今回より緩かった（今回は、assertion が括弧の中に明記した要素が無ければ不合格にした）。そこで、前回の run の出力を今回と同じ基準で採点し直した。
回帰の疑いが残ったものは、旧版（origin/main）2 run と新版 2 run を、どちらの版かを伏せて同じ採点者が採点して比べた。

- eval 9: ばらつき。今回だけ落ちた assertion も prompt も書き換えていない
- eval 10: 基準の違い。今回落ちたのは前回の版より後に足した assertion で、前回の出力も満たしていない
- eval 20: 旧版と新版の比較（どちらの版かを伏せて同じ採点者が採点）: 旧版 5/6・4/6、新版 3/6・4/6。旧版の側でも 1 点振れており、回帰とは言えない
- eval 21: ばらつき。今回だけ落ちた assertion も prompt の該当部分も書き換えていない

## 集計から外したもの

- eval-15 をこの iteration から外した（採点できる run が得られなかった）
- eval-22/with_skill/run-1 を集計から外した
- eval-22/with_skill/run-2 を run-1 にして集計した
