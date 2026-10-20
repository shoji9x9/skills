# Skill Benchmark: kaizen

**Model**: claude-code / opus
**Date**: 2026-10-19
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #701 で、学びのノートに確信度（frontmatter の `confidence`）と `## 根拠` の節を足し、確信度の基準と、重要度（`priority`）との分け方を `references/extract.md` に書いた。
`kaizen-status-check.sh` は、`confidence` があるときだけ値を確かめる。

入力が変わったのは、新しく足した eval 26 だけである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 26 | 新規 | 6/6 | 0/6 | 無し |

without_skill は、確信度を本文の独自の節（`## 確度`）に書き、frontmatter の `confidence` と `## 根拠` を書かなかった。エラーの出力と利用者の発言もそのまま書いた。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し。この iteration の前に、ローカルレビューで変える前の prompt で 1 回ずつ実行したが、prompt と assertion を直したので捨てた

## 集計から外したもの

- 無し
