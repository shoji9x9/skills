---
date: 2026-06-05
type: doc
priority: medium
status: pending
session: claude-code
---

## 事象

`dependabot-automerge` ワークフローのラベル付与ステップ（`gh label create` /
`gh pr edit --add-label`）に必要な `issues: write` が job の `permissions` に無く
（`contents: write` / `pull-requests: write` のみ）、Copilot レビューで指摘された。
このままだとランタイムでラベル作成・付与が失敗し、`dependabot/needs-review` への
振り分けが機能しない恐れがあった。

## 根本原因

GitHub のラベルは Issues API のリソースで、リポジトリラベル作成（`gh label create`）や
ラベル付与には `issues: write` が必要。「PR への操作だから `pull-requests: write` で足りる」
と誤認した。最小権限を設計するとき「使う gh/REST 操作 → 必要な GITHUB_TOKEN permission」を
突き合わせる手順が無かったのが根本原因（actionlint は権限不足を検出しない）。

## 提案

GitHub Actions のジョブ権限を最小化する際、使用する操作と必要権限を必ず突き合わせる。特に:

- ラベル操作（`gh label` / `--add-label` / `--remove-label`）・Issue 作成/コメントを行う
  ジョブは `issues: write` を付ける。
- 同リポジトリの `outdated.yml` は Issue 作成のため既に `issues: write` を持つ（前例）。
  ラベルも同じ Issues API リソースである点を見落とさない。

actionlint では検出できないため、ワークフロー追加時のレビュー観点（doc/チェックリスト）として
残す。関連: [[2026-06-05-dependabot-commit-prefix-from-commit-types]]。
