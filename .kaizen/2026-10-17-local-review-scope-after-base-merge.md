---
date: 2026-10-17
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# ベースブランチを取り込んだ後の手元の再レビューが、PR の変更全体に戻る

## 事象

PR #671 で、5 回目の記録の後に main を取り込み（merge commit 27873b73）、残した指摘 8 件を直した。
review-tool.md の「local」は、previous から HEAD までに merge commit があれば PR の変更全体をレビューすると定めている。
直した差分は数十行なのに、手順どおりなら全体のレビューになるため、手順から外れて「修正の commit の差分と、競合を解消した 2 ファイルの差分」だけをレビューした。

## 根本原因

1. なぜ手順から外れたか → merge を挟むと、差分のレビューの方法が「全体」しか書かれていない
2. なぜ全体しか無いか → previous..HEAD の差分にベースの変更が入るのを避ける方法として、いちばん単純なものだけを書いた
3. なぜ単純なものだけか → PR の変更だけを取り出す方法（取り込みの前後で PR の差分どうしを比べる）を、#669 の設計で検討しなかった ← 根本原因

## 提案

ベースブランチを取り込んだ後の手元の再レビューは PR の変更全体に戻さず、取り込みの前後で PR の差分どうしを比べた差分（`git range-diff` か merge-base からの差分の比較）と競合を解消したファイルの差分だけを対象にする。

- 反映先の候補: pr-finalize-loop と pr-review-handle の `references/review-tool.md`「local」のレビューの範囲の項
- 取り込みの前後で比べられない形（rebase で previous が祖先でない）は、今のまま全体をレビューする
