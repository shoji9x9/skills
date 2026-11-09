---
date: 2026-10-06
type: doc
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 一時ファイルは mktemp で作り、trap で消す

## 事象

テスト用のスクリプトが `/tmp/out.json` に書いたファイルが残り、次の実行で古い内容を読んでテストが誤って通った。

## 根本原因

一時ファイルを決まった名前で作り、スクリプトの終わりに消していなかった。

## 根拠

1 回の観測で、原因を一時ファイルの名前と後片付けの抜けに絞れた。KEDB 照合（一時ファイル・tmp）で一致は無かった。

## 提案

スクリプトの一時ファイルは `mktemp` で作り、`trap 'rm -f "$tmp"' EXIT` で消す。
