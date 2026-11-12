# Skill Benchmark: issue-start

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-12
**Evals**: 1（`with_skill` を 1 run）

## 目的

Issue #999 の変更確認である。
`issue-start` が作る PR の本文に「破壊的変更」の節が加わったので、PR の本文の構成を問う eval 18 を with_skill で実行した。
eval 18 の入力（prompt・assertion・fixture）は変えていないので、without_skill は実行していない。

## Summary

| eval | with_skill |
| --- | --- |
| 18 | 4/4 |

## 前回より下がったものと、その原因

- 無し。比べる記録は iteration-23 の eval 18 で、with_skill は 4 本すべてを満たしていた。今回も 4 本すべてを満たした（1 run どうしの比較）

## 気付いたこと

- 規約の文書が無い環境なので、PR の本文の下書きの「破壊的変更」の節は、「定義が無ければ、規約の文書に破壊的変更の定義が無いので判断していない、と読んだ文書のパスを書く」という形になった

## 実行し直した run

- 1 回目と 2 回目の run は、`references/breaking-change.md` を直す前のスキルで実行したので、集計に入れていない（iteration-26 の benchmark.md と同じ経緯）

## 集計から外したもの

- 無し
