---
date: 2026-07-28
type: doc
priority: medium
status: applied
session: claude-code
---

# 共有契約の突合対象は「契約フィールドを読む・書く箇所」の軸で列挙する

## 事象

Issue #131 の `url_command` 追加（targets 共有契約の変更）で、適用先の列挙から
`replace-strategy/assets/survey-template.md`・`parity-diff/assets/diff-metadata-template.json`（成果物テンプレート）が漏れ、
`parity-suite/references/api-batch.md`（姉妹スキルの同名 references）を誤ってスキップした。いずれも /code-review で検出・修正された。

## 根本原因

適用先の列挙を既知キーワード×拡張子の grep（`--include="*.md"` で `ui_url` 等）に依存し、
「その契約フィールドを読む・書く箇所」の軸（assets のテンプレート＝成果物スキーマの正本、同名姉妹 references、
キーワードに一致しない表現で値を記録する成果物）で列挙しなかった。
[[2026-07-27-shared-contract-lifecycle-walkthrough]]（grep 突合はフロー破綻を見つけられない）と同系統の再発で、
今回は列挙そのものの軸の欠落。

## 提案

共有契約（設定キー・成果物スキーマ）の変更時、突合対象の列挙は既知キーワードの grep に閉じず「その契約フィールドを読む・書く箇所」の軸で行う（成果物テンプレート・同名姉妹 references を含める）。
恒久側 `docs/skill-development.md`「push 前の整合パス」項目 5 に本規定を追記済み（本実行で適用完了）。
