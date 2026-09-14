---
date: 2026-09-14
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 設定の解決順は正本を読んでから引く（変数名を推測しない）

## 事象

pr-finalize-loop のレビューツール解決で、正本（`references/review-tool.md`）を読む前に環境変数名を `PR_FINALIZE_REVIEW_TOOL` と推測して未設定と判定し、
`.config/skills/shoji9x9/skills.yml` の `copilot` を使った。実際は `SKILLS_REVIEW_TOOL=codex`。PR #363 で Copilot へ 3 回依頼し、ユーザーの指摘で発覚した。

## 根本原因

- なぜ誤った? → 正本を読む前に変数名を推測した
- なぜ推測で進めた? → 解決結果とその出所（どの層から来たか）を報告・検証する手順が無く、誤った値でも正常に進行する
- なぜ導出が散文任せ? → 解決順（CLI → 環境変数 → 設定 → 既定）を決定論的に実行するスクリプトが無い ← 根本原因

## 提案

多層の設定解決は正本の解決順を決定論的に実行し、値と出所の層を表示してから使う。

pr-finalize-loop / pr-review-handle に `review_tool` の解決スクリプト（値と `source: cli|env|config|default` を出力、未知値は非 0）を同梱し、着手時に実行して出所を報告する手順にする。
横断: issue-batch の handoff も同じ解決を使う。
