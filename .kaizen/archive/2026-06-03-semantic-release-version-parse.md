---
date: 2026-06-03
type: doc
priority: medium
status: applied
session: claude-code
---

## 事象

`release.yml` の version 抽出 grep を当初 `The next release version is`（大文字 T）で
書いたが、semantic-release は初回リリース時のみ
`There is no previous release, the next release version is X.Y.Z`（小文字 the）と
出力するため、初回リリースで版を取りこぼす不具合があった。検証中に発覚し
case-insensitive（`grep -oiP`）へ修正した。

## 根本原因

外部ツール（semantic-release）の出力文言を、実際の全パターンを確認せず想定の
固定文字列で parse した。初回リリースと 2 回目以降でメッセージ書式が変わることを
見落とした。

## 提案

- 確定的対処は実装済み: `release.yml` の抽出は `grep -oiP`（case-insensitive）にする。
- 退行防止として該当行に「初回は小文字 `the` のため `-i` 必須」のコメントを残し、
  将来「大文字固定に簡素化」して再発するのを防ぐ。
- 一般化: 外部ツールの出力を文字列 parse する際は、初回 / エッジケースで文言が
  変わりうる前提で、可能なら機械可読出力（JSON 等）か case-insensitive を選ぶ。
