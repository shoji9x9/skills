---
date: 2026-10-17
type: doc
priority: low
status: pending
applied-to: []
session: claude-code
---

# Markdown の行を Issue の番号（`#` と数字）で書き始めない

## 事象

同じセッションで 2 回、Markdown の段落の行を「#633 の…」「#632 で…」のように Issue の番号で書き始めた。
1 回目は PR の本文で、markdownlint の自動修正が見出し（`# 633`）に書き換えた。
2 回目は `.kaizen/` の学びで、pre-commit の markdownlint が MD022・MD025・MD026 で commit を止めた。

## 根本原因

- なぜ見出しになったか → 行頭の `#` の後に空白が無くても、markdownlint の `--fix` は空白を足して ATX 見出しにする（MD018）
- なぜ繰り返したか → 1 回目は言い換えて直しただけで、書き方の規約として残さなかった
- なぜ書く時点で気づかないか → 文として読むと自然で、Markdown の構文としての意味が見えない

## 提案

Markdown の行を Issue の番号で書き始めない（「Issue #632 の作業で…」のように語を前に置く）。

- 適用先候補: docs/writing-style.md、または textlint の規則（行頭の `#` と数字を検出する）
- 横断: commit message と Issue のタイトルは Markdown として整形されないので対象外
