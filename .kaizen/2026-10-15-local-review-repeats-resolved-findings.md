---
date: 2026-10-15
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# ローカルの再レビューが、解決済みのスレッドで見送った指摘を載せ直し、pr-finalize-loop が収束しない

## 事象

PR #640 の pr-finalize-loop で、反復ごとにローカルの `/code-review --comment 640` でレビューした。
反復 2・3・4 のそれぞれで、前の反復で根拠を書いて解決した指摘（対のグループ、上限 50 のチェック、eval の追加）が 2〜3 件ずつ載り直した。
各反復の指摘は約 5 件で、反復を重ねても減らなかった。

## 根本原因

1. なぜ載り直したか → `/code-review` は差分だけを読み、PR の解決済みのスレッドと返信を読まない
2. なぜ読まないまま起動したか → pr-finalize-loop は mention で依頼するツールを前提にしていて、ローカルのレビューに既存の判断を渡す手順が無い
3. なぜ手順が無いか → ローカルの `/code-review` で回す運用はメモリにしか書かれていない（`review_tool` の値にも無い）

## 提案

反復ごとにローカルのレビューを回すときは、解決済みのスレッドの指摘と返信をレビューの入力に渡し、見送った指摘は新しい根拠が無ければ載せ直さないようにする。

- 反映先の候補: pr-finalize-loop の `references/review-tool.md` に、ローカルのレビュー（`/code-review --comment`）を使う場合の依頼の仕方を足す
- 載り直した指摘は、前の返信の URL を示して解決する（今回の対応）
