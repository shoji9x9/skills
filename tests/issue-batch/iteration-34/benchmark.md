# Skill Benchmark: issue-batch

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-05
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #889 の変更確認の実行し直しである。iteration-33 の eval 33 は `requires_skills` を宣言しておらず、sandbox に `issue-start` が無かった。
そのため、5 つの項目の定義（`issue-start` の `references/provisional-decisions.md`）を読めない状態だった（PR #896 の Copilot のレビューの指摘）。
eval 33 に `requires_skills: ["issue-start"]` を足し、両方の configuration を実行し直した。
あわせて、判断待ち（`pending_decisions`）を節に載せない取り決めに変えた後の規則で取った。

## 入力の変更

- eval 33 に `requires_skills: ["issue-start"]` を足した（prompt・assertion は変えていない）

## Summary

| eval | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 33 | 4/4 | 3/4 | 4/4（iteration-33） |

with_skill の run は `issue-start` の `references/provisional-decisions.md` を読んだ（raw/ の Read の呼び出しで確かめた）。

## 前回より下がったものと、その原因

- 無し

## 気付いたこと

- without_skill は前回と同じく、反復の上限で直さなかった指摘も節に載せた。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
