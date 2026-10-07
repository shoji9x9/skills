---
date: 2026-09-30
type: hook
priority: medium
status: pending
applied-to: []
session: claude-code
---

# スキル本文の注入（isMeta の user レコード）を user correction と誤検知してコミットが止まる

## 事象

Issue #525 の lockfile 更新を commit しようとしたところ、kaizen のコミット前チェックが `user correction: transcript line 52` でブロックした。
line 52 は `git-worktree` スキルの起動で Claude Code が注入したスキル本文で、`type: "user"` だが `isMeta: true`・`sourceToolUseID` 付きのレコードだった。
本文に含まれる「ではなく」等の語が修正語の正規表現に当たった。ユーザーの発話は Issue 指定と「PR作成して下さい」だけで、修正指示は無かった。

## 根本原因

- なぜ止まったか → スキャナが line 52 を user correction の候補にした
- なぜ候補になったか → `kaizen-candidate-scan.sh` の `user_text` は `type == "user"` のレコードの `text` 要素をすべてユーザー発話として扱い、`isMeta` を見ない
- なぜ見ていないか → `tool_result` の除外（同じ種の誤検知の実測）は入れたが、Claude Code が user ロールで運ぶ非発話レコード（スキル本文・system 注入）の種類を列挙していなかった。スキルを 1 つ起動するだけで、長い日本語本文が必ず走査に入る

## 提案

transcript 走査で「ユーザー発話」を拾う検査は、ロールだけで判定せず、同じロールで運ばれる非発話レコード（Claude Code の `isMeta: true` 等）を列挙して除外する。

- `kaizen-candidate-scan.sh` の `elif $j.type == "user"` 分岐で、`$j.isMeta == true` のレコードは `U` を出さない（`E` の tool error 抽出は維持）
- 検出と誤検知の確認: 同じ修正語を含む `isMeta` 無しの user レコードは引き続き候補になること、`isMeta: true` のレコードは候補にならないことをテストに置く（`scripts/*.mutations.json` の宣言も追随）
- 横断スコープ: Codex / Copilot の transcript に同種の注入レコード（スキル本文を user ロールで運ぶもの）があるかを実物で確かめる
