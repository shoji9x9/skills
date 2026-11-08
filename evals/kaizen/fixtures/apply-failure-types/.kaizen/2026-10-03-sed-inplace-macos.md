---
date: 2026-10-03
type: doc
priority: medium
confidence: high
status: pending
applied-to: []
session: claude-code
---

# Hook のスクリプトの sed -i を、OS で書き分ける

## 事象

Hook のスクリプトで `sed -i 's/old/new/' file` を使った。Linux では動いたが、macOS の開発者の環境では sed がファイル名をコマンドとして読み、失敗した。

## 根本原因

macOS の BSD sed は `-i` の直後にバックアップの拡張子を必須の引数として取り、GNU sed は取らない。スクリプトは GNU sed の書き方だけを使っていた。

## 根拠

macOS と Linux の両方で同じスクリプトを実行し、macOS でだけ失敗することを再現した。KEDB 照合（sed・macOS）で一致は無かった。

## 既存の規約

- 扱い: なし
- 場所: なし
- 照合した範囲: `AGENTS.md`・`docs/` を `sed -i`・`BSD` で検索した

## 提案

Hook のスクリプトで `sed -i` を使うときは、OS に合わせて引数を変える。
