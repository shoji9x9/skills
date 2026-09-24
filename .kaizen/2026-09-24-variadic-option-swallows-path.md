---
date: 2026-09-24
type: hook
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 手順書のコマンドは前例を写すときも実走し、可変長オプションの後ろに位置引数を置かない

## 事象

parity-suite の baseline.md にあった `npx playwright test --project current <dir>` は、
Playwright 1.61 / 1.63 の両方で `Project(s) "<dir>" not found` になって落ちる。
`--project` は複数の値を取るので、後ろのパスをプロジェクト名として飲み込む。
Issue #449 ではこの既存の形を写して新しいコマンドを書き、実ブラウザで回した時点で初めて発覚した。

## 根本原因

- なぜ落ちる? 可変長オプションの直後に位置引数を置いた
- なぜ書かれた? 手順書のコマンドは実行されず、テスト・lint も Markdown 内のコマンドを検証しない
- なぜ写した? 既存の前例を「検証済み」と扱った。実走の規約（external-tool-format-verification）は新規の記述にしか意識されず、強制点も無い

## 提案

Markdown のシェルコードブロックで、可変長オプション（`playwright test --project` 等）の直後に位置引数が続く形を落とす lint を、`scripts/lint-pagination.js` と同じ入口に足す。

- 対象 CLI とオプションは表で持ち、陽性（パスを後ろに置いた形）と陰性（パスを先に置いた形・`--project=a`）の両方をテストに置く
- 横断: skills/ 内の `--project <名前> <パス>` 形は 2 件（今回修正済み）
