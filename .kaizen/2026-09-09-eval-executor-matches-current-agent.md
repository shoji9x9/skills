---
date: 2026-09-09
type: rule
priority: medium
status: applied
applied-to: [docs/skill-eval-executors.md, docs/skill-development.md, .agents/rules/eval-run-scope.md]
session: codex
---

# Eval executor を現在作業しているエージェントに合わせる

## 事象

Codex セッションで追加 eval の実走を依頼された際、executor 未指定ならランチャ既定の Claude Code を使うと案内し、ユーザーから Codex を使うよう修正された。

## 根本原因

1. なぜ Claude Code を案内したか → ランチャの引数省略時既定を、エージェント運用上の既定として解釈した。
2. なぜ 2 種の既定を区別しなかったか → executor 契約は後方互換の CLI 挙動だけを定め、現在の利用環境に合わせる選択規則を持っていなかった。
3. なぜ選択規則が必要と認識されなかったか → executor を単なる互換実装の選択と扱い、日常利用環境との一致と別ベンダー利用枠の消費を評価条件として扱っていなかった。

KEDB 照合では直接一致なし。関連する applied 記録 `.kaizen/2026-08-29-codex-only-eval-must-stay-on-codex.md` は実走中の切替を扱い、初期選択は対象外だった。
横断確認では、選択規則の正本、実走手順、eval ファイル編集時に自動適用されるルールの 3 箇所に同じ入口が必要だった。

## 提案

Eval をエージェントが起動するときは現在作業しているエージェントと同じ executor を明示し、ユーザー指定・スキル固有契約を優先する。

Codex セッションは `--executor codex`、Claude Code セッションは `--executor claude-code` を使う。対応 executor が無いエージェントでは推測せずユーザーに確認する。
