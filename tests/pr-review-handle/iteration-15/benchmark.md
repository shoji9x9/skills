# Skill Benchmark: pr-review-handle

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-10
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #918 の 2 の変更確認である。
人に回すかの基準（`references/review-response.md`）で、レビューの指摘を自分で決めるか人に回すかを振り分ける場面を、eval 14 として足した。
4 つのスレッドは、基準の 1（調べて決まる）・2（元に戻せない）・3（影響が大きい）と、直し方が複数あるだけのものに 1 つずつ当たる。

## 入力の変更

- eval 14 を足した。fixture は使わず、設定ファイルが無い場面を prompt で述べる

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 14 | 8/8 | 6/8 |

## 前回より下がったものと、その原因

- 無し（eval 14 は新規なので、比べる記録は無い）

## 気付いたこと

- without_skill も、元に戻せない B と影響の大きい C を人に回し、A と D を自分で決めた。振り分けの結論は一般の判断で出せる。
- 差が出たのは、`pr-review-handle` の側にだけある 2 本である。直し方が複数あることだけを人に回す理由にしないことと、B と C の確認を A と D の処理を終えてから行うことである。
  without_skill は、仕分けの直後に B と C を聞き、答えを待つ間に A と D を進めると答えた。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
