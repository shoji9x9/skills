---
date: 2026-10-01
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 小さな修正でも commit の前にテストを実行する

## 事象

1 行の修正だったので、`pnpm test` を実行せずに commit して push した。CI のテストが失敗し、修正の commit をもう 1 つ作った。

## 根本原因

エージェントは `AGENTS.md` の「commit の前に `pnpm test` を実行する」を読んでいた。修正が小さいのでテストは要らないと判断し、規約に従わなかった。

## 根拠

1 回の観測で、規約を読んだうえで従わなかったことを、セッションの記録で確かめた。KEDB 照合（pnpm test・commit）で一致は無かった。

## 既存の規約

- 扱い: 明確
- 場所: `AGENTS.md`「作業の規約」
- 照合した範囲: `AGENTS.md`・`docs/` を `pnpm test` で検索した

## 提案

既存の規約を読んだうえで例外に見える場面で従わなかったときは、同じ規約を足さず、その場面で使った言い訳への対策を規約に足す。

- 対象: `AGENTS.md`「作業の規約」の commit の前のテストの規約
- 今回の言い訳は「1 行の修正だからテストは要らない」だった。
