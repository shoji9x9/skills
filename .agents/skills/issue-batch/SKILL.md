---
argument-hint: <setup | run <Issue URL | 番号>...> [options]
description: 複数の GitHub Issue を入力順に、Issue ごとの隔離 worktree・独立 branch / PR で連続処理し、実装、ローカルレビュー、検証、必要なブラウザ回帰、Kaizen、PR 収束、自動マージ、Issue close、deployment、branch cleanup まで追跡するスキル。初回は `issue-batch setup` で無人実行ポリシーを確定する。「複数 Issue をまとめて処理」「Issue を順番に最後まで」「issue-batch」や `run` / `setup` を伴う依頼で必ず使う。
license: MIT
name: issue-batch
---
# Issue Batch

複数 Issue を 1 件ずつ直列に処理する。各 Issue は独立した branch / PR と隔離 worktree を持ち、1 件の失敗で他の作業ツリーを汚染しない。

## 使い方

```text
issue-batch setup

issue-batch run <Issue URL | 番号>... \
  [--browser-test-env <環境名>] \
  [--max-local-review-iterations <N>] \
  [--max-pr-iterations <N>] \
  [--wait-ci-before-review | --no-wait-ci-before-review] \
  [--merge-method <squash|merge|rebase>] \
  [--max-deployment-fix-iterations <N>] \
  [--stop-on-blocked]
```

- 公開サブコマンドは `setup` と `run` だけ。bare invocation、サブコマンドを省略した Issue 指定、未知のサブコマンドは usage を示して**変更前に停止**する。
- `setup` は引数と `run` 用 option を受理しない。`run` は 1 件以上の Issue を必須とし、option は `run` の後ろだけで解釈する。
- URL と番号を混在できるが、全 Issue は current repository と同じ owner/repo でなければならない。
- 1 Issue 1 branch / 1 PR。stacked PR と複数 Issue の 1 PR 化は対象外。

## 前提

- **ツール**: `gh`, `git` と現在のコーディングエージェントの非対話レビュー機能
- **前提スキル**: `git-worktree`, `issue-start`, `kaizen`, `pr-finalize-loop`。画面影響がある場合は `browser-test`
- **設定**: `.config/skills/shoji9x9/skills.yml` の `skills.issue-batch`。`skills.common.review_tool` と `skills.browser-test` は参照するが複製しない
- **シェル**: bash。Windows では WSL / Git Bash 等を使う

前提スキルを読めない、または設定が不足している場合は契約を推測せず停止する。`run` 中に設定質問を始めず、`issue-batch setup` を案内する。

## モード

### setup

`references/project-config.md` を読み、repository 固有の無人実行ポリシーを対話的に確定する。Issue、branch、PR、merge、deployment は操作しない。

### run

実行前に `references/project-config.md` と `references/orchestration.md` を**両方最後まで読む**。次の順で進める。

1. 全体 preflight を変更前に完了する。入力の正規化、重複、repo / Issue と PR の状態、依存関係、既存 branch / PR / worktree、設定、認証・権限、レビュー機能、Kaizen の transcript 同定、browser-test の安全性を確認する。
2. `/tmp` に run manifest を作る。入力順、Issue URL、状態、branch、worktree、PR URL、試験結果、停止理由だけを記録し、秘密値と動的な環境 URL は書かない。
3. 呼び出し元 worktree を checkout せず、Issue ごとに一意な隔離 worktree を `git-worktree` の契約で用意して**セッションを移す**。置き場所は `git-worktree setup` の決定に従う（Issue ごとに worktree を渡り歩くため、**リポジトリ内**に置く必要がある）。
4. 各 Issue を入力順に `issue-start` の契約で実装し、現在の agent のローカルレビュー、必要な検証、browser-test、`kaizen extract --current --record-pending`、commit / push / PR 作成へ進める。
5. PR は `pr-finalize-loop` へ渡して収束させる。AI レビュー依頼は同スキルに一本化する。
6. head SHA を固定して auto-merge し、実際の PR `MERGED`、Issue `CLOSED`、対象 deployment の exact-SHA 成功、exact branch cleanup を確認して `DONE` にする。

各状態遷移の前に GitHub / git の実状態を再取得する。manifest の記憶だけで判断しない。

## 反復と既定動作

解決順は「明示 CLI option → setup 済み設定」。CLI override で設定ファイルを書き換えない。

- ローカルレビュー上限: setup 値。初期候補は 1
- PR 収束上限: setup 値。初期候補は 5
- CI 待機: setup 値。初期候補は false（CI とレビューを並行）
- BLOCKED 後の続行: setup 値。初期候補は true。`--stop-on-blocked` で当該 run だけ停止側へ上書き
- deployment 修正上限: `--max-deployment-fix-iterations` があれば当該 run だけ上書き

BLOCKED / FAILED が Issue の隔離 worktree 内に閉じる場合、既定方針に従い次 Issue へ進める。認証、権限、repo 不一致、共有設定破損など全体へ波及する失敗は option にかかわらず全体を停止する。

## 安全制約

- 課金、通知、データの作成・変更・削除、ログイン待ち、禁止操作解除を無人実行しない。必要なら preflight で BLOCKED にする。
- `--admin`、commit `--amend`、ローカルの `git rebase`、force push を使わない。deployment 修復では同じ feature branch に最新 base を merge する。
  ここでの禁止は git 履歴の書き換えを指し、`--merge-method rebase`（GitHub の rebase merge）とは別物である。
- auto-merge の有効化、成功済みの古い workflow run、同名 workflow の別 SHA を完了根拠にしない。
- merge / close / deployment の全条件が成立する前に branch を削除しない。glob ではなく検証済みの完全一致 ref だけを扱う。
- dirty / BLOCKED worktree は削除しない。絶対パスと残作業を最終報告へ残す。
- ユーザー確認が必要なレビュー・仕様判断を「無人実行」で迂回しない。結果を捏造せず BLOCKED とする。
- `kaizen extract --current --record-pending` が current transcript を同定できない agent では候補ゼロを検証できない。現状の Copilot はこの条件に該当するため、run の変更前に BLOCKED とし、検出能力を捏造して続行しない。

## 最終報告

入力順の表で Issue、最終状態、branch、worktree、PR、local review、tests、browser、Kaizen、merge、Issue close、deployment、cleanup、停止理由を示す。`DONE` は PR `MERGED`、Issue `CLOSED`、deployment 成功／根拠ある非適用、local / remote branch 削除の全てを実測した場合だけ使う。
