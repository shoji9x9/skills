# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-19
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #689 で、merge の後に commit を記録する Hook（agent-usage など）が worktree に足した記録を、片付けの前に次の Issue の branch へ引き継ぐ手順を `references/orchestration.md` に足した。
片付けで `git worktree remove --force` を使わないことも書いた。

eval 13 の prompt に、dirty な worktree の `git status` の出力（agent-usage の記録の 2 行、`AM` を含む）と次の Issue の worktree を足し、引き継ぎの手順の中身を検査する assertion に替えた。入力が変わったのはこの eval だけである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 13 | prompt・assertion | 6/6 | 1/6 | iteration-3（入力が違う） |

without_skill は、記録を repo の外に退避して agent-usage の手順で取り込むと答え、次の Issue の branch への引き継ぎ、merge commit を含むかの確認、次の PR の merge を待つことを書かなかった。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- PR #714 の前の 2 つの版の eval 13 で 1 回ずつ実行したが、レビューの指摘で prompt と assertion を直したので捨てた

## 集計から外したもの

- 無し
