# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-21
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #734（Issue #725）のレビューで、Kaizen の記録のレビューの手順を直した。
順序を実装の commit・記録のレビュー・記録の commit と明記し、レビューの範囲は記録だけに絞らず、記録の差分が含まれることを確かめる形にした。

eval 29 の記録のレビューの assertion を、この手順に合わせて「実装の commit の後・記録の commit の前に、記録の差分を含めてレビューする」に直した。入力が変わったのはこの eval だけである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 29 | assertion | 7/7 | 5/7 | iteration-24 で 7/7（記録のレビューの assertion が違う） |

without_skill は、記録を commit した後にその commit をレビューすると答え、記録の commit の前にレビューしなかった。
範囲は出力のファイル名と `git diff` の一覧で確かめると答えたが、指摘の件数で判断しないことには触れなかった。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し（iteration-24 は assertion を直す前の記録として残す）

## 集計から外したもの

- 無し
