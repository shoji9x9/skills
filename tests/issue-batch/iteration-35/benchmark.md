# Skill Benchmark: issue-batch

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-05
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #905 の変更確認である。PR を作った後に生じた仮の決定を、issue-batch が PR の本文の「仮に決めたこと」の節に追記する工程と、判断待ちの種別（`kind`）を足した。
新しい eval 34 と 35 を、with_skill と without_skill で 1 回ずつ実行した。

## 入力の変更

- eval 34 を足した: 判断待ちを残して返った PR に、何を追記し何を載せないか、人が書いた行を残すか、merge するか
- eval 35 を足した: 追記の範囲の SHA-256 が目印の値と一致しないとき、本文を変えずに記録し、merge に進むか

## Summary

| eval | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 34 | 6/6 | 5/6 | 無し（新規） |
| 35 | 5/5 | 3/5 | 無し（新規） |

## 前回より下がったものと、その原因

- 無し（どちらも新しい eval）

## 気付いたこと

- eval 34 の without_skill は、目印で囲んだ範囲を作らずに節へ項目を足すだけだった（assertion 4）。ほかの 5 本は、prompt の問い方から答えられるので pass した
- eval 35 の without_skill は、追記しなかったことを判断待ちとして記録し、merge を保留した。追記できないことだけで BLOCKED にしない取り決めが差を作る

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
