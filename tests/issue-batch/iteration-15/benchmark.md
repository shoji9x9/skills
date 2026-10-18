# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-18
**Evals**: 1（`with_skill` を 1 run）

## 何を変えたか

iteration-14（18423c09 の版）の後、依存の判定を 1 文にした。
依存元に着手するのは、すべての依存先の PR が run の base branch に `MERGED` だと、着手の直前に確かめられたときだけである。
確かめられなければ、全体を停止せずにその依存元だけを `BLOCKED` にし、境界の場合は書き分けない。
eval 26 の assertion は細かい判定に依存していないので変えず、872d2cd7 の版で with_skill だけを実行し直した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 26 | なし | 7/7 | 実行していない（iteration-14 では 3/7） |

## 備考

- with_skill は iteration-12〜14 と同じく 7/7 で、判定を 1 文にした後も下がっていない。
- without_skill はスキルを読まないので、版の変更で結果は変わらない。比べる相手は iteration-14 の 3/7 にする。
