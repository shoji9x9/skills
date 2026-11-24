---
date: 2026-11-02
type: hook
priority: medium
confidence: medium
status: pending
applied-to: []
recurrence-of: [2026-10-05-lockfile-not-updated.md]
session: claude-code
---

# 依存を変えた後に lockfile を更新せずに検証し、規約を書いた後も失敗した

## 事象

`package.json` の `dependencies` に `zod` を足した後、`pnpm install` を実行せずに `pnpm install --frozen-lockfile` を実行した。
Bash の呼び出しが exit 1 で失敗した。
エラーの文は `ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with package.json` だった。
同じコマンドをもう 1 回実行して同じエラーになり、その後に `pnpm install` を実行して通した。

## 根本原因

- なぜ失敗したか: lockfile を更新せずに `--frozen-lockfile` で検証した
- なぜ更新しなかったか: `AGENTS.md`「作業の規約」に手順はあったが、依存を足す作業の途中では思い出さなかった
- なぜ思い出さなかったか: 規約は文章だけで、エラーが返った時点で規約を知らせる仕組みが無い

## 根拠

同じ原因の学び `2026-10-05-lockfile-not-updated.md`（applied、適用先は `AGENTS.md`）の後に再発した。このセッションの観測で原因を 1 つに絞れたので medium にした。

## 既存の規約

- 扱い: 強制なし
- 場所: `AGENTS.md`「作業の規約」
- 照合した範囲: `AGENTS.md`・`docs/` を `frozen-lockfile` と `pnpm-lock.yaml` で検索した

## 食い違い

- 相手: なし
- 判断: なし

## 提案

規約を文章で足しても再発するので、依存を変えた後の lockfile の更新を強制する仕組みを検討する。

- 効果: 文章の規約を適用した後に再発した
- 費用: 未検討
