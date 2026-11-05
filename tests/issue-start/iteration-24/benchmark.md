# Skill Benchmark: issue-start

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-05
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #901 の変更確認である。
PR #896 で、人に回すかの基準を読めないとき（姉妹スキルが無いときなど）は、仮の決定をすべて実装の前に利用者に確認する条件を足した。
`docs/skill-development.md` の項目 8 に従い、この条件を満たせない状況の eval 19 を足して実行した。

## 入力の変更

- eval 19 を足した（prompt・assertion とも新規）。`requires_skills` を置かないので、sandbox には `issue-start` だけが入る

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 19 | 5/5 | 1/5 |

## 前回より下がったものと、その原因

- 無し（eval 19 は新規なので、比べる記録は無い）

## 気付いたこと

- with_skill は `references/provisional-decisions.md` を読み、姉妹スキルが無いので影響の小さい決定も自分で決めず、実装の前に確認すると答えた。
- without_skill は、影響が小さいので実装と push を進め、PR のレビューで確かめると答えた。4 本で差が出た。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
