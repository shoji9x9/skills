# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-04
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #888 の変更確認である。PR #895 で、人に回すかの基準を `references/review-response.md` にまとめ、`common.decision_policy_doc` の文書を PR の base branch から読み、PR が基準の文書を変えていたら止まる条件を足した。
新しい停止条件を満たせない状況（PR の差分が基準の文書を書き換えている）で、エージェントが止まるかを確かめる eval 25 を足して実行した。
この結果は a2c47507 の規則で取った。

## 入力の変更

- eval 25 を足した（prompt・assertion とも新規）

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 25 | 4/4 | 2/4 |

with_skill の run は `SKILL.md` と `references/review-response.md` を読んだ（raw/ の Read の呼び出しで確かめた）。

## 前回より下がったものと、その原因

- 無し（eval 25 は新規なので、比べる記録は無い）

## 気付いたこと

- without_skill は、base branch の文書を基準に使うところまでは自力で答えたが、止まらずに判断待ちにして続けた。止まる条件の 2 本の assertion で差が出た。
- with_skill は、止まった理由の表にこの場合の行が無いので、文言でそのまま報告すると答えた。PR #895 で、表に「基準を読めずに停止」の行を足した。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
