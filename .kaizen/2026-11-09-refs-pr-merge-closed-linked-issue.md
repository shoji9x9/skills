---
date: 2026-11-09
type: doc
priority: medium
confidence: high
status: pending
applied-to: []
session: claude-code
---

# `Refs` と書いた PR をマージした後に、紐付けた Issue が閉じたかを確かめなかった

## 事象

PR #961 は、受け入れ条件の検査が `closable: false` だったので、本文に `Refs #941` と書いた。
ブランチは `gh issue develop` で作ったので、PR は #941 の Development に紐付いていた（`closingIssuesReferences` が `[941]`）。
マージすると #941 は `COMPLETED` で閉じたが、マージの後に Issue の状態を確かめなかった。
PR 2 に着手するときに、Issue の一覧で偶然気付き、理由をコメントして開き直した。

## 根本原因

- なぜ確かめなかったか → この扱いは `issue-start` の `references/acceptance.md` の手順 5 に書いてある（PR の本文に書く・merge の後に `state` と `stateReason` を取得し直す）。
  しかし、この文書を読むのは PR を作るときで、マージはコンテキストの圧縮をまたいだ後に、スキルを通さず手で行った
- なぜマージのときに思い出せなかったか → マージの手順（通常のマージ・ブランチの削除・マージ後のワークフローの確認）を書いた場所に、紐付けた Issue の状態を確かめる項目が無い。
  PR の本文にも、マージで Issue が閉じることを書いていなかったので、マージの前に読む材料にも無かった

## 提案

`issue-start` で作った PR を手でマージするときの手順に、マージの後に紐付けた Issue の `state` と `stateReason` を取得し、決めた状態と違えば理由をコメントして開き直す、と足す。

- 置き場所は、#962 で `AGENTS.md`「ブランチ運用」に足すマージの方法の記述と同じ箇所にする
- `closable: false` の PR を作るときは、`acceptance.md` の手順 5 のとおり、マージで Issue が閉じることを PR の本文に書く
