---
date: 2026-11-20
type: skill
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# check-run が現れないまま止まった Copilot への依頼を、外して依頼し直す手順が無い

## 事象

PR #1094 で、pr-finalize-loop が Copilot にレビューを依頼したところ、`requested_reviewers` の POST が HTTP 504 を返した。
タイムラインには Copilot 宛ての `review_requested` が記録されたが、check-run `copilot-pull-request-reviewer` は作られず、約 2 時間レビューが届かなかった。
同じ POST をもう一度送っても、タイムラインに新しい依頼は記録されなかった。`copilot-pull-request-reviewer[bot]` を渡した DELETE は 422 を返した。
GitHub の画面では、Copilot がレビュー中のように表示されていた。
利用者が画面で Copilot を外して依頼し直すと、タイムラインに `review_request_removed` と `review_requested` が記録され、5 分でレビューが届いた。

## 根本原因

- なぜ届かなかったか: 504 を返した依頼が、Copilot の側でレビューを始めないまま、依頼の状態だけが残った
- なぜループが回復できなかったか: `references/review-request.md` は、タイムラインに Copilot 宛ての `review_requested` があれば進行中とみなし、重ねて依頼しない。
  check-run が一度も現れない依頼を、止まった依頼として見分ける条件も、外して依頼し直す手順も無い
- なぜ API で直せなかったか: 依頼を外す DELETE に渡す login の形が、手順に書かれていない（依頼の POST の形だけがある）

## 提案

Copilot に依頼してから check-run が現れないまま上限（観測した届くまでの時間の数倍）を超えたら、止まった依頼とみなし、外して依頼し直す手順を `references/review-request.md` に足す。

- 外す API の形（DELETE に渡す login）を実測して書く。API で外せなければ、画面で外して依頼し直すよう利用者に頼む
- 依頼の POST が 5xx を返したときは、成立を確かめる条件にこの止まった状態も含める
