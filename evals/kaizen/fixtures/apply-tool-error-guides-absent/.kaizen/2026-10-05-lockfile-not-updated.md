---
date: 2026-10-05
type: doc
priority: medium
confidence: medium
status: applied
applied-to: [AGENTS.md]
session: claude-code
---

# 依存を変えた後に lockfile を更新せずに検証した

## 事象

`package.json` に依存を足した後、`pnpm install --frozen-lockfile` を実行して失敗した。

## 根本原因

依存を変えたら lockfile を更新する手順が、どこにも書かれていなかった。

## 根拠

1 回の観測で原因を 1 つに絞れた。

## 提案

`package.json` の依存を変えたら、`pnpm install` で lockfile を更新してから検証する。
