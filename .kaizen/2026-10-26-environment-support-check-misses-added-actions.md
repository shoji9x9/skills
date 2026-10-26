---
date: 2026-10-26
type: rule
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 実行環境への対応を足すとき、同じ変更で足した action がその環境で動くかを確かめていなかった

## 事象

Issue #780（GitHub Enterprise で追跡 Issue を書けない）に対応する PR #785 で、gh に `GH_HOST` を渡し、GHES 向けに `GH_ENTERPRISE_TOKEN` も渡した。
同じ PR の #779 の対応で、`actions/upload-artifact` と `actions/download-artifact` の v7・v8 を新しく足した。
この 2 つの v4 以降は GHES で使えないことを確かめておらず、Copilot のレビューの本文で指摘されてから、受け渡しの失敗を Issue に書く修正と、`setup.md` の注記を足した。
手元の `/code-review` でも見つからなかった。

## 根本原因

- なぜ GHES で動かない action を足したか: action を足すときに確かめたのは入力の名前と SHA だけで、対応する実行環境を確かめなかった
- なぜ確かめなかったか: GHES を対象に足したのは gh のホストの解決だけで、対象の環境をワークフローの全体の前提として扱わなかった
- なぜ全体の前提にならなかったか: 外部ツールを確かめる規約（`external-tool-format-verification`・`github-actions-authoring`）は、設定の形と権限を挙げるが、対応する実行環境（GHES・self-hosted・OS）を確かめる観点を持たない。これが根本原因である

## 根拠

確信度 medium: 1 回の観測で、原因を「対応する環境を確かめる観点が無い」に絞れている。
Issue #780 の対応で GHES を対象に入れた後、同じ PR で GHES に対応しない action を足し、レビューの本文の指摘で気付いた。
`upload-artifact` の README に、v4 以降は GHES で使えないと書かれていることを確かめた。
KEDB 照合（GHES・artifact）は一致なし。

## 提案

ワークフローに実行環境（GHES・self-hosted runner・OS）への対応を足すときは、そのワークフローが使うすべての action と CLI を挙げ、公式のドキュメントでその環境に対応するかを 1 件ずつ確かめる。

- 適用先の候補: `.agents/rules/github-actions-authoring.md` に観点を 1 節足す。配布テンプレート（`skills/*/assets/*.yml`）も `paths` に入れるかを検討する
- 対応しない action は、その環境での振る舞い（失敗のしかたと、Issue に書く文）を決め、文書に書く
