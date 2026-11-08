---
date: 2026-09-05
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# commit の前に lint を実行する

## 事象

`pnpm lint` を実行せずに commit して push し、CI の lint のジョブが未使用の import で失敗した。修正の commit をもう 1 つ作った。

## 根本原因

commit の前に `pnpm lint` を実行しなかった。

## 根拠

1 回の観測で、lint を実行しなかったことを CI のログで確かめた。KEDB 照合（lint・commit）で一致は無かった。

## 提案

commit の前に `pnpm lint` を実行する。
