---
date: 2026-06-03
type: doc
priority: medium
status: pending
session: claude-code
---

## 事象

`git add <files>` と `git commit` を 1 つの bash 呼び出しにまとめて実行したところ、
kaizen の PreToolUse ゲートが「`git commit` を含む呼び出し全体」を実行前にブロックした。
その結果 `git add` も走らず staging されないまま進み、修正が未コミットのまま push され
かけた（HEAD を確認して検知し、別コマンドで commit し直した）。

## 根本原因

ゲートの注意書きは「センチネル削除と `git commit` を 1 コマンドにまとめるな」だが、これは
`rm` に限らず `git add` などコミット前準備全般に当てはまる。`git commit` を含む bash 呼び出しは
丸ごとブロックされる、という一般則を見落としていた。

## 提案

- コミット前の `git add` 等は `git commit` と必ず別コマンドで実行する（同一コマンドだと
  ゲートが全体をブロックし staging も実行されない）。コミット後は `git log` / `git show` で
  対象が実際に入ったか確認する。
