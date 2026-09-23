---
date: 2026-02-02
type: hook
priority: high
status: applied
applied-to: ["scripts/check-control-bytes.js", "AGENTS.md"]
session: claude-code
---

# 制御バイトの混入を commit 前に止める

## 事象

テキストファイルに NUL が混入したまま commit された。

## 提案

pre-commit と CI に検査を 1 本足し、基底ドキュメントにも方針を書く。
