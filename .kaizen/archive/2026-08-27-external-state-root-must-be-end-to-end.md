---
date: 2026-08-27
type: doc
priority: high
status: applied
applied-to:
  - scripts/eval-sandbox.sh
  - scripts/eval-sandbox.test.js
  - docs/skill-eval-executors.md
session: codex
---

# 外部ツールの state root override は隔離境界全体へ適用する

## 事象

Codex 評価 sandbox が認証・履歴・スキルの遮断先を `~/.codex` に固定し、`CODEX_HOME` が非既定パスのとき custom state を baseline から隠さず、credential の deny-read も誤ったパスへ向けていた。レビューで credential exposure と baseline contamination の両方を指摘され、手戻りになった。

## 根本原因

1. 認証ファイルだけを起動に戻す実装で、Codex state root を既定パスとして直接記述した。
2. `CODEX_HOME` が config・auth・logs・sessions・skills・package metadata 全体の root である契約を、遮断・再公開・deny rule の共通入力としてモデル化していなかった。
3. 既定環境の実 CLI pilot だけを通し、非既定 state root に marker skill と auth を置く境界テストを設計していなかった。

KEDB を `CODEX_HOME`・`eval-sandbox.sh`・`auth.json`・`default path` で照合したが、同一の既存学びは無かった。横断確認では `CODEX_HOME` / `auth.json` を扱う production 実装は当該 sandbox に限られ、関連する文書とテストを同時に更新した。

## 提案

外部ツールが state root の override を持つ場合は canonical root を一度だけ解決し、遮断・必要ファイルの再公開・credential deny・CLI 環境変数の全経路へ同じ値を適用する。

既定値だけの正常系では隔離漏れを検出できないため、非既定 root に credential と固有 marker を置き、credential だけが起動用に戻り marker は見えないことを実行テストで証明する。
