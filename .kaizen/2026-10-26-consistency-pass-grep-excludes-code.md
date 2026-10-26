---
date: 2026-10-26
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 整合パスの grep を Markdown に限ったため、コードコメントの古い記述をレビューで指摘された

## 事象

Issue #781 で report が meta.json を書くようにした。整合パスで「reviews.csv」「3 つの CSV」を grep したが、`--include=*.md` で Markdown に限った。
report.mjs の先頭のコメントとテストの名前に「HTML と 3 つの CSV を書く」が残り、PR #783 の Copilot のレビューで指摘されて、直す commit と再レビューが 1 往復増えた。

## 根本原因

1. なぜ見落としたか → grep の対象を Markdown に絞った
2. なぜ絞ったか → 出力ファイルの一覧は文書にだけ書かれていると思い込んだ
3. なぜ思い込みが止まらなかったか → docs/skill-development.md 「push 前の整合パス」は「対象のファイルを grep」と書くだけで、コードコメントとテストの名前を対象に含めるとは書いていない ← 根本原因

## 根拠

1 回の観測だが、原因は grep の対象の絞り込み 1 つに絞れる。
整合パスの grep は `--include=*.md` を付けて 0 件だった。絞らずに grep すると、report.mjs と cli.test.ts に 1 件ずつ当たった。
KEDB 照合: 「整合パス」「grep」で 2 件が当たったが、どちらも別の原因だった。「コードコメント」「整合」は一致なし。

## 提案

整合パスで編集した概念を grep するときは、拡張子で絞らず、コードコメント・テストの名前・利用者に表示するメッセージまで対象にする。

- 反映先: docs/skill-development.md「push 前の整合パス」の 1。「対象のファイルを grep」に、対象は文書だけでなくスクリプトとテストを含むと書き足す
- テストの名前を変えるときは、ミューテーションテストの定義の expect_failing も grep する
