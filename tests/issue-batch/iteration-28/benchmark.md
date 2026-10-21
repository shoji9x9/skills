# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-21
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

iteration-27 で、eval 30 の「branch・worktree・PR・manifest を作らず、担当者を割り当てないと述べている」を with_skill が満たさなかった。
prompt がこの点を問うていなかったので、「prepare の間に何を作って何を作らないか」を問う文を prompt に足した。入力が変わったのはこの eval だけである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 30 | prompt | 8/8 | 5/8 | iteration-27 で 7/8（prompt が違う） |

足した問いは答える対象を並べているので、without_skill も「作るもの・作らないもの」の assertion を満たした。
without_skill は、プロンプトを入力の順（`110 111 112`）のまま示し、目印付きのコメントを書いた人を書き込める権限で見分けなかった。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し（iteration-27 の eval 30 は prompt を直す前の記録として残す）

## 集計から外したもの

- 無し
