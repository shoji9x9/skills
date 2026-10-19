# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-19
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #689 で、merge の後に commit を記録する Hook（agent-usage など）が worktree に足した記録を、片付けの前に次の Issue の branch へ引き継ぐ手順を `references/orchestration.md` に足した。
片付けで `git worktree remove --force` を使わないことも書いた。

eval 13 の 1 つ目の assertion を、「dirty なら BLOCKED」から「記録だけなら引き継ぎ、それ以外の変更があれば BLOCKED」に直した。入力が変わったのはこの eval だけである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 13 | assertion | 4/4 | 1/4 | iteration-3 |

without_skill は、cleanup を保留にしたが、記録の引き継ぎも BLOCKED も書かず、worktree を先に解除する順序と完全一致の ref だけを扱うことも書かなかった。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- with_skill: assertion を直す前に 1 回実行した。新しい手順どおりに答えたが、1 つ目の assertion（dirty なら BLOCKED）と合わなかったので、assertion を直して捨てた

## 集計から外したもの

- 無し
