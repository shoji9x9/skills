---
date: 2026-06-11
type: doc
priority: medium
status: applied
session: claude-code
---

## 事象

shellcheck の mise 移行（Issue #22）で、lefthook の shellcheck ジョブ 1 つの動作確認が目的
だったのに `lefthook run pre-commit --all-files` で pre-commit 一式を実行した。auto-fix 系
ジョブ（oxfmt）が全ファイルに適用され、`stage_fixed: true` により無関係な
`tests/**/benchmark.json` 2 件が index に stage された。commit 直前の `git status --short` で
検知し `git restore --staged --worktree` で復旧した。

## 根本原因

1. なぜ無関係ファイルが staged されたか → 検証目的に対して実行範囲が過大だった
   （目的はジョブ 1 つの確認。一式の実行で副作用＝auto-fix と staging が顕在化した）
2. なぜ範囲を広げたか → ジョブ単体の実行を試みてフラグ指定に 2 回失敗した際、`--help` で
   正しい絞り込み方を調べる代わりに「全部実行すれば確認できる」へ流れた
3. なぜそうなったか → 「目的を果たす上で最低限のツール実行にする」という行動原則が
   明文化されていない ← 根本原因（lefthook 固有ではなく検証行動全般の問題）

## 提案

`AGENTS.md` の「ワークフロー」節に行動原則を追記する（特定パスに紐づかない全エージェント
共通の原則のため、`paths:` でスコープする `.agents/rules/` ではなく AGENTS.md に置く）。文面:

> - **検証は目的を果たす最低限のツール実行で行う**。目的より広い一括実行（例:
>   `lefthook run pre-commit --all-files`）は auto-fix・`stage_fixed` による staging などの
>   副作用を伴う。絞り込み方が不明なら範囲を広げる前に `--help` 等で調べる。
>   広い実行をした場合は直後に `git status --short` で意図しない変更を確認して戻す。

適用済み: AGENTS.md「ワークフロー」節に上記文面を追記した。
