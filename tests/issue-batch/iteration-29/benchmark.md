# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-21
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #745 のレビューで、prepare が足した 2 つの分岐を確かめる eval が無いと指摘された。
1 つは、書き込めない login では Issue に記録する選択肢を確認から外し、選択肢が残らない論点を決まらなかったものにする分岐である。
もう 1 つは、書き込めない人のコメントでは記録を覆さない分岐である。これを確かめる eval 32 を足した。入力が変わったのはこの eval だけである。
run の前に、assertion と prompt の対応をサブエージェントにレビューさせ、指摘 3 件を prompt と assertion に反映してから実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 32 | 新規 | 8/8 | 3/8 | 無し（新規） |

without_skill は、#131 の案の選択を利用者に確認し、目印の無いコメントを #131 に投稿すると答えた。
run のプロンプトを示さず、#130 の branch と worktree を作る予定を示した。決め直す方法は、書き込める人がコメントで記録することとし、prepare の実行し直しとは書かなかった。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
