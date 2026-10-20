# Skill Benchmark: issue-batch

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-20
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #720 で、`references/orchestration.md`「ローカルレビュー」の省いてよい条件「差分が 0 行」について、数える範囲を base branch に入っていない変更のすべて（commit していない差分と、push 済みを含む base branch に入っていない commit）に変えた。
iteration-21 はこの変更の前の版で測ったので、eval 28 を今の版で測り直した。eval 28 の prompt・fixture・assertion は変えていない（`eval-fingerprint.json` は iteration-21 と同じ値）。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 28 | スキルの原本だけ | 5/5 | 3/5 | 5/5 |

with_skill の平均 pass_rate は 1.00、without_skill は 0.60 で、どちらも iteration-21 と同じである。

without_skill が落としたのは、省いてよい条件を 2 つに限ること（「レビューの仕組みが環境に存在しないとき」を 3 つ目に足した）と、省いたことを守っていない規約の欄に載せること（「省略・未実施の事項」という別の節を作った）の 2 本である。
without_skill も、#101 を省かずにレビューすることと、#102 が省いてよい条件に当たることは満たした。
この 2 本は prompt が事実を挙げているので差が出ず、取り決めが消えた後退の検出のために置く（`evals/issue-batch/README.md`）。

with_skill は、省いてよい 2 つ目の条件を「base branch に入っていない変更が 0 行」と書き、push 済みの commit も数えると述べた。変えた後の版の数え方に従っている。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
