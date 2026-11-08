# Skill Benchmark: kaizen

**Model**: claude-code / opus（reasoning effort high）
**Date**: 2026-11-08
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #933・#934 の変更確認である。新しく足した eval 27（既存の規約との照合）と eval 28（規約の書き方を失敗の種類で選ぶ）を 1 run ずつ実行した。
どちらも新しい eval なので、比べる前回の記録は無い。

## 入力の変更

- eval 27: 新規。fixture `fixtures/existing-rules`（`AGENTS.md` に言い切った規約、`docs/notes/gh-tips.md` に案内されない弱い書き方の記述）
- eval 28: 新規。fixture `fixtures/apply-failure-types`（失敗の種類の違う pending の学び 3 件）

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 27 | 新規 | 6/6 | 2/6 | 無し |
| 28 | 新規 | 7/7 | 2/7 | 無し |

## 差の出た所と出なかった所

- eval 27 の `without_skill` も、既存の規約を読んで「同じ内容を足さない」判断をした（提案の形の 2 本は pass）。差が出たのは、扱いと場所を `## 既存の規約` に記録すること（3 本）と、同梱の lifecycle 検査（1 本）である。
- eval 28 の `without_skill` も、PR の本文を構成と順序で書き、sed を OS の分岐で書いた（2 本は pass）。差が出たのは、`## 失敗の種類` の記録（3 本）、言い訳とそれでも従う理由（1 本）、lifecycle 検査（1 本）である。
- 差の出なかった 4 本は、Delta ではなく後退の検出を目的として残す。

## 前回より下がったものと、その原因

- 無し（新しい eval のため比べていない）

## 実行し直した run

- 無し
