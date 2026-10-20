# Skill Benchmark: issue-batch

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-20
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #688 で、push の前のローカルレビューを変更の大きさで省かないことと、省いてよい条件の閉じた一覧（利用者が明示して省くよう指示した・差分が 0 行）を、`references/orchestration.md`「ローカルレビュー」に足した。
省いたときは、「判断の扱い」の守っていない規約の欄（`unfollowed_rules`）に記録する。SKILL.md の手順 4 からは、この節を参照する。

入力が変わったのは、新しく足した eval 28 である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 28 | 新規 | 5/5 | 3/5 | 無し |

with_skill の平均 pass_rate は 1.00、without_skill は 0.60。

without_skill が落としたのは、省いてよい条件を 2 つに限ること（リポジトリの規約による免除を 3 つ目に足した）と、省いたことを守っていない規約の欄に載せること（「省略・未実施の事項」という別の節を作った）の 2 本である。
without_skill も、#101 を省かずにレビューすることと、#102 が省いてよい条件に当たることは満たした。
この 2 本は prompt が事実を挙げているので差が出ず、取り決めが消えた後退の検出のために置く（`evals/issue-batch/README.md`）。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
