---
paths:
  - ".github/workflows/**"
applyTo: ".github/workflows/**"
---

# GitHub Actions ワークフロー作成・変更時のレビュー観点

actionlint では検出できない設計観点を、ワークフローを追加・変更するたびに必ず確認する。

## 1. 必要権限の突き合わせ（最小権限）

ジョブの `permissions` を最小化するとき、**使う `gh`/REST 操作 → 必要な `GITHUB_TOKEN` permission** を突き合わせる。

- ラベル操作（`gh label create` / `gh pr edit --add-label` / `--remove-label`）・Issue 作成/コメントは
  **Issues API のリソース**なので `issues: write` が要る。「PR への操作だから `pull-requests: write` で足りる」は誤り
  （`gh pr edit --add-label` でも `issues: write` が必要）。
- 迷ったら同リポジトリの既存ワークフローを前例にする（例: `outdated.yml` は Issue 作成のため `issues: write` を持つ）。

## 2. happy path 失敗時の fail-safe フォールバック

「取りこぼすと困る」処理（振り分け・通知・ラベル付与）が、その手前の happy path ステップの失敗で飛ぶ設計を避ける。

- 失敗しうるステップ（例: `gh pr merge --auto` がコンフリクトで失敗）は `continue-on-error: true` でジョブを継続し、
  後段に fail-safe（例: 自動マージ予約に失敗したらレビュー用ラベルへ回す）を必ず用意する。
