# Skill Benchmark: issue-start

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-12
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #1000 の 2 回目のレビューの指摘（定義の表で決められない変更の分岐に eval が無い）への対応である。
定義はあるが、変更が表のどの行にも当たらない場合を eval 24 として足した。

## 入力の変更

- eval 24 を足した。fixture は eval 21 と同じ `breaking-change-doc` を使う。変更は「金額」の列の値の表記を変えるもので、表の「列の名前・順番の変更」には当たらない

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 24 | 3/3 | 1/3 |

## 前回より下がったものと、その原因

- 無し（eval 24 は新規なので、比べる記録は無い）

## 気付いたこと

- without_skill は、表に当てはまらないことに気付いたが、「安全側を選ぶ」として自分で破壊的変更に当たると決め、利用者に確認しなかった。
- with_skill は、表で決められないので仮に決めずに確認すると述べ、commit の前に選択肢を示して止まった。
- 区別できるのは「説明に留める」を除く 2 本である。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
