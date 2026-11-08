# Skill Benchmark: kaizen

**Model**: claude-code / opus（reasoning effort high）
**Date**: 2026-11-08
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #950 の 2 回目のローカルのレビューの指摘に対応した後の変更確認である。
eval 28 の分岐の assertion を「観測できる値」に直し、fixture の照合した範囲を事象に固有の語に直した。
apply が古い形の学び（`## 既存の規約` が無い学び）に照合を当て直す分岐を確かめるため、eval 29 を足した。

## 入力の変更

- eval 28: assertion 1 本の文を変えた（OS ごとの分岐 → 観測できる値ごとの分岐）。fixture 3 件の `照合した範囲` を書き直した。
- eval 29: 新規。fixture `apply-legacy-note`（`AGENTS.md` に言い切った規約、その規約と同じ内容を提案する古い形の学び）。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 28 | あり | 10/10 | 6/10 | 9/10（iteration-30） |
| 29 | 新規 | 4/4 | 1/4 | 無し |

## 前回の記録との比べ方

- eval 28 の文を変えた 1 本（分岐の条件）は、前回と比べない。iteration-30 では、文どおりに採点して fail だった。
- 文が同じ 9 本は、with_skill・without_skill とも前回と同じ結果だった。

## 差の出た所と出なかった所

- eval 28 の差は、`## 失敗の種類` の値（3 本）と lifecycle 検査（1 本）で出た。文面の形の 6 本は、without_skill も満たした。
- eval 29 の with_skill は、古い形の学びに `## 既存の規約`（扱い: 明確、場所: AGENTS.md「作業の規約」）を足した。AGENTS.md は変えず、学びを rejected にした。
  without_skill は AGENTS.md を変えなかったが、扱いを記録せず、学びを pending のまま残した。
- 差の出なかった assertion は、Delta ではなく後退の検出を目的として残す。

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し
