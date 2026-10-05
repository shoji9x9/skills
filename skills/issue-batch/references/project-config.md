# プロジェクト設定

## 設定の置き場所と原本

issue-batch だけが使う設定は、`.config/skills/shoji9x9/skills.yml` の `skills.issue-batch` で定義する。次のものは、別の場所で定義する。

- リモートの AI レビューの依頼先は、pr-finalize-loop の決め方に任せる
- ブラウザの環境は `skills.browser-test`
- branch と commit の規約は、`skills.common.conventions_doc` とその参照先

決まったレビューツールは、`pr-finalize-loop` が PR で再レビューを依頼する相手で、ローカルレビューをする主体ではない。
ローカルレビューは、設定の値に関わらず、常に今使っているエージェント自身の機能で行う（`references/orchestration.md`「ローカルレビュー」）。
同じように、Kaizen の `--record-pending` が BLOCKED になるのは、実行中のエージェントが現在の transcript を特定できない場合である。
`review_tool: copilot` はレビュアーの指定にすぎず、BLOCKED の条件ではない。この 2 つを取り違えて、正常な場合を停止させない。

これらを `skills.issue-batch` に書き写さない。設定ファイルが無い場合は、必要な親と `skills.issue-batch` だけを作る。
既存のファイルには、欠けたキーだけを追記し、既存の値・コメント・他のスキルのキーを変えない。既存の値を変える場合は、今の値と提案する値、その根拠を示して承認を得る。

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

これは形の例で、値のデフォルトではない。workflow と timeout を、確かめずにそのままコピーしない。
`run` は、必須のキーが 1 つでも無ければ、何かを変更する前に停止して、setup を案内する。

`merge_ready_timeout_minutes` が必須になるのは、決まった merge mode が `agent` のときだけで、`auto` では無くてよい。
`merge_mode` や `merge_ready_timeout_minutes` を持たない既存の設定は、これらのキーを足す前に setup したものである。
足りないキーを推測で補わず、「どのキーが無く、`issue-batch setup` で追記が要る」ことを名前を挙げて伝え、停止する。
`--merge-mode` を指定するだけでは、`agent` に要る待機の上限は決まらない。

## setup 手順

setup は設定だけを扱い、Issue・branch・PR・merge・deployment を操作しない。

1. リポジトリで許されている merge method、branch protection と merge queue、規約の文書、`skills.browser-test` を読む。リモートの AI レビュアーは、handoff 先の pr-finalize-loop が決める。
2. merge mode、merge method、local review の上限、PR の収束の上限、CI の待機、BLOCKED の後に続けるかの方針を、根拠を付けて確かめる。
   最初の候補は、merge mode が `auto`、local が 1、PR が 5、CI の待機が false、続けるかが true である。
   merge method はリポジトリで許された方法だけを示し、`squash` を推奨の候補にして、回答を保存する。
   merge mode は次の 2 つから選ぶ。**どちらを選んでも、`--admin` と、required check を避ける方法は使わない。**

   | mode | 挙動 | 向く条件 |
   | --- | --- | --- |
   | `auto` | GitHub の auto-merge に任せる（`gh pr merge --auto`）。条件を満たしたかを GitHub が判定して merge する | リポジトリで auto-merge が許されていて、merge を GitHub の判定に任せてよい |
   | `agent` | エージェントが PR の check・mergeable・解決していない thread を実際に確かめ、条件が揃ってから `--auto` なしで merge する | auto-merge が許されていない。または、merge の直前の状態を自分で確かめてから merge したい |

   `auto` を選ぶ前に、`gh api repos/{owner}/{repo} --jq .allow_auto_merge` で、リポジトリが許しているかを実際に確かめる
   （[REST: Get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository)）。`false` なら `auto` を示さない。
   `agent` を選ぶか、リポジトリの設定を変えるよう利用者に案内する（setup はリポジトリの設定を変えない）。
   `agent` を選んだ場合は、`merge_ready_timeout_minutes`（merge の条件が揃うまで待つ上限。分の単位の正の整数）も確かめる。
   最近の PR で、最後の push からすべての required check が完了するまでの実測の時間を、判断の材料にする。履歴が無ければ、推測した値で決めずに質問する。
   `auto` を選んだ場合も、将来切り替えるときのためにキーを持たせてよい。値は同じように根拠を付けて確かめてから保存し、確かめていない推測の値は書かない。
3. `.github/workflows/*.{yml,yaml}` と最近の run を調べ、merge の後に確かめる deployment や release の workflow を、ファイルのパスで決める。
   該当するものが無い場合も、空の配列として明示して保存する。
   複雑な `if` や外部の deployment で、対象かどうかを決められないものは、無人の対象に含めず、BLOCKED の条件として記録する。
4. 登録の待ち時間（registration timeout）、完了の待ち時間（completion timeout）、修正の上限を確かめる。最近の run の作成までの待ちと実行の時間を、判断の材料にする。履歴が無ければ、推測した値で決めずに質問する。
5. 提案する YAML と、既存のファイルへの最小の差分を示し、利用者が確定した後に、既存の内容を壊さずに保存する。
6. YAML を解析し、すべてのキー、型、正の整数、workflow のパスが在ること、merge method が許されていること、merge mode の値（`auto` \| `agent`）を確かめ直す。
   あわせて、`agent` を選んだ場合は `merge_ready_timeout_minutes`（正の整数）が在ること、`auto` を選んだ場合は `allow_auto_merge: true` であることを確かめて、setup を完了にする。

## run option の解決

| run option | 設定キー | 規則 |
| --- | --- | --- |
| `--merge-mode` | `merge_mode` | `auto` \| `agent` だけ。CLI、設定の順に決める。決まらなければ停止する |
| `--merge-method` | `merge_method` | CLI、設定の順に決める。決まらなければ停止する |
| `--max-local-review-iterations` | `max_local_review_iterations` | 正の整数だけ |
| `--max-pr-iterations` | `max_pr_iterations` | `pr-finalize-loop --max-iterations` に渡す |
| `--wait-ci-before-review` / `--no-wait-ci-before-review` | `wait_ci_before_review` | 両方の同時の指定を拒否する |
| `--stop-on-blocked` | `continue_on_blocked` | その run だけ false として扱う |
| `--max-deployment-fix-iterations` | `deployment.max_fix_iterations` | 正の整数だけ |
| `--browser-test-env` | `skills.browser-test.environments` | 名前が 1 つだけ在ること |

CLI で上書きしても、設定ファイルは書き換えない。知らない option、重ねて指定されて矛盾する option、0・負の数・数でない上限は、preflight で拒否する。
`merge_ready_timeout_minutes` には CLI での上書きが無い。`--merge-mode agent` でその run だけ `agent` にする場合も、設定にこのキーが無ければ、
待機の上限を推測せず、preflight で停止して setup を案内する。

## deployment workflow の相関

workflow の名前ではなく、ファイルのパスを保存する。run のときは、workflow のファイル・merge commit の SHA・event・base branch を照合する。
GitHub CLI の `--commit` と、JSON の `headSha` と `event` を合わせて使い、取得する件数の暗黙の上限に頼らない（[gh run list](https://cli.github.com/manual/gh_run_list)）。

`paths` や `branches` で対象外にするのは、workflow と PR の変更したファイルの両方から説明できる場合だけである。
登録を待って 0 件だったことは成功ではない。対象外・まだ登録されていない・API の失敗を区別する。
