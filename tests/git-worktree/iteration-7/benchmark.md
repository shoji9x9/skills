# Skill Benchmark: git-worktree

**Model**: claude-code / opus
**Date**: 2026-10-30
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #835 で、リモートが無い（`git remote` の出力が空の）リポジトリでの読み替えを足した。

- branch は `gh issue develop` の代わりに `git branch <名前> <ベース>` で作ってから渡す（`references/isolation.md`）
- 片付けの前の確認は、`--not --remotes` の代わりに `--not <ベース>` で、ベースに取り込まれていない commit を確かめる（`references/cleanup.md`）
- 取り込まれたかは、PR の代わりに `git branch --merged <ベース>` の完全一致で確かめ、`-d` で削除する。`push --delete` は実行しない。squash で取り込んだ branch は載らないので残して報告する

これを確かめる eval 12 を足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 12 | 新規 | 7/7 | 5/7 |

eval 12 は新しい eval なので、比べる記録は無い。

## 差が出た assertion

- branch を `git branch <名前> main` で作ってから、既存の branch に worktree を張る。without_skill は `git worktree add -b` で作らせる形を主な手順にした
- feature/search（squash で取り込んだ branch）は削除せず、残して報告する。without_skill は内容を照合した後に `git branch -D` で削除した

## 区別できない assertion

`--not main` で確かめる・`--merged` で確かめる・`-d` で消す・`push --delete` をしない・実行しない、の 5 本は、git の一般の知識で答えられるので without_skill も pass する。
それぞれの読み替えが手順から消えた後退を検出するために置く。
