---
date: 2026-09-30
type: hook
priority: high
status: applied
applied-to: [skills/kaizen/scripts/kaizen-candidate-scan.sh, scripts/skills/kaizen/kaizen-precommit-gate.test.ts]
session: claude-code
---

# スキル本文の注入（isMeta の user レコード）を user correction と誤検知してコミットが止まる

## 事象

Issue #525 の lockfile 更新を commit しようとしたところ、kaizen のコミット前チェックが `user correction: transcript line 52` でブロックした。
line 52 は `git-worktree` スキルの起動で Claude Code が注入したスキル本文で、`type: "user"` だが `isMeta: true`・`sourceToolUseID` 付きのレコードだった。
本文に含まれる「ではなく」等の語が修正語の正規表現に当たった。ユーザーの発話は Issue 指定と「PR作成して下さい」だけで、修正指示は無かった。

2026-10-10、Issue #588 の PR #589 のレビュー対応を commit しようとしたところ、同じチェックが `user correction: transcript line 860` で止めた。
line 860 は `pr-finalize-loop` スキルの起動で注入されたスキル本文（`type: "user"`・`isMeta: true`）で、ユーザーの発話ではなかった。
同じセッションで 2 回目の commit の停止で、スキルを起動するたびに再発する。

## 根本原因

- なぜ止まったか → スキャナが line 52 を user correction の候補にした
- なぜ候補になったか → `kaizen-candidate-scan.sh` の `user_text` は `type == "user"` のレコードの `text` 要素をすべてユーザー発話として扱い、`isMeta` を見ない
- なぜ見ていないか → `tool_result` の除外（同じ種の誤検知の実測）は入れたが、Claude Code が user ロールで運ぶ非発話レコード（スキル本文・system 注入）の種類を列挙していなかった。スキルを 1 つ起動するだけで、長い日本語本文が必ず走査に入る

## 提案

transcript 走査で「ユーザー発話」を拾う検査は、ロールだけで判定せず、同じロールで運ばれる非発話レコード（Claude Code の `isMeta: true` 等）を列挙して除外する。

- `kaizen-candidate-scan.sh` の `elif $j.type == "user"` 分岐で、`$j.isMeta == true` のレコードは `U` を出さない（`E` の tool error 抽出は維持）
- 検出と誤検知の確認: 同じ修正語を含む `isMeta` 無しの user レコードは引き続き候補になること、`isMeta: true` のレコードは候補にならないことをテストに置く（`scripts/*.mutations.json` の宣言も追随）
- 横断スコープ: Codex / Copilot の transcript に同種の注入レコード（スキル本文を user ロールで運ぶもの）があるかを実物で確かめる

## 適用（2026-10-14・Issue #601）

- Claude Code: `isMeta: true` の user レコードから `U` を出さない。実際の transcript で、スキルの本文・別のエージェントからの報告・ローカルコマンドの注記が `isMeta: true` だった
- Codex: 手元の全 transcript の `response_item` の `role: user` を調べ、注入の形を 8 種類確かめた。この閉じた集合だけを外す。
  - 本文の先頭が `# AGENTS.md instructions for` のもの
  - 先頭のタグが `<skill>`・`<user_action>`・`<recommended_plugins>`・`<turn_aborted>` のもの
  - 先頭のタグが `<environment_context>`・`<codex_internal_context>`・`<user_shell_command>` のもの
- Copilot: transcript を走査ツールに渡さないので、対象にならない
