# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-21
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #725 で、Kaizen の記録を、実装を commit した後・記録を commit する前に、記録の差分だけのローカルレビューにかける手順を `references/orchestration.md`「Kaizen、commit、PR」に足した。

eval 29 を足した。#688 で変えた点（再開した Issue で base branch との差分もレビューする、出力の範囲で対象に当たったことを確かめて確かめられなければ BLOCKED にする、変更が 0 行かを push 済みの commit も含めて取得し直した `origin/main` と比べて数える）と、今回の Kaizen の記録のレビューを検査する。
入力が変わったのはこの eval だけである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 29 | 新しく足した | 7/7 | 5/7 | 無し（新しい eval） |

without_skill は、レビューを `origin/main` との branch 全体の 1 つにまとめ、commit していない差分のレビューと base branch との差分のレビューを分けなかった。
範囲は出力の 1 行目で確かめると答えたが、指摘の件数で判断しないことには触れなかった。
`origin/main` と比べること、push 済みの commit を数えること、記録の commit だけをレビューすることは、prompt の事実から自力で答えた。

## #688 の変更を元に戻した版との比較

Issue #688（PR #720）の `skills/issue-batch` の変更を逆に当てた版で、eval 29 を `with_skill` で 1 run 実行した。結果は 3/7 だった。
push 済みの 2 commit をレビューの対象外とし、変更の行数を HEAD と比べて数え、`origin/main` とは比べないと答えた。
base branch との差分のレビュー・出力の範囲で確かめること・push 済みの commit を数えること・`origin/main` と比べることの 4 本が失敗した。
この run は iteration に入れていない。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
