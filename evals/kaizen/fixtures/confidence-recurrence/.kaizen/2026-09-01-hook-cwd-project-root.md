---
date: 2026-09-01
type: hook
priority: medium
status: pending
applied-to: []
session: claude-code
---

# Hook はプロジェクトのルートを git root から決める

## 事象

pre-commit の Hook をサブディレクトリから起動すると、制御ファイルをそのサブディレクトリの下に作った。

## 根本原因

Hook のスクリプトが git root を解決せず、起動時の cwd をプロジェクトのルートとして使っていた。

## 提案

Hook のスクリプトは、環境変数、git root、cwd の順でプロジェクトのルートを決める。
