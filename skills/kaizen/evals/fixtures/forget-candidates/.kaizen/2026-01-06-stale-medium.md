---
date: 2026-01-06
type: doc
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 出力の文字数を数える前にロケールを確認する

## 事象

非 UTF-8 ロケールで切り詰めがバイト境界を割った。

## 提案

切り詰めの前にロケールを判定する。
