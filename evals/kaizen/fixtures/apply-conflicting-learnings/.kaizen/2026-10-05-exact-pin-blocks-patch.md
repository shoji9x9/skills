---
date: 2026-10-05
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 依存は範囲で足し、patch の修正を受け取れるようにする

## 事象

`pnpm audit` が `undici` の脆弱性を報告した。修正は patch のバージョンで出ていたが、`package.json` がバージョンを固定していたので `pnpm update` で上がらず、手で 3 つのパッケージを書き換えた。

## 根本原因

依存をバージョンの固定で足していたので、patch の更新を受け取るたびに `package.json` を手で書き換える必要があった。

## 根拠

1 回の観測で、原因をバージョンの固定に絞れた。KEDB 照合（audit・pnpm）で一致は無かった。

## 提案

依存は `pnpm add <パッケージ>` の `^` の範囲で足し、patch と minor の修正を `pnpm update` で受け取れるようにする。
