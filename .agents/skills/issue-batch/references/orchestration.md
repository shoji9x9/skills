# 複数の Issue を順に処理する取り決め

## 状態モデル

```text
PENDING -> PREFLIGHTED -> IMPLEMENTING -> LOCAL_REVIEWING -> VERIFYING
  -> PR_OPEN -> FINALIZING -> READY_TO_MERGE -> MERGE_QUEUED -> MERGED
  -> DEPLOYMENT_WAITING -> DEPLOYED -> BRANCH_CLEANUP -> DONE

DEPLOYMENT_WAITING -- failure --> DEPLOYMENT_FIXING
  -> LOCAL_REVIEWING -> VERIFYING -> PR_OPEN -> FINALIZING

READY_TO_MERGE -- base 遅れ / head 更新 --> FINALIZING

任意の進行状態 -> BLOCKED | FAILED
未着手かつ前提不成立 -> SKIPPED
```

`MERGE_QUEUED` は、merge の要求を送った後に待っている状態を表す。
`merge_mode: auto` では、auto-merge を予約したか merge queue に入れた状態を指す。
`merge_mode: agent` では、merge queue が必須の base で、queue に入った状態を指す。queue が要らない base の `agent` mode は、
`READY_TO_MERGE` から直接 `MERGED` に進む。どちらの mode でも、要求を送ったことを `MERGED` の根拠にしない。
`READY_TO_MERGE` から `FINALIZING` に戻ること（base が遅れた、待っている間に head が更新された）は前進ではない。
`max_pr_iterations` を上限として、同じ PR で戻った回数を数える。上限を超えたら、merge の要求を送らずに BLOCKED にする。

状態を進める直前に実際の状態を取得し直し、満たした条件と証拠の URL や SHA を manifest に記録する。状態のファイルは、判断のキャッシュではない。

## 全体 preflight

branch や設定を変更する前に、すべての Issue について次を済ませる。

1. Issue の URL と番号を正規化し、入力の順を保って、重複を拒否する。
2. 現在のリポジトリと、すべての Issue の owner/repo が一致することを確かめる。新しく着手するのは、Issue が OPEN の場合だけである。
   再開するときは、次のことを実際の状態から確かめられれば、CLOSED の Issue も受け付ける。
   一意に決まる linked PR が MERGED で、Issue がその merge で CLOSED になり、残りの作業が deployment と cleanup だけである。
   それ以外の CLOSED の Issue は、SKIPPED か BLOCKED にする。本文とすべてのコメントを取得し、最新の決定を優先する。
3. 規約の文書、base branch、`skills.issue-batch`（`merge_mode` と `merge_method` を含む）、エージェントごとのローカルレビューの機能、Kaizen が読む現在の transcript を決める。
   リモートの AI レビュアーはここでは固定せず、pr-finalize-loop の決め方に任せる。
   `--record-pending` が transcript を特定できないエージェントでは、候補が 0 件であることを確かめられないので、何かを変更する前に BLOCKED にする。
   transcript を提供しないエージェント（例: Copilot）は、この方法を使えない。
4. local と remote の branch、open と closed の PR、worktree を挙げる。再開する対象が 1 つに決まれば使い回し、候補が複数あれば全体を停止する。
   再開する PR の作成者でも担当者でもない（判定は `pr-finalize-loop` の `references/pr-ownership.md`）なら、その Issue を BLOCKED にする。
   他の人の PR に、無人で push や resolve をしない。参照先を読めなければ、判定を推測せずに全体を停止する。
   判定できない場合（自分の login や、PR の作成者と担当者を取得できない。ユーザーでないトークンを含む）も、利用者に確認できない。
   確認の代わりに、その Issue を BLOCKED にして理由を残す。
5. 各 Issue の担当者を読む（`gh issue view <番号> --json assignees`。手順は `issue-start` の `references/assignee.md` で定義する）。
   自分以外が付いている Issue は、何かを変更する前に BLOCKED にして、担当者の login を残す。ここでは読むだけで、割り当てない（割り当ては着手の直前に行う）。
   担当者を判定できない Issue（自分の login や担当者を取得できない）も、同じく BLOCKED にして理由を残す。
6. Issue の本文とコメントにある linked Issue と blocking relationship を確かめる。先に別の PR の merge が要るなら、対象外として始める前に停止する。
7. browser-test が要る可能性がある場合は、先に環境を決める。
   `auth: user`、設定されていない環境、ログインの待ち、禁止した操作の解除、課金・通知・データの作成や変更や削除の承認が要るなら、BLOCKED にする。
8. GitHub の認証と、push・PR・merge・workflow の読み取りに要る権限を確かめる。決まった `merge_mode` が `auto` の場合だけ、
   auto-merge の権限とリポジトリの許可（`gh api repos/{owner}/{repo} --jq .allow_auto_merge`。
   [REST: Get a repository](https://docs.github.com/en/rest/repos/repos#get-a-repository)）も確かめる。
   `false` なら、設定を無人で書き換えずに全体を停止し、`issue-batch setup` を案内する。
   `--merge-mode agent` でやり直すよう案内できるのは、設定に `merge_ready_timeout_minutes` が既にある場合だけである。
   無ければ `agent` に要る待機の上限が決まらず、やり直しても preflight で止まる（設定を読んで、どちらかを案内する）。
   `agent` でも、base で merge queue が必須なら、`gh pr merge` は queue への投入（条件を満たしていなければ auto-merge の有効化）になる。
   その base では、同じ確認をする。共有の障害では全体を停止する。

## worktree と manifest

`mktemp -d` で run root を作り、その下に manifest を置く。run root のパスは、最終報告まで保持する。

worktree の仕組み（置き場所、セッションの移動、`.gitignore` 対象ファイルの運搬、チェックからの除外、clean を確かめてからの後片付け）は、
`git-worktree` スキルに任せ、ここには書き写さない。branch を先に作ってから、`git-worktree enter <branch>` と同じ取り決めで入る。
**`git worktree add` を実行しただけで、隔離できたとしない。** セッションを移さないと、subagent・フォークして動くスキル・
バックグラウンドの Bash が、呼び出し元の作業ツリーで動く。参照先を読めなければ停止する。

**worktree は run root（`mktemp -d`）の下に置かない。** リポジトリの外の worktree には、
起動したディレクトリからの 1 回しか入れない。そのため、Issue ごとに worktree を移るこのスキルの進め方が、2 件目で成り立たない。
移るたびに利用者の承認も要り、無人の実行では止まる（根拠は `git-worktree` の `references/isolation.md`）。
置き場所には、`git-worktree setup` が決めたリポジトリの中のディレクトリを使う。
その除外が、リポジトリ全体を読むすべてのジョブに入っていることを、preflight で確かめる。設定されていないか、除外されていなければ BLOCKED にする。

manifest に書いてよいのは、次のものだけである。

- run ID、入力順、Issue URL / 番号
- 状態、branch、worktree、PR URL
- 検証名・結果・証拠 URL / SHA
- BLOCKED / FAILED の理由と残作業

token・cookie・認証の header・秘密の環境変数・設定から渡された変わる URL は、記録しない。
やり直すときは、manifest を起点に候補を得ても、branch・PR・CI の今の状態を、GitHub と git から確かめ直す。

## issue-start への handoff

Issue ごとの専用の worktree で、`issue-start <Issue URL> --pr` と同じ取り決めを使う。
ただし、PR を作る前にローカルレビューと検証を挟むので、次の区切りで段階に分ける。

1. repo の一致、本文とコメント、規約、base branch、担当者、同じ番号の branch を、`issue-start` と同じ順で確かめる。
   担当者は着手の直前に、`issue-start` の `references/assignee.md` の 3 段（確かめる・空なら自分を割り当てる・読み直す）で扱う。
   利用者への確認に当たる結果（自分以外が付いている・割り当てができない・読み直して自分以外も付いていた）は、確認の代わりに BLOCKED にして担当者の login を残す。
   読み直して自分以外も付いていた場合も、自分を無人で外さない。外すかの判断を、残りの作業として最終報告に載せる。
2. branch を使い回すか、`gh issue develop` で作る。Issue を作った時刻より後の base の変更と、今のコードから独立に導き直した影響範囲を突き合わせる。
3. すべて解決済みなら `SKIPPED` にする。書かれた範囲の外に大きく広がる場合や、要件の選択が要る場合は `BLOCKED` にする。
4. 実装し、リポジトリの規約が求める最小の範囲の lint と test を実行する。

`issue-start` の規約の決め方・影響範囲の確かめ直し・commit と PR の規約を、ここには書き写さない。参照先を読めなければ停止する。

## ローカルレビュー

実装したときの文脈から切り離したレビューを、今使っているエージェント自身の機能で行う。別のエージェントに自動で切り替えない。

- Codex: `codex review --uncommitted`。staged・unstaged・untracked が対象であることを、ローカルの `--help` でも確かめる（[OpenAI Developers](https://developers.openai.com/codex/cli/reference)）。
- Claude Code: 現在の差分か branch をレビューする、組み込みの `/code-review high` を使う。
  非対話の `claude -p` で呼ぶ方法は、今の CLI で実際に実行して動いた場合だけ使う。動かなければ BLOCKED にする（[Claude Code commands](https://code.claude.com/docs/en/commands)）。
- GitHub Copilot CLI: 次のコマンドを使う（[GitHub Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically#code-review-a-branch)）。

  ```bash
  copilot -p '/review the changes on this branch compared to <base>. Focus on bugs and security issues.' -s --allow-tool='shell(git:*)'
  ```

指摘をコードと実測に照らして 1 件ずつ判断し、妥当なものだけ直す。直した後は、検証とレビューをやり直す。
上限までに収束しない場合、機能を使えない場合、人の判断が要る場合は BLOCKED にする。

## browser-test への handoff

差分から、UI や API を通して影響する画面を逆にたどる。

- 影響なし: 変更したパスと、逆にたどった結果を根拠に、`not-applicable` にする
- 影響あり: preflight で確かめた `{url, pre_commands, start, check_urls, forbidden_actions}` だけを渡し、`browser-test --scope branch` と同じ方法で確かめる。handoff の後に設定ファイルを読み直させない

console、主要な要素、Network と API、副作用の無い操作を確かめる。回帰は、同じ Issue の実装に戻す。副作用が要る受け入れ条件は BLOCKED にする。

## Kaizen、commit、PR

検証の後に、`kaizen extract --current --record-pending` を使う。候補は最大 1 件で、`status: pending` として記録するだけである。apply・archive・delete は行わない。
候補が 0 件のときは、現在の transcript とスキャナの検出能力を確かめたうえで、何もしないで進む。
transcript を特定できないエージェントでは、何もしないで進むことにせず、BLOCKED にする。

学びが作られた場合は、実装の変更とは別の commit にする。関連するファイルだけを stage し、規約どおりに commit する。
**すべての commit の後、push の直前に**、`issue-start` の受け入れ条件の突き合わせ（基本フローの step 10。手順は `issue-start` の `references/acceptance.md` で定義する）を通す。
ローカルレビューは commit していない差分を対象にし、レビューの修正や Kaizen の commit で HEAD が進む。
そのため、それより前に作った表は、`commit-missing` か `stale-commit` で失敗する。
次のどれかに当たれば `BLOCKED` にする。

- exit 0 にならない
- 満たせない条件に、利用者の判断が要る
- `closable: false`（Issue を閉じられない）
- 受け入れ条件を変えたので、似た Issue を見直すかを確かめる必要がある（同じ `acceptance.md` の手順 6。すべての行が `met` でも、コメントでの条件の改訂や本文の書き換えで起きる）

見直すかどうかは、候補の一覧を添えて、BLOCKED の理由に残す。exit 0 だけを見て push すると、確認がどこにも残らずに消える。
通ったら push する。PR の本文には、`Closes #<Issue番号>`、変更の概要、静的な検査、受け入れ条件の突き合わせの表、browser-test の結果か対象外の根拠、Kaizen の結果を含める。

## pr-finalize-loop への handoff

PR の URL と、決まった `max_pr_iterations` を、`pr-finalize-loop <PR URL> --max-iterations <N>` に渡す。`wait_ci_before_review: true` の場合だけ、`--wait-ci-before-review` を足す。
レビューツールは pr-finalize-loop が決めるので、issue-batch は値を先に固定したり渡したりしない。pr-finalize-loop の参照先を読めなければ、handoff の前に停止する。

CI、すべてのレビュアーの thread と review の本文、再レビューの依頼は、`pr-finalize-loop` が扱う。issue-batch 自身からは、リモートの AI レビューを依頼しない。
収束しなければ BLOCKED か FAILED にし、影響をその Issue の中に留められるなら、方針に従って次の Issue に進む。

## merge、close、deployment

merge の実行方法だけが、`merge_mode` で分かれる。head の SHA の固定、`--admin` を使わないこと、`MERGED` の確認、その後の close と deployment は、どちらの mode でも同じである。

1. 収束した後に PR の `headRefOid` を取得し直して、`READY_TO_MERGE` にする。この後のコマンドにはすべてこの SHA を `--match-head-commit` で渡し、収束した後に入った push と取り違えない。
2. 決まった `merge_mode` で merge する。
   - `auto`: `gh pr merge <PR URL> --auto --<method> --match-head-commit <headRefOid>`。条件を満たしたかの判定は GitHub に任せる（[gh pr merge](https://cli.github.com/manual/gh_pr_merge)）。
   - `agent`: 下の「agent mode の merge 前判定」を通してから、`gh pr merge <PR URL> --<method> --match-head-commit <headRefOid>` を実行する（`--auto` を付けない）。

   どちらでも `--admin` は使わない。**merge queue が必須の base では、`--auto` を付けなくても gh は auto-merge を有効にするか queue に入れる**。
   required check を通っていなければ auto-merge に、通っていれば queue への投入になる（`gh pr merge --help` に書かれている）。
   `agent` mode でも、すぐに merge されると決めつけず、`MERGE_QUEUED` を通ることがあるものとして扱う。
3. 上限を決めて PR を取得し直し、`MERGED` を確かめる。auto-merge の要求の作成、queue への投入、merge のコマンドの成功は、どれも完了の根拠にしない。
4. Issue の `state` と linked PR を取得し直し、`CLOSED` を確かめる。OPEN なら、手で close して隠さず、BLOCKED にする。
5. PR から merge commit の OID と mergedAt を取得する。workflow ごとに
   `gh run list --workflow <file> --commit <OID> --event <event> --limit <N> --json ...` を使い、`headSha == OID`、event、base branch をすべて照合する（[gh run list](https://cli.github.com/manual/gh_run_list)）。
   `--limit` は明示する。デフォルトの 20 件で警告なしに打ち切られ、やり直しで同じ commit の run が増えると見逃す。
   返った件数が `--limit` に達したら、打ち切られたことを疑い、範囲を広げて取得し直す。
6. 対象の run が登録の待ち時間（registration timeout）の内に現れなければ BLOCKED にする。
   `gh run watch <id> --exit-status` を完了の待ち時間（completion timeout）で打ち切り、すべての対象が `completed/success` のときだけ `DEPLOYED` にする（[gh run watch](https://cli.github.com/manual/gh_run_watch)）。

workflow の `branches` と `paths` から、変更したファイルが確実に外れる場合だけ `not-applicable` にする。設定で空の配列が明示されていれば `not-configured` にする。
同じ名前の最新の run や、別の SHA での成功を、代わりに使わない。

## agent mode の merge 前判定

`merge_mode: agent` のときだけ実行する。判定はすべて PR の実際の状態から取り、`pr-finalize-loop` の報告や manifest の記憶で代えない。

```bash
gh pr view "$PR_URL" --json state,mergeable,mergeStateStatus,reviewDecision,headRefOid

# --required は非 0 終了し得るので、終了コードと stderr を捕まえてから弁別する。
# `cmd && rc=0 || rc=$?` は set -e 下でも止まらない（実測）。
req_err=$(mktemp); all_err=$(mktemp)
trap 'rm -f "$req_err" "$all_err"' EXIT

fields=name,bucket,state,link
req_json=$(gh pr checks "$PR_URL" --required --json "$fields" 2>"$req_err") && req_rc=0 || req_rc=$?
# 突き合わせ用。こちらも rc を保持する（両方失敗なら「必須が無い」ではなく「取得に失敗した」）
all_json=$(gh pr checks "$PR_URL" --json "$fields" 2>"$all_err") && all_rc=0 || all_rc=$?
```

`gh pr checks --json` の `bucket` は、`state` を `pass`・`fail`・`pending`・`skipping`・`cancel` に正規化した値で、
この 5 つが取りうる値のすべてである（`gh pr checks --help`）。生の `state` を自分で分類せず、`bucket` を使う。
`req_rc` は次のように区別する。**0 以外を「失敗」として扱わない。**

| `req_rc` | 観測 | 意味 |
| --- | --- | --- |
| `0` | `req_json` に JSON | 必須チェックを取得できた |
| `8` | — | checks pending（`gh pr checks --help` の Additional exit codes） |
| それ以外（実測は `1`） | `req_json` は**空**、`req_err` に `no (required )?checks reported on the '<branch>' branch` | 必須チェックが 0 件。内訳は下表で `all_rc` と `all_err` から決める |

`req_rc != 0` のときの内訳は、次の 3 通りである。**`all_rc != 0` を、すべて「取得の失敗」として扱わない。** CI が 1 件も無いリポジトリでも、`all_rc` は 0 以外になる（実測）。

| `all_rc` | `all_err` | 状態 |
| --- | --- | --- |
| `0` | — | 必須チェックは 0 件だが check はある。`all_json` の `bucket` へ規則を当てる |
| 非 0 | `no checks reported on the '<branch>' branch` | **check が 1 件も無い**（CI 未設定）。pass 扱いにせず、check を根拠にしていない旨を manifest に残す |
| 非 0 | それ以外（認証・ネットワーク等） | 取得に失敗した。0 件と読み替えず BLOCKED |

`req_json` と `all_json` が空のまま、JSON として解析しない（`rc != 0` のとき、stdout は空になる。実測）。
**必須チェックが 0 件のときは、required が pass したことを merge の根拠にできない。**
branch protection の無いリポジトリは常にこの状態で、「required がすべて pass」は対象が空なので当然に成り立ってしまう。
この場合は、`--required` なしのすべての check の `bucket` に下の規則を当て、`UNSTABLE` の免除も当てない。
すべての check も 0 件なら、「CI が設定されていないので、check を根拠にしていない」と manifest に明記し、check が pass したことにしない。

判定と分岐は次のとおりである。`mergeable` は GraphQL の `MergeableState`、`mergeStateStatus` は `MergeStateStatus` で、どちらも下の表が取りうる値のすべてである。
`gh api graphql` の introspection で確かめた（[GraphQL enums](https://docs.github.com/en/graphql/reference/enums)）。

| 観測 | 扱い |
| --- | --- |
| `state` が `OPEN` でない | 実際の状態に従う。`MERGED` なら merge 済みとして次に進み、`CLOSED` なら BLOCKED にする |
| required check に `fail` か `cancel` がある | `pr-finalize-loop` の収束が成り立っていない。merge せずに BLOCKED にする |
| required check に `pending` がある | `merge_ready_timeout_minutes` を上限として、取得し直しを繰り返す。上限を超えたら BLOCKED にする |
| `mergeable: UNKNOWN` か `mergeStateStatus: UNKNOWN` | GitHub が計算している。同じ待機の上限の内で取得し直す |
| `mergeable: CONFLICTING`（`mergeStateStatus: DIRTY`） | 競合の解消を無人では判断せず、BLOCKED にする |
| `mergeStateStatus: BEHIND` | base が遅れている。rebase・force push・別の branch を使わず、同じ feature branch に最新の base を merge して、`FINALIZING` に戻す（「deployment 修復」の 2 と同じ扱い）。戻した回数は `max_pr_iterations` を上限に数え、超えたら BLOCKED にする |
| `mergeStateStatus: BLOCKED` | 保護の条件を満たしていない（review が足りない、解決していない thread があるなど）。`reviewDecision` を足りないものの根拠として manifest に残し、条件を無人で外さずに BLOCKED にする |
| `mergeStateStatus: UNSTABLE` | 必須でない check が失敗している。必須チェックが 1 件以上あり、そのすべてが `pass` なら merge してよい。どの check が失敗したかを、判断の根拠として manifest に残す |
| `mergeStateStatus: CLEAN` か `HAS_HOOKS`、`mergeable: MERGEABLE` | merge に進む |

待機の上限は分の単位で持ち、超えたら merge のコマンドを送らずに BLOCKED にする。
待っている間に `headRefOid` が変わったら、その時点の PR は収束していないので、merge せずに `FINALIZING` に戻す（戻した回数は、上の `max_pr_iterations` の上限に含める）。

## deployment 修復

失敗した run の log から、コードの変更で直せる根拠がある場合だけ直す。

1. Issue を reopen し、失敗した run の URL と理由をコメントする。
2. 元の feature branch と worktree を残し、最新の base を同じ branch に merge する。rebase・force push・別の branch の作成は禁止する。
3. 最小の修正、local review、検証、commit と push、`Closes #<番号>` の follow-up PR、PR の収束、merge、close の順に進め、新しい merge の SHA の deployment に戻る。

外部の障害は、リポジトリの取り決めで安全な rerun が許されている場合だけ rerun する。修正の上限、認証と権限、人の判断、競合、timeout は BLOCKED にする。

## branch cleanup

次のすべてを満たすときだけ進む。
すべての deployment が success・not-configured・根拠のある not-applicable のどれかで、Issue が CLOSED、worktree が clean、同じ branch のすべての PR が MERGED である。

manifest の worktree と branch が期待する Issue と完全一致し、branch がデフォルトでも保護されてもおらず、`feature/<Issue番号>-` で始まることを確かめ直す。
解除と削除は、`git-worktree cleanup` と同じ取り決めに従う。clean を確かめ、解除し、`git worktree list` をもう一度実行して確かめ、完全一致した local branch、remote ref の順に削除する。
glob と `gh pr merge --delete-branch` は使わない。解除か削除のどちらかが失敗したら BLOCKED にする。
