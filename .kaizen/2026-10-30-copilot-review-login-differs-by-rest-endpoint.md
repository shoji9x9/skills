---
date: 2026-10-30
type: doc
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# Copilot のレビューの作成者の login は REST の API ごとに違い、reviews の API で `Copilot` と照合すると届いたレビューを 0 件と判定する

## 事象

issue-batch の run の #801（PR #833）で、レビューの依頼先を copilot に変えた直後の反復 3 で、Copilot のレビューが届くのを待つスクリプトを書いた。
スクリプトは `pulls/<番号>/reviews` の応答を `.user.login=="Copilot"` で絞ったので、04:57 に届いたレビューを数えず、30 分の上限まで待って時間切れで終わった。
上限に達した後に、レビュー・check-run・タイムラインを取得し直して、レビューが届いていたことが分かった。

同じ PR で実測した作成者の login は次のとおりである。

- `pulls/<番号>/reviews` の `user.login`: `copilot-pull-request-reviewer[bot]`
- `pulls/<番号>/comments`（行に付いたコメント）の `user.login`: `Copilot`
- `issues/<番号>/timeline` の `review_requested` の `requested_reviewer.login`: `Copilot`
- GraphQL の `author.login`: `copilot-pull-request-reviewer`

## 根本原因

- なぜ届いたレビューを 0 件と数えたか → reviews の API の応答を `Copilot` で照合した
  - なぜ `Copilot` を使ったか → pr-finalize-loop の `references/review-tool.md` の「copilot」が「REST では `Copilot`」と書いており、REST のすべての API に当てはまると読んだ
    - なぜ当てはまらなかったか → 文書は、タイムラインと行のコメントの API で確かめた値を「REST」の値としてまとめていて、reviews の API で確かめていない ← 根本原因

## 根拠

同じ PR で 4 つの API の login を実測し、reviews の API だけが `copilot-pull-request-reviewer[bot]` を返したので high とする。
観測は、待つスクリプトが 30 分で時間切れになり、取得し直すとレビューは依頼の 3 分後に届いていたことである。
KEDB 照合では `copilot-pull-request-reviewer[bot]` と `Copilot` の login で `.kaizen/` を検索し、一致する学びは無かった。

## 提案

pr-finalize-loop の `references/review-tool.md` の「copilot」で、Copilot の作成者の login を REST の API ごとに書く。

- 書く値: reviews は `copilot-pull-request-reviewer[bot]`、行のコメントとタイムラインは `Copilot`、GraphQL は `copilot-pull-request-reviewer` である。

- 適用先: `skills/pr-finalize-loop/references/review-tool.md` の 89 行目と、Copilot のレビューを login で絞る手順（`references/state-query.md` など）
- 照合は login の文字列 1 つに頼らず、`user.type == "Bot"` と login の候補のどれかに一致するかで判定する形も検討する
- 確かめる状態: Copilot のレビューが付いた PR で、reviews・行のコメント・タイムライン・GraphQL の 4 つの API について、文書の手順で絞ったときに 1 件以上を返すこと
