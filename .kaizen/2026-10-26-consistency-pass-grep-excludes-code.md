---
date: 2026-10-26
type: doc
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# 整合パスの grep の範囲を手で絞ったため、範囲の外に残った古い記述をレビューで指摘された

## 事象

Issue #781 で report が meta.json を書くようにした。整合パスで「reviews.csv」「3 つの CSV」を grep したが、`--include=*.md` で Markdown に限った。
report.mjs の先頭のコメントとテストの名前に「HTML と 3 つの CSV を書く」が残り、PR #783 の Copilot のレビューで指摘されて、直す commit と再レビューが 1 往復増えた。

2026-11-25 の Issue #1143 で、claude-code-action に `allowed_bots` を足し、token を `.git/config` に書く形が変わることを文書に反映した。
整合パスの grep を `git grep -- skills docs scripts .github AGENTS.md` に絞った。`.agents/` はインストール済みのコピーを含むので外したが、`.agents/rules/` も一緒に外れた。
`.agents/rules/github-actions-authoring.md` に「token を remote の URL に書く」が残り、push の前の `/code-review` が指摘した。

## 根本原因

1. なぜ見落としたか → grep の対象を手で絞った（1 回目は拡張子、2 回目はディレクトリ）
2. なぜ絞ったか → 1 回目は出力ファイルの一覧は文書にだけ書かれていると思い込んだ。2 回目はインストール済みのコピーの重複を避けようとして、同じディレクトリの rule まで外した
3. なぜ止まらなかったか → docs/skill-development.md「push 前の整合パス」は「対象のファイルを grep」と書くだけで、grep の範囲を決めていない ← 根本原因

## 根拠

1 回目の観測では、`--include=*.md` を付けた grep は 0 件だった。絞らずに grep すると、report.mjs と cli.test.ts に 1 件ずつ当たった。
2 回目の観測では、`/code-review` が `.agents/rules/github-actions-authoring.md:37` を指摘した。整合パスの grep の出力に `.agents/` のファイルは 1 件も無かった。
KEDB 照合: 「整合パス」「grep」でこのノートが当たり、根本原因（grep の範囲を手で絞る）が同じだったので、確信度を high にした。

## 提案

整合パスの grep は、拡張子でもディレクトリでも絞らずにリポジトリ全体（`git grep`）で実行し、インストール済みのコピー（`.agents/skills/` と `.claude/`）だけを後から除く。

- 反映先: docs/skill-development.md「push 前の整合パス」の 1。「対象のファイルを grep」に、範囲はリポジトリ全体で、除くのはインストール済みのコピーだけと書き足す
- テストの名前を変えるときは、ミューテーションテストの定義の expect_failing も grep する
