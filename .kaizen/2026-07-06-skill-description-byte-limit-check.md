---
date: 2026-07-06
type: hook
priority: medium
status: pending
session: claude-code
---

# SKILL.md description の上限 1024 はバイト数。決定論的チェックで超過を検出する

## 事象

browser-test スキル作成時、日本語 description の加筆で `gh skill publish --dry-run` に
「description is 1078 chars (recommended max: 1024)」と警告された（修正して 984 バイトに短縮）。
検出は publish 直前の手動 dry-run のみ。横断確認で、マージ済みの aws-architecture-diagram も
現在 1051 バイトで超過しており、dry-run のたびに警告が出続けている（再発・放置の証拠）。

## 根本原因

- なぜ超過した? → 日本語で description を書く際「文字数」感覚で見積もった
- なぜ見積もりがずれる? → 上限は実測で UTF-8 バイト数（`awk length`=1078 と gh の 1078 が一致。
  日本語は 1 文字 3 バイトで実質約 340 文字）だが、AGENTS.md は「最大1024文字」と記載
- なぜ再発する? → description 長を検査する決定論的チェック（pre-commit / CI）が無く、
  手動 dry-run でしか気付けない ← 根本原因（対策可能）

## 提案

SKILL.md の description 上限 1024 は UTF-8 バイト数で検査し、pre-commit / CI の決定論的
チェックで超過を検出する（日本語は 1 文字 3 バイトで実質約 340 文字）。

- `scripts/` に skills/*/SKILL.md の description バイト長を検査するスクリプトを追加し、
  lefthook pre-commit と CI（Lint ジョブ）に組み込む（>1024 で fail）
- AGENTS.md「最大1024文字」を「最大 1024 バイト（UTF-8。日本語はおよそ 340 文字）」に訂正
- 横断対応: aws-architecture-diagram（現在 1051 バイト）の description を短縮する
  （チェック導入時に fail するため同時に対応する）
