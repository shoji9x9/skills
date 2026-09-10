---
date: 2026-09-09
type: hook
priority: high
status: pending
applied-to: []
session: codex
---

# Codex transcript の非会話レコード追加で Kaizen ゲートを恒久停止させない

## 事象

Codex CLI 0.153.4 の transcript を `kaizen-candidate-scan.sh` で走査すると、候補自体は検出できる一方、`unsupported or malformed record` として exit 2 になり、Issue #311 の commit 前ゲートが停止した。

本文を露出させず構造を調べると、走査器が未対応の top-level `token_usage_record` が162件あり、
`event_msg.item_completed` 内にも `EnteredReviewMode` / `ExitedReviewMode` が追加されていた。
いずれもユーザー発話・ツール失敗・ファイル編集ではない非会話メタデータだった。

## 根本原因

1. なぜ候補を検出できても走査全体が判定不能になったか → 既知コンテナ内の未知 subtype を fail-closed で `X` にするため、非会話レコード1件でも exit 2 になる。
2. なぜ非会話レコードが未知 subtype のままだったか → Codex CLI 0.153.4 がトークン使用量と review mode のレコードを追加したが、走査器の認識集合とfixtureが追従していなかった。
3. なぜCLI更新でcommit経路が恒久停止したか → transcript schemaが独立に進化する境界なのに、現行CLIが出す非会話レコードの構造を回帰fixtureへ取り込む更新経路が無かった。これが対策可能な根本原因。

KEDBを `background process` / `exec_command` / `namespace` で照合したが直接一致は無かった。
横断スコープは、Codex transcript の top-level record と `item_completed` の全 subtype、およびClaude Code等ほかのexecutor形式。
未知形式を一律許容すると会話・失敗を見逃すため、非会話であることを構造と意味から確認できる形式だけを閉じた集合として追加する必要がある。

## 提案

Codex transcript の非会話レコードを閉じた集合で認識し、会話を運ぶ未知形式の fail-closed を維持したまま CLI の schema drift を fixture と変異テストで検出する。

Issue #322 で `token_usage_record`、`EnteredReviewMode`、`ExitedReviewMode` を追加し、候補あり／候補なしの弁別と判定分岐を無効化した変異で回帰テストが赤くなることを確認する。

2026-09-10 の Codex セッションでも候補行を5件検出した後に未知または malformed record として exit 2 になり、Issue #324 の commit 前ゲートが再び停止した。Issue #322 の対応完了までは同じ停止が継続するため、本件の優先度 high を維持する。

同セッションで PR #325 の finalize loop を再開した際も、候補行を検出後に未知または malformed record として exit 2 になり、追加レビュー修正の commit が停止した。
