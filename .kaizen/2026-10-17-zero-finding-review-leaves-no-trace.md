---
date: 2026-10-17
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# pr-finalize-loop で code-review --comment の指摘が 0 件だったときも、レビューした HEAD の SHA と件数を PR にコメントで残す

## 事象

issue-batch の run で、PR #667 の反復 2（HEAD 8020796f）と PR #668（HEAD e7db7d7d）を `code-review --comment` でレビューした。
どちらも指摘が 0 件だったので、PR には何も投稿されなかった。
別のセッションが PR の timeline を調べ、「修正 commit の後に再レビューせずに merge した」「PR を作った後のレビューを省いた」と判断して、理由を尋ねてきた。
実際にはレビューしていたが、根拠は自分の transcript にしか無かった。

## 根本原因

- なぜ timeline からレビューが見えなかったか → `code-review --comment` は指摘を行コメントとして投稿するだけで、0 件の回は何も書かない
- なぜそれで収束と判定したか → `--review-tool none` では「HEAD がレビュー済み」を条件にしないので、レビューしたことを GitHub に残す手順が無い
- なぜ問題になるか → merge の判断の根拠が、他の人やエージェントが確かめられる場所に残らない

## 提案

pr-finalize-loop で code-review --comment の指摘が 0 件だったときも、レビューした HEAD の完全な SHA と件数を PR にトップレベルのコメントで残す。

- 適用先候補: `skills/pr-finalize-loop/SKILL.md` の `review_tool: none` の扱いと、手順 2 の完了の判定
- 見送った提案（文の書き方だけの提案など）があれば、その件数と理由も同じコメントに書く
