---
date: 2026-09-10
type: doc
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 依存を足したら lockfile も同じ commit に入れる

## 事象

依存を足した commit に `pnpm-lock.yaml` が入っておらず、CI の `pnpm install --frozen-lockfile` が失敗した。

## 根本原因

`package.json` だけを stage し、lockfile が変わったことを確かめなかった。

## 根拠

1 回の観測で、原因を stage の抜けに絞れた。KEDB 照合（lockfile・pnpm）で一致は無かった。

## 提案

依存を足したら、`package.json` と lockfile を同じ commit に入れる。
