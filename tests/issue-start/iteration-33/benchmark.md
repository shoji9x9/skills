# Skill Benchmark: issue-start

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-12
**Evals**: 1（`with_skill` だけを 1 run）

## 目的

PR #1000 の medium のレビューへの対応で `references/breaking-change.md` を直した後に、eval 22 の with_skill を実行し直した。
eval 22 の入力（prompt・assertion・fixture）は変えていないので、without_skill は実行していない。
iteration-32 と configuration の組が違うので、iteration を分けた。

## Summary

| eval | with_skill | 前回 | 前回の iteration |
| --- | --- | --- | --- |
| 22 | 6/6 | 6/6 | 30 |

## 前回より下がったものと、その原因

- 無し

## 気付いたこと

- with_skill は、commit message に加えて PR のタイトルにも `!` を付けないと述べた。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
