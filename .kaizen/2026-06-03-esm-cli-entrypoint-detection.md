---
date: 2026-06-03
type: doc
priority: medium
status: applied
session: claude-code
---

## 事象

`scripts/lint-pagination.mjs` の「CLI として直接実行されたか」の判定を
`import.meta.url === \`file://${process.argv[1]}\`` と書いた。相対パス起動や URL エスケープ
差で一致せず、pre-commit/CI から実行しても `main()` が走らない懸念をレビューで指摘された。

## 根本原因

Node ESM のエントリポイント判定に、文字列連結で `file://` URL を自作して比較していた。
`process.argv[1]` の正規化を経ていないため、環境差（相対パス・スペース・エスケープ）で
import.meta.url と不一致になりうる。

## 提案

- 一般化ルール: ESM スクリプトの直接実行判定は
  `import.meta.url === pathToFileURL(process.argv[1]).href`（`node:url` の `pathToFileURL`
  で正規化）を使う。`file://` の自作比較はしない。
