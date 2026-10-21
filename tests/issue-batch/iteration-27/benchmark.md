# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-21
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #741 で、run の前に判断を決めて Issue に記録する `prepare` と、依存から実行の順を決める取り決めを足した。
これを確かめる eval 30（prepare）と eval 31（run の並べ替え）を新しく足した。入力が変わったのはこの 2 件だけである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 30 | 新規 | 7/8 | 4/8 | 無し（新規） |
| 31 | 新規 | 5/5 | 2/5 | 無し（新規） |

eval 30 の without_skill は、プロンプトを入力の順（`110 111 112`）のまま示し、目印付きのコメントを書いた人を書き込める権限で見分けなかった。
eval 31 の without_skill は、順を #122 → #121 → #120 にし、#120 をこの run では着手せずに blocked として残した。

## with_skill で満たさなかった assertion

- eval 30「branch・worktree・PR・manifest を作らず、担当者を割り当てないと述べている」。
  回答は担当者を割り当てないことだけを述べ、branch・worktree・PR・manifest を作らないことには触れなかった。
  prompt はこの点を問うていなかったので、iteration-28 で prompt に問いを足して実行し直した。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
