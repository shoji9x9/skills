# Skill Benchmark: issue-start

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-12
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #1000 の medium のレビューへの対応で、`references/breaking-change.md` を直した後の変更確認である。
直したのは、見立てのときに `!` と `BREAKING CHANGE:` を書かない場所に PR のタイトルと本文を足したことと、修正で破壊的に見えるかが変わったら見立てを書き直すことである。

## 入力の変更

- eval 25 に assertion を 2 本足した（見立てを書かない・`!` も `BREAKING CHANGE:` も書かない）

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 25 | 5/5 | 4/5 |

## 前回より下がったものと、その原因

- 文が同じ 3 本を前回（iteration-30）と比べた。with_skill は 3 本すべて pass で、下がっていない
- 足した 2 本は、文を変えたので比べない

## 気付いたこと

- without_skill は、定義が無いことに触れずに自分で「破壊的変更ではない」と判断した。勧め・見立て・`!` はどれも書かなかった。
- 区別できるのは、定義が無いことを書く 1 本だけである。勧め・見立て・`!` を書かない 3 本は、書きすぎる後退を検出するために置く。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
