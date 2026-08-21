# オーケストレーション契約

## 状態モデル

```text
PENDING -> PREFLIGHTED -> IMPLEMENTING -> LOCAL_REVIEWING -> VERIFYING
  -> PR_OPEN -> FINALIZING -> READY_TO_MERGE -> MERGE_QUEUED -> MERGED
  -> DEPLOYMENT_WAITING -> DEPLOYED -> BRANCH_CLEANUP -> DONE

DEPLOYMENT_WAITING -- failure --> DEPLOYMENT_FIXING
  -> LOCAL_REVIEWING -> VERIFYING -> PR_OPEN -> FINALIZING

任意の進行状態 -> BLOCKED | FAILED
未着手かつ前提不成立 -> SKIPPED
```

状態を進める直前に実状態を再取得し、満たした述語と証拠 URL / SHA を manifest に記録する。状態ファイルは判断のキャッシュではない。

## 全体 preflight

branch や設定を変更する前に次を全件分完了する。

1. Issue URL / 番号を正規化し、入力順を保持して重複を拒否する。
2. current repository と全 Issue の owner/repo が一致することを確認する。新規着手は Issue が OPEN の場合だけ許可する。
   再開時は一意な linked PR が MERGED で、Issue がその merge により CLOSED、残作業が deployment / cleanup に限られることを実状態から確認できれば CLOSED を受理する。それ以外の CLOSED Issue は SKIPPED または BLOCKED。本文と全コメントを取得し、最新の決定を優先する。
3. 規約文書、base branch、`skills.issue-batch`、`skills.common.review_tool`、agent 固有のローカルレビュー機能と Kaizen の current transcript を解決する。
   `--record-pending` が transcript を同定できない agent は候補ゼロを検証できないため変更前に BLOCKED。現状の Copilot はこの経路を使えない。
4. local / remote branch、open / closed PR、worktree を列挙する。再開対象が一意なら再利用し、複数候補なら全体を停止する。
5. Issue 本文・コメントの linked Issue / blocking relationship を確認する。先行 PR の merge が必要なら v1 の対象外として開始前に停止する。
6. browser-test が必要になり得る場合、環境を先に解決する。`auth: user`、未設定環境、ログイン待ち、禁止操作解除、課金・通知・CUD の承認が必要なら BLOCKED にする。
7. GitHub 認証、push / PR / auto-merge / workflow read に必要な権限を確認する。共有障害は全体停止にする。

## worktree と manifest

`mktemp -d` で run root を作り、その配下に Issue ごとの worktree と manifest を置く。run root のパスを最終報告まで保持する。

manifest が持てるのは次だけ。

- run ID、入力順、Issue URL / 番号
- 状態、branch、worktree、PR URL
- 検証名・結果・証拠 URL / SHA
- BLOCKED / FAILED の理由と残作業

token、cookie、認証 header、秘密の環境変数、設定から渡された動的 URL は記録しない。再実行では manifest を入口に候補を得ても、branch / PR / CI の現状を GitHub / git から再確認する。

## issue-start への handoff

専用 worktree で Issue ごとに `issue-start <Issue URL> --pr` 相当の契約を使う。ただし PR 作成前にローカルレビューと検証を挟むため、次の境界で段階化する。

1. repo 一致、本文＋コメント、規約、base branch、同番号 branch を `issue-start` と同じ順で確認する。
2. branch を再利用または `gh issue develop` で作り、Issue 作成時刻以後の base 変更と現行コードから独立に再導出した影響範囲を突き合わせる。
3. 全て解決済みなら `SKIPPED`。記載外へ大きく拡大する、または要件の選択が必要なら `BLOCKED`。
4. 実装し、リポジトリ規約が要求する最小範囲の lint / test を実行する。

`issue-start` の規約解決・影響範囲再検証・commit / PR 規約をここへ複製しない。参照先が読めなければ停止する。

## ローカルレビュー

実装コンテキストと分離したレビューを、**現在利用中の agent 自身**の機能で行う。別 agent へ自動 fallback しない。

- Codex: `codex review --uncommitted`。staged / unstaged / untracked が対象であることをローカル `--help` でも確認する（[OpenAI Developers](https://developers.openai.com/codex/cli/reference)）。
- Claude Code: current diff / branch をレビューする組み込み `/code-review high` を使う。非対話 `claude -p` adapter は現在の CLI で実走して成立した場合だけ使い、成立しなければ BLOCKED（[Claude Code commands](https://code.claude.com/docs/en/commands)）。
- GitHub Copilot CLI: `copilot -p '/review the changes on this branch compared to <base>. Focus on bugs and security issues.' -s --allow-tool='shell(git:*)'`（[GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically#code-review-a-branch)）。

指摘をコードと実測に照らして 1 件ずつ判断し、妥当なものだけ修正する。修正後は検証とレビューを再実行する。上限で収束しない、機能が利用不能、人間判断が必要なら BLOCKED。

## browser-test への handoff

差分から UI / API 経由の画面影響を逆引きする。

- 影響なし: 変更パスと逆引き結果を根拠に `not-applicable`
- 影響あり: preflight 済みの `{url, pre_commands, start, check_urls, forbidden_actions}` だけを渡し、`browser-test --scope branch` 相当で確認する。handoff 後に設定ファイルを再読させない

console、主要要素、Network / API、副作用のない操作を確認する。回帰は同じ Issue の実装へ戻す。副作用が必要な受入条件は BLOCKED。

## Kaizen、commit、PR

検証後に `kaizen extract --current --record-pending` を使う。候補は最大 1 件、`status: pending` の記録だけで、apply / archive / delete は行わない。
候補ゼロは current transcript と scanner の検出能力を確認した no-op とする。transcript を同定できない agent は no-op に倒さず BLOCKED。

学びが作られた場合は実装変更と分離した commit にする。関連ファイルだけを stage し、規約どおり commit / push する。PR 本文に `Closes #<Issue番号>`、変更概要、静的検査、browser-test の結果／非適用根拠、Kaizen 結果を含める。

## pr-finalize-loop への handoff

PR URL と解決済みの `max_pr_iterations` を `pr-finalize-loop <PR URL> --max-iterations <N>` に渡す。`wait_ci_before_review: true` の場合だけ `--wait-ci-before-review` を足す。

CI、全 reviewer の thread / review body、再レビュー依頼は `pr-finalize-loop` が正本。issue-batch 自身から remote AI review を依頼しない。収束しなければ BLOCKED / FAILED とし、隔離可能なら方針に従って次 Issue へ進む。

## merge、close、deployment

1. 収束後に PR の `headRefOid` を再取得して `READY_TO_MERGE` にする。
2. `gh pr merge <PR URL> --auto --<method> --match-head-commit <headRefOid>` を使う。merge queue 必須なら queue に入り、`--admin` は使わない（[gh pr merge](https://cli.github.com/manual/gh_pr_merge)）。
3. 上限付きで PR を再取得し、`MERGED` を確認する。auto-merge request の作成だけでは完了しない。
4. Issue の `state` と linked PR を再取得し、`CLOSED` を確認する。OPEN なら手動 close で隠さず BLOCKED。
5. PR から merge commit OID / mergedAt を取得する。workflow ごとに `gh run list --workflow <file> --commit <OID> --event <event> --json ...` を使い、`headSha == OID`、event、base branch を全て照合する（[gh run list](https://cli.github.com/manual/gh_run_list)）。
6. 適用対象 run が registration timeout 内に現れなければ BLOCKED。`gh run watch <id> --exit-status` を completion timeout で打ち切り、全対象が `completed/success` のときだけ `DEPLOYED`（[gh run watch](https://cli.github.com/manual/gh_run_watch)）。

workflow の `branches` / `paths` と変更ファイルから確実に外れる場合だけ `not-applicable`。設定で空配列が明示されていれば `not-configured`。同名の最新 run や別 SHA の成功を代用しない。

## deployment 修復

失敗 run の log からコード変更で直す根拠がある場合だけ修復する。

1. Issue を reopen し、failed run URL と理由をコメントする。
2. 元の feature branch / worktree を保持し、最新 base を**同じ branch に merge**する。rebase / force push / 別 branch 作成は禁止。
3. 最小修正 → local review → 検証 → commit / push → `Closes #<番号>` の follow-up PR → PR 収束 → merge → close → 新 merge SHA の deployment へ戻る。

外部障害は repository 契約で安全な rerun が許可される場合だけ rerun する。修正上限、認証・権限、人間判断、競合、timeout は BLOCKED。

## branch cleanup

全 deployment が success / not-configured / 根拠ある not-applicable、Issue が CLOSED、worktree が clean、同じ branch の全 PR が MERGED のときだけ進む。

manifest の worktree と branch が期待する Issue に完全一致し、branch が default / protected branch でなく `feature/<Issue番号>-` prefix を持つことを再検証する。
clean な worktree を先に解除し、解除済みを再確認してから完全一致した local branch、remote ref の順に削除する。glob と `gh pr merge --delete-branch` は使わない。解除・削除のいずれかが失敗したら BLOCKED。
