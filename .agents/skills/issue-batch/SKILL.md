---
argument-hint: <setup | run <Issue URL | 番号>...> [options]
description: 複数の GitHub Issue を入力順に、Issue ごとの隔離 worktree・独立 branch / PR で連続処理し、実装、ローカルレビュー、検証、必要なブラウザ回帰、Kaizen、PR 収束、merge（GitHub の auto-merge／エージェントが PR の状況を実測してから merge、のいずれかを選択）、Issue close、deployment、branch cleanup まで追跡するスキル。初回は `issue-batch setup` で無人実行ポリシーとマージ方式を確定する。「複数 Issue をまとめて処理」「Issue を順番に最後まで」「issue-batch」や `run` / `setup` を伴う依頼で必ず使う。
license: MIT
name: issue-batch
---
# Issue Batch

複数の Issue を 1 件ずつ順に処理する。各 Issue は、独立した branch と PR、隔離した worktree を持つ。そのため、1 件が失敗しても、他の作業ツリーに影響しない。

## 使い方

```text
issue-batch setup

issue-batch run <Issue URL | 番号>... \
  [--browser-test-env <環境名>] \
  [--max-local-review-iterations <N>] \
  [--max-pr-iterations <N>] \
  [--wait-ci-before-review | --no-wait-ci-before-review] \
  [--merge-mode <auto|agent>] \
  [--merge-method <squash|merge|rebase>] \
  [--max-deployment-fix-iterations <N>] \
  [--stop-on-blocked]
```

- 公開するサブコマンドは `setup` と `run` だけである。引数なしの呼び出し、サブコマンドを省いた Issue の指定、知らないサブコマンドでは、usage を示して、何も変更する前に停止する。
- `setup` は、引数と `run` 用の option を受け付けない。`run` には 1 件以上の Issue が必要で、option は `run` の後ろでだけ解釈する。
- URL と番号を混ぜて渡せるが、すべての Issue が現在のリポジトリと同じ owner/repo でなければならない。
- 1 つの Issue に 1 つの branch と 1 つの PR を対応させる。stacked PR と、複数の Issue を 1 つの PR にまとめることは対象外である。

## 前提

- ツール: `gh`、`git` と、現在のコーディングエージェントの非対話のレビュー機能
- 前提スキル: `git-worktree`、`issue-start`、`kaizen`、`pr-finalize-loop`。画面に影響がある場合は `browser-test`
- 設定: `.config/skills/shoji9x9/skills.yml` の `skills.issue-batch`。レビューツールの決定は pr-finalize-loop に任せる。`skills.browser-test` は参照するが、書き写さない
- シェル: bash。Windows では WSL や Git Bash などを使う

前提スキルを読めない場合や、設定が足りない場合は、取り決めを推測せずに停止する。`run` の途中で設定の質問を始めず、`issue-batch setup` を案内する。

## モード

### setup

`references/project-config.md` を読み、リポジトリごとの無人実行のポリシーを、対話で確定する。Issue・branch・PR・merge・deployment は操作しない。

### run

実行する前に、`references/project-config.md` と `references/orchestration.md` の両方を最後まで読む。次の順で進める。

1. 全体 preflight を、何かを変更する前に済ませる。確かめるのは次のものである。
   - 入力の正規化と重複
   - repo、Issue、PR の状態
   - Issue の担当者と、再開する PR の持ち主（自分以外なら BLOCKED）
   - 依存関係と、既存の branch・PR・worktree
   - 設定、認証と権限、レビュー機能
   - Kaizen が transcript を特定できるか、browser-test が安全か
2. `/tmp` に run manifest を作る。記録するのは、入力の順・Issue の URL・状態・branch・worktree・PR の URL・試験の結果・停止の理由だけである。秘密の値と、変わる環境の URL は書かない。
3. 呼び出し元の worktree を checkout せず、Issue ごとに一意な隔離した worktree を `git-worktree` の取り決めで用意して、セッションを移す。
   branch を作る前に、その Issue の担当者を確かめ、自分を割り当てて読み直す（`references/orchestration.md`「issue-start への handoff」の 1。割り当てができなければ、branch も worktree も作らない）。
   置き場所は `git-worktree setup` の決定に従う。Issue ごとに worktree を移るので、リポジトリの中に置く必要がある。
4. 各 Issue を入力の順に `issue-start` の取り決めで実装し、次に進める。
   現在のエージェントのローカルレビュー、必要な検証、browser-test、`kaizen extract --current --record-pending`、commit・push・PR の作成である。
5. PR は `pr-finalize-loop` に渡して収束させる。AI のレビューの依頼は、`pr-finalize-loop` にまとめる。
6. head の SHA を固定し、決めた merge mode で merge する。`auto` は GitHub の auto-merge に任せ、`agent` は PR の状況を実際に確かめてから merge する。
   実際に PR が `MERGED`、Issue が `CLOSED` で、対象の deployment がその SHA で成功し、名前が完全一致した branch を片付けたことを確かめてから、`DONE` にする。

状態を変える前に、毎回 GitHub と git の実際の状態を取得し直す。manifest の記憶だけで判断しない。

## 反復と既定動作

値は、CLI で明示した option、setup で決めた設定の順に決める。CLI で上書きしても、設定ファイルは書き換えない。

- ローカルレビューの上限: setup の値。最初の候補は 1
- PR の収束の上限: setup の値。最初の候補は 5
- CI の待機: setup の値。最初の候補は false（CI とレビューを並行して進める）
- BLOCKED の後に続けるか: setup の値。最初の候補は true。`--stop-on-blocked` で、その run だけ止める側に上書きする
- merge mode: setup の値。最初の候補は `auto`。`--merge-mode` で、その run だけ上書きする
- merge の準備ができるまで待つ上限: setup の値（`merge_ready_timeout_minutes`）。`agent` mode でだけ使い、CLI での上書きは無い。`agent` に決まったのに設定に無ければ、推測せずに停止する
- deployment の修正の上限: `--max-deployment-fix-iterations` があれば、その run だけ上書きする

BLOCKED や FAILED の影響が Issue の隔離した worktree の中だけで済む場合は、デフォルトの方針に従って次の Issue に進む。
認証、権限、repo の不一致、共有の設定の誤りなど、全体に影響する失敗では、option に関わらず全体を停止する。

## 安全制約

- 課金・通知・データの作成や変更や削除・ログインの待ち・禁止した操作の解除は、無人では実行しない。必要なら、preflight で BLOCKED にする。
- `--admin`、commit の `--amend`、ローカルの `git rebase`、force push を使わない。deployment を直すときは、同じ feature branch に最新の base を merge する。
  ここで禁じているのは git の履歴の書き換えで、`--merge-method rebase`（GitHub の rebase merge）とは別のものである。
- merge mode に関わらず、merge の要求を送ったこと（auto-merge の有効化や、merge queue への投入を含む）を完了の根拠にしない。
  成功した古い workflow run や、同じ名前の workflow の別の SHA も、根拠にしない。
- `agent` mode でも、required check が完了して成功したことと、mergeable であることを確かめてから merge する。
  完了していない check を待たずに merge しない。`--admin` や、branch protection を一時的に外すことで、無理に merge しない。
- merge・close・deployment の条件がすべて成り立つ前に、branch を削除しない。glob ではなく、確かめた完全一致の ref だけを扱う。
- dirty か BLOCKED の worktree は削除しない。絶対パスと残りの作業を、最終報告に残す。
- 利用者の確認が要るレビューや仕様の判断を、「無人実行」を理由に飛ばさない。結果を作り上げず、BLOCKED にする。
- `kaizen extract --current --record-pending` が現在の transcript を特定できないエージェントでは、候補が 0 件であることを確かめられない。
  transcript を提供しないエージェント（例: Copilot）はこれに当たるので、run が何かを変更する前に BLOCKED にする。検出できるふりをして続けない。

## 最終報告

入力の順に並べた表で、Issue・最終状態・branch・worktree・PR・local review・tests・browser・Kaizen・merge・Issue close・deployment・cleanup・停止の理由を示す。
`DONE` は、次のすべてを確かめた場合だけ使う。PR が `MERGED`、Issue が `CLOSED`、deployment が成功したか根拠があって対象外である、local と remote の branch を削除した。
