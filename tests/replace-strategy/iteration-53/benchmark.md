# Skill Benchmark: replace-strategy

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-10
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #918 の 3 の変更確認である。
`issues` モードで、利用者が承認した分け方と下書きを `issue-create` に渡し、承認を求め直さずに起票して依存関係を設定する場面を、eval 39 として足した（#904 で入れた取り決め）。

## 入力の変更

- eval 39 を足した。fixture は既存の `issues-approval-gate` を使い、`requires_skills` に `issue-create` を置く

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 39 | 9/9 | 7/9 |

## 前回より下がったものと、その原因

- 無し（eval 39 は新規なので、比べる記録は無い）

## 気付いたこと

- without_skill は、承認の引き継ぎ・印の置き換え・依存関係の設定まで答えた。`requires_skills` の `issue-create` が `caller-approval.md` と `split.md` を持つので、これらは姉妹スキルの原本で答えられる。
- 差が出たのは、`replace-strategy` の側にだけある 2 本である。起票した番号を `.replace/features.md` に書き戻すことと、今回起票していない report を含むすべての行を母集合にして受け入れ条件と突き合わせることである。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
