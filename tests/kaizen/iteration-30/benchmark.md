# Skill Benchmark: kaizen

**Model**: claude-code / opus（reasoning effort high）
**Date**: 2026-11-08
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #950 のローカルのレビューの指摘に対応した後の変更確認である。
eval 27・28 の束ねていた assertion を 1 つの主張ずつに分け、eval 28 の fixture の `扱い: 明確` の学びの提案を、新しい extract が書く形に直した。

## 入力の変更

- eval 27: assertion を 6 本から 8 本に分けた（扱いと場所を分けた）。
- eval 28: assertion を 7 本から 10 本に分けた。fixture `2026-10-01-skipped-test-before-commit.md` の `## 提案` を書き直した。
- 文が変わった assertion は前回（iteration-29）と比べず、新しい assertion として扱う。文が同じ assertion（eval 27 の提案の形 2 本・照合した範囲・lifecycle 検査、eval 28 の種類 3 本・lifecycle 検査）は、どちらの config でも前回と同じ結果だった。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 27 | あり | 8/8 | 2/8 | 6/6（iteration-29。文が違う） |
| 28 | あり | 10/10 | 6/10 | 7/7（iteration-29。文が違う） |

## 差の出た所と出なかった所

- eval 27 の差は、`## 既存の規約` の扱いと場所の記録（5 本）と lifecycle 検査（1 本）で出た。提案の形の 2 本は、without_skill も満たした。
- eval 28 の差は、`## 失敗の種類` の値（3 本）と lifecycle 検査（1 本）で出た。文面の形の 6 本は、without_skill も満たした。fixture の提案が言い訳への対策を書く形になったので、言い訳の一覧の assertion は without_skill も満たすようになった。
- eval 28 の with_skill は、sed の分岐の条件に `uname` ではなく `sed --version` の終了コードを使った。観測できる値による分岐なので pass にした。
- 差の出なかった assertion は、Delta ではなく後退の検出を目的として残す。

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し
