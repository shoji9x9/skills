# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-21
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #734（Issue #725）の 3 回目のレビューで、eval 29 の範囲の確かめ方の assertion から、prompt が引き出さない「指摘の件数では判断しない」を外した。
`expected_output` の記録のレビューの文も、手順（記録の差分を含む範囲をレビューし、範囲に記録の差分が含まれることを確かめる）に合わせた。
入力が変わったのはこの eval だけである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 29 | assertion | 7/7 | 5/7 | iteration-25 で 7/7（範囲の確かめ方の assertion が違う） |

without_skill は、レビュー結果に出るファイルと行を `git diff --numstat` と照らし合わせると答え、出力が示すレビューの範囲（比べた base か commit）では確かめなかった。
記録は commit した後にその commit をレビューすると答え、記録の commit の前にレビューしなかった。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し（iteration-24・iteration-25 は assertion を直す前の記録として残す）

## 集計から外したもの

- 無し
