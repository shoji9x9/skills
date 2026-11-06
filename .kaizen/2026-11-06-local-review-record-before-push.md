---
date: 2026-11-06
type: skill
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# local レビューの記録を、直して push する前に投稿していない

## 事象

PR #920 で pr-finalize-loop を review_tool: local で回した。
反復 1 と 2 で、/code-review の指摘を直して push したが、レビューした HEAD の記録を local-review-record.sh post で投稿していなかった。
次の反復で check の previous が空になり、PR の全体をレビューし直した。前の反復で解決した指摘が 5〜6 件ずつ戻ってきた。

## 根本原因

- なぜ投稿しなかったか: 行に付いた指摘に対応することだけを反復の仕事と捉え、review-tool.md の local の手順 3（記録の投稿）を飛ばした。
- なぜ飛ばしたか: SKILL.md の手順 6 は「push した反復でだけ、新しい HEAD をレビューして記録する」と書き、記録を push の後の段に置いている。
  そのため、レビューの直後で直す前に記録する必要があることに気付かなかった。
- なぜ問題になるか: 記録はレビューした SHA が HEAD のときしか投稿できない（post は exit 1）。
  直して push した後では、前の HEAD の記録を残せず、次の反復が差分だけをレビューできない。

## 根拠

原因を 1 つに絞れているが、観測は 1 回なので medium にした。反復 1 と 2 の後の check は records=0 だった。反復 3 で初めて、push の前に記録を投稿した。

## 提案

review_tool: local では、レビューを終えた直後、指摘を直す前に、レビューした HEAD の記録を投稿する。

- pr-finalize-loop の SKILL.md の手順 6 の local の段に「記録は、その HEAD の指摘を直して push する前に投稿する」を足す。
- 機構は作らない（観測は 1 回）。
