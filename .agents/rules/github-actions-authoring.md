---
paths:
  - ".github/workflows/**"
applyTo: ".github/workflows/**"
---

# GitHub Actions ワークフロー作成・変更時のレビュー観点

ワークフローを追加・変更するたびに、actionlint では検出できない次の設計上の観点を確かめる。

## 1. 必要権限の突き合わせ（最小権限）

ジョブの `permissions` を最小にするときは、使う `gh` や REST の操作ごとに、必要な `GITHUB_TOKEN` の permission を突き合わせる。

- ラベルの操作（`gh label create`・`gh pr edit --add-label`・`--remove-label`）と、Issue の作成・コメントは、Issues API のリソースを使うので `issues: write` が要る。
  PR への操作でも `pull-requests: write` だけでは足りない。`gh pr edit --add-label` にも `issues: write` が要る。
- 判断に迷ったら、同じリポジトリの既存のワークフローを参考にする（例: `outdated.yml` は Issue を作るので `issues: write` を持つ）。

## 2. 前のステップが失敗したときの代わりの処理

振り分け・通知・ラベルの付与のように、実行されないと困る処理を、その前の通常の処理のステップが失敗したら実行されない形にしない。

- 失敗しうるステップ（例: コンフリクトで失敗する `gh pr merge --auto`）には `continue-on-error: true` を付けてジョブを続ける。
  そのうえで、失敗したときに実行する処理を後ろのステップに用意する（例: 自動マージの予約に失敗したら、レビュー用のラベルを付ける）。
