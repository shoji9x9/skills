---
date: 2026-08-01
type: hook
priority: medium
status: pending
applied-to: []
session: codex
---

# Hook のプロジェクトルート解決を統一する

## 事象

pre-commit hook をサブディレクトリから起動すると、制御ファイルを誤った場所へ作成した。

## 根本原因

hook script が git root を解決せず、呼び出し時の cwd をプロジェクトルートとみなしていた。

## 提案

hook script は環境変数、git root、cwd の順でプロジェクトルートを解決する。
