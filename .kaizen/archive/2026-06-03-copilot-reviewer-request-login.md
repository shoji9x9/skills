---
date: 2026-06-03
type: doc
priority: high
status: applied
session: claude-code
---

## 事象

PR に Copilot のレビューを再依頼するため
`gh api --method POST .../requested_reviewers -f "reviewers[]=Copilot"` を実行したが、
HTTP 200 が返るのに requested_reviewers に Copilot が追加されず（無言の no-op）、
timeline にも review_requested イベントが出ず、再レビューが始まらなかった。原因究明に
何度も空振りした。

## 根本原因

REST `requested_reviewers` に渡す reviewer 識別子が誤っていた。Copilot は GitHub App の
Bot で、正しい login は `copilot-pull-request-reviewer[bot]`。検証結果:

- `Copilot`（requested_reviewers の表示 login）→ 200 だが無言で無視（未追加）。
- `copilot-pull-request-reviewer`（slug）→ 422「collaborator でない」。
- `copilot-pull-request-reviewer[bot]` → 200 で追加成功（timeline に review_requested 記録）。

GraphQL `requestReviews` の `userIds` は User 専用で、Copilot の Bot node id は弾かれる。

## 提案

- `pr-review-handle` の依頼コマンドは `reviewers[]=copilot-pull-request-reviewer[bot]` を使う
  （表示名 `Copilot` や slug は不可）。実装済み。
- 一般化: Bot を reviewer 依頼するときは `<app-slug>[bot]` の login を使う。依頼後は
  requested_reviewers を必ず確認する（誤識別子は 200 の無言 no-op になりうるため）。
