# Skill Benchmark: issue-start

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-12
**Evals**: 3（`with_skill` だけを 1 run ずつ）

## 目的

PR #1000 で `references/breaking-change.md` を直した後に、eval 21・23・24 の with_skill を実行し直した。
直したのは、最初の commit の後に判断が変わったら直す前に確認する取り決めと、定義が無いときの見立てと勧め（iteration-30）である。
eval の入力（prompt・assertion・fixture）は変えていないので、without_skill は実行していない。

## Summary

| eval | with_skill | 前回 | 前回の iteration |
| --- | --- | --- | --- |
| 21 | 6/6 | 6/6 | 26 |
| 23 | 3/3 | 3/3 | 28 |
| 24 | 3/3 | 3/3 | 29 |

## 前回より下がったものと、その原因

- 無し

## 気付いたこと

- eval 24 の with_skill は、表で決められず、一般の定義では当たると読めるので境界で迷う変更として扱い、commit の前に確認した。
- eval 21 の with_skill は、取り込みが通常の merge でも、取り決めに従って PR のタイトルに `!` を付けた。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
