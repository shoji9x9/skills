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

（同セッション内で再発・別観点）同じワークフローで、`decision=automerge` 時の
`gh pr merge --auto` がコンフリクト等で失敗するとジョブが落ち、`dependabot/needs-review`
への振り分けも実行されず PR が取りこぼされる（happy path のステップ失敗に fail-safe が
無い）と Copilot に指摘された。`continue-on-error` ＋ 失敗時もラベル付与する条件で対応。

## 根本原因

GitHub のラベルは Issues API のリソースで、リポジトリラベル作成（`gh label create`）や
ラベル付与には `issues: write` が必要。「PR への操作だから `pull-requests: write` で足りる」
と誤認した。最小権限を設計するとき「使う gh/REST 操作 → 必要な GITHUB_TOKEN permission」を
突き合わせる手順が無かったのが根本原因（actionlint は権限不足を検出しない）。

より一般には、**新規ワークフロー作成時に「actionlint では検出されない設計観点」を確認する
手順が無い**ことが共通の根本原因。今回は ①必要権限の突き合わせ ②happy path のステップ失敗時の
fail-safe フォールバック、の 2 観点が抜けて都度レビューで指摘された。

## 提案

GitHub Actions のジョブ権限を最小化する際、使用する操作と必要権限を必ず突き合わせる。特に:

- ラベル操作（`gh label` / `--add-label` / `--remove-label`）・Issue 作成/コメントを行う
  ジョブは `issues: write` を付ける。
- 同リポジトリの `outdated.yml` は Issue 作成のため既に `issues: write` を持つ（前例）。
  ラベルも同じ Issues API リソースである点を見落とさない。
- 振り分け・通知など「取りこぼすと困る」処理が、happy path のステップ失敗で飛ぶ設計を避ける。
  失敗しうるステップは `continue-on-error` でジョブを継続し、後段で fail-safe のフォールバック
  （例: 自動マージ予約に失敗したらレビューへ回す）を必ず用意する。

いずれも actionlint では検出できないため、**ワークフロー追加・変更時のレビュー観点（権限の
突き合わせ・fail-safe フォールバック）チェックリスト**として残す。
関連: [[2026-06-05-dependabot-commit-prefix-from-commit-types]]。
