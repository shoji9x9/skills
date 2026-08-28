# プロジェクト設定

## 設定先と正本

`.config/skills/shoji9x9/skills.yml` の `skills.issue-batch` を issue-batch 固有設定の正本とする。

- **remote AI review の依頼先**は `skills.common.review_tool`
- browser environment は `skills.browser-test`
- branch / commit 規約は `skills.common.conventions_doc` とその参照先

`skills.common.review_tool` は `pr-finalize-loop` が PR 上で再レビューを依頼する相手であり、**ローカルレビューの実行主体ではない**。
ローカルレビューは設定値によらず常に現在利用中の agent 自身の機能で行う（`references/orchestration.md`「ローカルレビュー」）。
同様に、Kaizen の `--record-pending` が BLOCKED になるのは**実行中の agent が current transcript を同定できない**場合であって、
`review_tool: copilot` は reviewer の指定にすぎず BLOCKED 条件ではない。この 2 つを取り違えて正常系を停止させない。

これらを `skills.issue-batch` へ複製しない。設定ファイルが無い場合は必要な親と `skills.issue-batch` だけを作る。既存ファイルには欠けたキーだけを追記し、既存値・コメント・他スキルのキーを変更しない。既存値を変える場合は current / proposed と根拠を示して承認を得る。

## schema

```yaml
version: 1
skills:
  issue-batch:
    merge_mode: auto
    merge_method: squash
    merge_ready_timeout_minutes: 10
    max_local_review_iterations: 1
    max_pr_iterations: 5
    wait_ci_before_review: false
    continue_on_blocked: true
    deployment:
      workflows:
        - .github/workflows/release.yml
      registration_timeout_minutes: 5
      completion_timeout_minutes: 20
      max_fix_iterations: 3
```

これは形の例であり値の既定ではない。workflow と timeout を盲目コピーしない。`run` は必須キーが 1 つでも無ければ変更前に停止して setup を案内する。

`merge_ready_timeout_minutes` が必須になるのは**解決後の merge mode が `agent` のときだけ**で、`auto` では無くてよい。
`merge_mode` / `merge_ready_timeout_minutes` を持たない既存設定は本キー追加より前に setup したもので、
不足キーを推測で補わず「どのキーが無く、`issue-batch setup` で追記が要る」ことを名指しして停止する（`--merge-mode` の指定だけでは
`agent` に必要な待機上限は埋まらない）。

## setup 手順

setup は設定だけを扱い、Issue / branch / PR / merge / deployment を操作しない。

1. repository の許可済み merge method、branch protection / merge queue、規約文書、`skills.common.review_tool`、`skills.browser-test` を読む。
2. merge mode、merge method、local review 上限、PR 収束上限、CI 待機、BLOCKED 後の続行方針を根拠付きで確認する。初期候補は merge mode `auto`（現行踏襲）、local 1、PR 5、CI 待機 false、続行 true。merge method は repository で許可された方式だけを提示し、`squash` を推奨候補にして回答を保存する。
   merge mode は次の 2 択で、**どちらを選んでも `--admin` と required check の迂回は使わない**。

   | mode | 挙動 | 向く条件 |
   | --- | --- | --- |
   | `auto` | GitHub の auto-merge に委ねる（`gh pr merge --auto`）。要件充足を GitHub が判定して merge する | repository で auto-merge が許可されていて、merge を GitHub 側の判定に任せてよい |
   | `agent` | エージェントが PR の check / mergeable / 未解決 thread を実測し、条件成立を確認してから `--auto` なしで merge する | auto-merge が許可されていない、または merge 直前の状態を自分で確認してから merge したい |

   `auto` を選ぶ前に `gh api repos/{owner}/{repo} --jq .allow_auto_merge` で repository の許可状態を実測する
   （[REST: Get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository)）。`false` なら `auto` を提示せず、
   `agent` を選ぶか repository 設定の変更をユーザーへ案内する（setup は repository 設定を変更しない）。
   `agent` を選んだ場合は `merge_ready_timeout_minutes`（merge 条件が揃うまでの待機上限。分・正整数）も確認する。recent PR で最後の push から全 required check が完了するまでの実測時間を判断材料にする。履歴が無ければ推測値を確定せず質問する。`auto` を選んだ場合も将来の切り替えに備えてキーを持たせてよいが、値は同じ根拠付きで確認してから保存し、未確認の推測値は書かない。
3. `.github/workflows/*.{yml,yaml}` と最近の run を調べ、merge 後に確認する deployment / release workflow を**ファイルパス**で確定する。該当なしも空配列として明示保存する。複雑な `if` や外部 deployment で適用可否を決定できないものは、無人対象に含めず BLOCKED 条件として記録する。
4. registration timeout、completion timeout、修正上限を確認する。recent run の作成待ち・実行時間を判断材料にする。履歴が無ければ推測値を確定せず質問する。
5. proposed YAML と既存ファイルへの最小差分を示し、ユーザーの確定回答後に非破壊で保存する。
6. YAML を parse し、全キー、型、正整数、workflow path の現存、merge method の許可状態、merge mode の値（`auto` \| `agent`）を再検証する。
   あわせて `agent` を選んだ場合の `merge_ready_timeout_minutes`（正整数）の存在と、`auto` を選んだ場合の `allow_auto_merge: true` を確認して setup 完了とする。

## run option の解決

| run option | 設定キー | 規則 |
| --- | --- | --- |
| `--merge-mode` | `merge_mode` | `auto` \| `agent` だけ。CLI → 設定。未解決なら停止 |
| `--merge-method` | `merge_method` | CLI → 設定。未解決なら停止 |
| `--max-local-review-iterations` | `max_local_review_iterations` | 正整数だけ |
| `--max-pr-iterations` | `max_pr_iterations` | `pr-finalize-loop --max-iterations` へ転送 |
| `--wait-ci-before-review` / `--no-wait-ci-before-review` | `wait_ci_before_review` | 同時指定を拒否 |
| `--stop-on-blocked` | `continue_on_blocked` | 当該 run だけ false 相当 |
| `--max-deployment-fix-iterations` | `deployment.max_fix_iterations` | 正整数だけ |
| `--browser-test-env` | `skills.browser-test.environments` | 名前が一意に存在すること |

CLI override は設定ファイルを書き換えない。未知 option、重複して矛盾する option、0 / 負数 / 非数の上限は preflight で拒否する。
`merge_ready_timeout_minutes` に CLI override は無い。`--merge-mode agent` で当該 run だけ `agent` にする場合も、設定にこのキーが無ければ
待機上限を推測せず preflight で停止して setup を案内する。

## deployment workflow の相関

workflow 名ではなく file path を保存する。run 時は workflow file、merge commit SHA、event、base branch を照合する。GitHub CLI の `--commit` と JSON `headSha` / `event` を併用し、取得件数の暗黙上限に依存しない（[gh run list](https://cli.github.com/manual/gh_run_list)）。

`paths` / `branches` による非適用は workflow と PR changed files の両方から説明できる場合だけ認める。登録待ち 0 件は成功ではなく、適用外・未登録・API 失敗を弁別する。
