---
date: 2026-07-01
type: hook
priority: low
status: applied
applied-to:
  - scripts/hook-root.sh
session: claude-code
---

# アーカイブ済みの Hook 調査

## 事象

古い Hook 実装ではサブディレクトリから起動したときだけパス解決が変わった。

## 根本原因

再現ログに ONLY_ARCHIVE_BODY_MARKER という識別子が含まれていたが、原因は cwd の暗黙利用だった。

## 提案

Hook のルート解決を共通関数へ寄せる。
