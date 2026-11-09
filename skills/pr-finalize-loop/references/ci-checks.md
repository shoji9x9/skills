# CI の状態の確認と待ち方

`pr-finalize-loop` の基本フローの手順 1（CI の完了を待つ）と手順 3（CI の失敗を直す）で読む。
待つときに上限を決めることは、`SKILL.md` の「ポーリングと待機」で定める。

## CI 状態の確認

```bash
gh pr checks <番号> --repo <owner>/<repo> --watch --fail-fast
```

- すべてのチェックが終わるまで待ち、すべて成功なら終了コード 0、どれかが失敗したら 0 以外で終わる。
- push の直後は、チェックがまだ登録されておらず、すぐに `no checks` が返ることがある。そのときは「`no checks` を確かめ直す」に従う。
- push の直後に `--watch` がすぐ終わっても（exit 0）、CI が完了したとは信じない。
  force push や push し直した直後は、必須チェックがまだ登録されておらず、先に登録される飛ばすだけのチェック（CodeQL の skipping など）だけが見える瞬間がある。
  `--watch` はその集合が終わった時点で exit 0 で終わる（必須チェックは pending のまま）。すぐに `no checks` が返るのと同じ種類の誤判定である。
  判定は、必須チェック（`check`・`signatures` など、ブランチの保護で必須に指定したもの）だけを見て行う。
  `--json` のフィールド（`bucket, completedAt, description, event, link, name, startedAt, state, workflow`）には「必須か」を表すものが無いので、`--required` フラグで絞る（<https://cli.github.com/manual/gh_pr_checks>）。

  ```bash
  gh pr checks <番号> --repo <owner>/<repo> --required --json name,state,bucket
  ```

  結果を「failed」「pending」「未登録」に分けて扱い、pending にまとめない。

  - `bucket` が `fail` か `cancel` の行がある: CI の失敗が確定しているので、待たずに「CI 失敗ログの取得」に進む。
    `mergeStateStatus` が変わるのを待つことで代わりにしない。必須チェックが失敗した PR は `BLOCKED` のままで `CLEAN` や `UNSTABLE` にならないので、CI が失敗していると、反復のたびにポーリングの上限まで時間を使ってしまう。
  - `pending` が残っている: 「CI の完了を待つ」の上限の中で確かめ直す。
  - すべてが pending でなく、`fail` も `cancel` も無い: CI が完了して成功したとみなす。補助として、`gh pr view <番号> --repo <owner>/<repo> --json mergeStateStatus` が `CLEAN` か `UNSTABLE` であることも確かめられる。
  - 必須チェックが 0 件: 必須チェックがまだ登録されていないか、リポジトリが必須チェックを設定していないかのどちらかである。行が無いことを、pending が無いことと同じに扱わない（`--required` でも同じ）。
    このとき `gh` は空の配列を返さず、`no required checks reported on the '<branch>' branch` を stderr に出して 0 以外で終わる。force push の直後に登録されていない状態が、まさにこれである。
    コマンドの誤りとして扱わず、この場合は「`no checks` を確かめ直す」に従う。

## CI 失敗ログの取得（修正の手がかり）

失敗したチェックの名前と、対応する GitHub Actions の run の失敗のログを取得して、原因を絞る。

```bash
gh pr checks <番号> --repo <owner>/<repo> --json name,state,bucket,link \
  --jq '.[] | select(.bucket=="fail")'
gh run view <run-id> --repo <owner>/<repo> --log-failed   # 失敗ジョブのログだけ表示
```

- `bucket` は、`state` を `pass`・`fail`・`pending`・`skipping`・`cancel` に分類した値である。
  `fail` には `FAILURE` と `ERROR` だけでなく、`TIMED_OUT`・`ACTION_REQUIRED`・`STARTUP_FAILURE` も入るので、`state` を直接並べるより失敗を取りこぼさない。
  キャンセルも拾うなら、`or .bucket=="cancel"` を足す。
- `link` から run-id を取り、`--log-failed` で失敗したステップのログに絞る。原因はコードの事実と照らして判断し、推測で広い範囲を書き換えない。
- 直す前に、下の「PR と関係が無く、ベースブランチで直っている失敗」に当たるかを確かめる。

## PR と関係が無く、ベースブランチで直っている失敗

CI の失敗が PR の変更と関係が無く、最新のベースブランチでは直っているなら、PR の中で同じ修正をしない。
PR に関係の無い変更が入り、ベースブランチの修正と競合することもあるからである。代わりに、最新のベースブランチを取り込み、CI をもう一度確かめる。

取り込むのは、次の 2 つをどちらも確かめた事実で示せたときだけである。推測（失敗したファイルが PR の差分に無い、など）では判定しない。
どちらかを確かめられなければ、取り込まずに、`SKILL.md` の手順 3 のとおりログから原因を特定して直す。

| 判定 | 根拠にする事実 |
| --- | --- |
| PR の変更と関係が無い | 失敗した run が検証したベースブランチの commit で、同じチェックが同じ失敗（同じステップ・同じテストやエラー）で終わる |
| 最新のベースブランチで直っている | ベースブランチの先端で、同じチェックが成功する |

失敗した run が検証したベースは、推定せずに、その run のログから取得する。
`pull_request` の run では、`actions/checkout` が PR の head とベースを合わせた merge commit を取り出し、ログにその commit の message（`Merge <head の SHA> into <ベースの SHA>`）を出す。
PR の分岐点や時刻から推定すると、分岐点の後にベースへ入った commit で失敗した場合や、commit の時刻と取り込んだ時刻がずれる場合に、別の commit と比べることになる。

それぞれの commit で同じチェックがどう終わるかは、まず CI の記録で確かめる。

```bash
base=$(gh pr view <番号> --repo <owner>/<repo> --json baseRefName --jq .baseRefName)
# refspec を明示する。single-branch clone などで remote.origin.fetch に $base が無いと、origin/$base が更新されない
git fetch origin "+refs/heads/$base:refs/remotes/origin/$base"
merge=$(gh run view <run-id> --repo <owner>/<repo> --log | grep -m1 -oE 'Merge [0-9a-f]{40} into [0-9a-f]{40}')
ran=${merge##* into }                                  # 失敗した run が検証したベース
tip=$(git rev-parse "origin/$base")                    # ベースブランチの先端
gh api --paginate -X GET "repos/<owner>/<repo>/commits/<SHA>/check-runs" \
  -f check_name='<チェックの名前>' -f per_page=100 \
  --jq '.check_runs[] | {status, conclusion, html_url}'
```

- `<run-id>` は、「CI 失敗ログの取得」で取得した失敗した run の ID である。
- `$merge` が空のとき（`push` で起動した run、GitHub Actions でないチェック、ログの保存期間が過ぎた run）は、確かめられないものとして扱う。
  `$merge` の head の SHA が、その run の `headSha`（`gh run view <run-id> --json headSha`）と違うときも同じである。
- `<SHA>` には `$ran` と `$tip` を 1 つずつ渡す。チェックの名前は、「CI 失敗ログの取得」で取得した `name` をそのまま使う。
- チェックの名前は `-f` で渡す。URL のクエリに直接書くと、空白を含む名前（`Unit tests` など）がエンコードされず、`gh api` が応答を返さない（実測）。
- `$tip` と `$ran` が同じなら、失敗した run はベースブランチの先端と合わせて検証しているので、取り込んでもその失敗は直らない。この節に当たらない。
- 0 件は、その commit で CI が実行されていないことを示すだけで、成功も失敗も示さない（push で CI を実行しないリポジトリでは、ベースブランチの先端に記録が無い）。
- `$ran` の記録が失敗でも、ログの失敗した箇所が PR の失敗と違うなら、同じ失敗として扱わない。`gh run view <run-id> --log-failed` で読み比べる。
- 形は <https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference> で確かめた。

CI の記録が無ければ、手元で再現して確かめてよい。その commit を別の作業ツリー（`git worktree add --detach <一時ディレクトリ> <SHA>`）に取り出し、ログの失敗したステップのコマンドを実行する。
手元で実行できない（ランタイムや資格情報が無い、CI の環境でしか起きない）ときは、確かめられないものとして扱う。確かめた後は、作った作業ツリーを `git worktree remove` で片付ける。

取り込みの方法は、`issue-start` の基本フロー step 11 と同じく、リポジトリの規約に従って決める。
このスキルは force push をしないので、使える方法は merge だけである（`git merge --no-edit "origin/$base"`）。
規約が merge を許さない（rebase だけを許すなど）とき、または merge が競合したとき（`git merge --abort` で戻す）は、自分で解消せず「行き詰まり」として止まり、取り込みが要ることとその理由を報告する。

取り込んだら、push する前に、判定の根拠を PR のトップレベルのコメントに書く。
書くのは、失敗したチェックの名前と失敗の要点、2 つの判定の根拠（commit の SHA と run の URL、または再現したコマンドと結果）、取り込んだ範囲（取り込む前の `git merge-base HEAD "origin/$base"` から `$tip` まで）である。
本文の先頭に目印 `<!-- pr-finalize-loop:base-merge -->` を入れ、コンテキストを圧縮した後もこのコマンドで読み直せるようにする。

```bash
gh api --paginate repos/<owner>/<repo>/issues/<番号>/comments \
  --jq '.[] | select(.body | startswith("<!-- pr-finalize-loop:base-merge -->")) | {id, created_at, body}'
```

push した後の CI で同じ失敗が残ったら、判定が誤っていたので、その失敗のためにもう一度取り込まない。手順 3 のとおりログから原因を特定して直す。

## CI の完了を待つ

`gh pr checks --watch` に任せる。gh が中でポーリングし、完了するまで待つ。間隔は `--interval <秒>` で決める。自分で短い間隔のループを書いて呼び続けない。

- `--watch` は、ジョブが `queued` のまま runner が割り当てられなくても返らない。
  そのため、`--watch --fail-fast` はバックグラウンドで実行し、待っている間に、runner が割り当てられないジョブと、承認などを待つジョブを一定の間隔で別に確かめる。`--watch` は打ち切らない。
  バックグラウンドの実行は、終わったことと終了コードを受け取れ、途中で止められる方法にする（Claude Code の `run_in_background` など。stdin は `</dev/null` にする）。
  エージェントにそのような実行の機能が無ければ、`--watch` を使わない。`--watch` を付けない `gh pr checks` と下の確認を、`--interval` と同じ間隔を空けて交互に実行する。
  `--watch` が 0 以外で返ったら、起動し直さずに「CI 状態の確認」で失敗したチェックがあるかを確かめる。あれば `SKILL.md` の手順 3 で直し、無ければ（`no checks` や API のエラーで返ったとき）「`no checks` を確かめ直す」と同じに扱う。
  0 で返ったら、別に確かめるのをやめ、「CI 状態の確認」の手順で CI を判定する。push の直後の exit 0 は、必須チェックが登録される前のことがあるからである。
  判定でまだ終わっていないチェックが見つかったら、`--interval` の間隔を空けてから `--watch` をもう一度バックグラウンドで起動し、runner が割り当てられないジョブと、承認などを待つジョブの確認も続ける。メモに残した初めて見つけた時刻は、そのまま使う。
  すぐに 0 で返ることが 3 回続いたら、起動し直すのをやめ、「`no checks` を確かめ直す」と同じに扱う。
- 確かめるのは、HEAD のすべての workflow run の、`status` が `queued` で `runner_name` が null のジョブである。
  承認などを待つジョブ（`waiting`・`requested`・`pending`。後述）も、同じ取得で見つける。
  run の `status` は 1 つのジョブが始まると `in_progress` になるので、run では絞らない。

  ```bash
  gh api --paginate "repos/<owner>/<repo>/actions/runs?head_sha=<HEAD の SHA>&per_page=100" --jq '.workflow_runs[].id'
  gh api --paginate "repos/<owner>/<repo>/actions/runs/<run-id>/jobs?per_page=100" \
    --jq '.jobs[] | select((.status == "queued" and .runner_name == null) or .status == "waiting" or .status == "requested" or .status == "pending") | {id, name, status, labels}'
  ```

  どちらの API もページごとにオブジェクトを返すので、`--jq` でページをまたいで run の ID とジョブだけを並べる。
  `gh run view --json jobs` は `runner_name` を返さないので使わない。
  形は <https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository> と <https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run> で確かめた。
- 待った時間は、そのジョブ（`id`）を初めてこの状態で見つけた確認からの時間で測る。`created_at` からは測らない。他のジョブや run を待つ `pending` の時間が入るからである。
  `needs` で前のジョブを待つジョブは、前のジョブが終わるまで jobs API の一覧に出ないので、この状態では見つからない（GitHub-hosted の runner で確かめた）。
  初めて見つけた時刻は GitHub から取り直せないので、ジョブの `id` とともに進み具合のメモ（`SKILL.md` の「長時間実行・コンテキストの引き継ぎ」）に残す。
- 上限は 30 分にする。runner の空き（同時に実行できる数の上限、1 台だけの self-hosted の runner）を待つ `queued` も、`runner_name` が null になるからである。
  上限を超えた時点で同じ run に `in_progress` のジョブがあれば、まだ止めない。`strategy.max-parallel` で後回しにされた matrix のジョブなど、同じ run の前のジョブを待つだけの `queued` も、`runner_name` が null になりうるからである。
  同じ run に `in_progress` のジョブが無くなった後の確認でも同じ状態なら、次の項目のとおりに止まる。
- 上限を超えても同じジョブが `queued` のままで `runner_name` が null なら、runner が割り当てられていない（Actions の予算の上限、存在しないラベルの runner の指定、runner の空きが無い状態が続いているなど）。
  原因はリポジトリの外にあることが多く、ループの中では除けない。`--watch` を止め、`run-id`・ジョブの名前・`labels`・待った時間を書いて「行き詰まり」として止まり、利用者に知らせる。
- `waiting`（environment の保護ルールによる待ち）・`requested`・`pending` のジョブは、runner の割り当てとは別の待ちである。
  `--watch` はこの状態のジョブでも返らないので、上と同じ間隔で別に確かめ、上限を置く。
  上の jobs API の取得で `status` がこの 3 つのどれかのジョブを見つけ、上と同じく初めて見つけた時刻をジョブの `id` と状態とともにメモに残す。
  同じジョブの状態が変わったら（`waiting` から `queued` になったときなど）、新しい状態で初めて見つけた時刻を記録し直す。
  前の状態で待った時間を、次の状態の上限に数えないためである。

- `waiting` のジョブがある run は、何を待っているかを pending deployments の API で確かめる。
  jobs API にはジョブと environment を結ぶ欄が無いので、run の単位で取得する。

  ```bash
  gh api "repos/<owner>/<repo>/actions/runs/<run-id>/pending_deployments" \
    --jq '.[] | {environment: .environment.name, wait_timer, wait_timer_started_at, reviewers: [.reviewers[] | .reviewer.login // .reviewer.slug]}'
  ```

  `wait_timer` は分の単位で、0 より大きく `wait_timer_started_at` が null でない environment は、wait timer が終わるのを待っている。
  `wait_timer_started_at` に `wait_timer` を足した時刻までは正常な待ちなので、上限の時間に数えない。
  `reviewers` が空でない environment は、承認を待っている。
  どちらにも当たらない environment（custom deployment protection rule で待つものなど）も、承認待ちと同じ上限で扱う。
  形は <https://docs.github.com/en/rest/actions/workflow-runs#get-pending-deployments-for-a-workflow-run> で確かめた。
  `wait_timer` の単位は <https://docs.github.com/en/rest/deployments/environments#create-or-update-an-environment> で確かめた。
  environment を作るのはリポジトリの設定の変更なので、承認待ちの状態は作って確かめていない。
- 上限は、`queued` と同じ 30 分にする。待った時間は、初めて見つけた確認の時刻から測る。
  `waiting` のジョブがある run では、待った時間を environment ごとに測る。jobs API ではジョブと environment を対応づけられないので、run の単位で取得した environment を 1 つずつ数える。
  各 environment の待った時間は、その environment を pending deployments の応答で初めて見つけた確認の時刻と、その environment の wait timer の終わる時刻の遅いほうから測る。
  初めて見つけた時刻は、run の ID と environment の名前とともにメモに残す。ジョブの `id` の時刻は使わない。どのジョブがどの environment を待つかを決められないからである。
  応答からその environment が消えたら（承認や wait timer の終わりで待ちが解けたら）、メモの時刻を捨てる。
  もう一度現れたら、その確認の時刻を新しく記録する。前の待ちの時間を、次の待ちの上限に数えないためである。
  どれか 1 つの environment が上限を超えたら、上限を超えたとみなす。ほかの environment の wait timer が後で終わることは、その environment の待った時間を減らさない。
  pending deployments の API が失敗したとき（権限の不足・一時的なエラー）と、`waiting` のジョブがあるのに空の配列を返したときは、environment の起点を記録できない。
  そのときは wait timer の待ちを除かず、`waiting` のジョブを初めて見つけた確認の時刻から測る。報告には、environment を判定できなかったことと、API の応答（エラーか空か）を書く。
  上限を超えた時点で同じ run に `in_progress` のジョブがあれば、まだ止めない（`queued` と同じ理由）。
  同じ run に `in_progress` のジョブが無くなった後の確認でも同じ状態なら、`--watch` を止める。
  run の ID・ジョブの名前・状態・待った時間を書き、`waiting` のジョブなら待っている environment の名前と `reviewers`（空なら空と）も書いて、「行き詰まり」として止まり、利用者に知らせる。
- runner が割り当てられなかったことが原因で止まり、その原因を除いた後に再開したら、run を取り消してから再実行する。原因を除いた後も、`queued` のままのジョブが動き出さないことがあるからである。
  取り消しは `gh run cancel <run-id> --repo <owner>/<repo>` で行う。取り消しは非同期で、`completed` になる前の run は再実行できない。
  `gh run view <run-id> --repo <owner>/<repo> --json status` が `completed` になるのを上限を決めて待ってから、`gh run rerun <run-id> --repo <owner>/<repo>` を実行する。
- step が 0 件のまま失敗したジョブも、runner が割り当てられなかったことを示す場合がある。CI の失敗として直す前と再実行する前に、同じように `runner_name` と `labels` を確かめる。

## `no checks` を確かめ直す

push の直後にチェックがまだ登録されていなければ、数回まで確かめ直す。
確かめ直す前と、`--watch` が飛ばすだけのチェック（`skipping`）しか無い状態で終わったときは、`gh pr view <番号> --repo <owner>/<repo> --json mergeable` で競合を確かめる。
`mergeable` が `CONFLICTING` なら、ベースブランチとの競合で `pull_request` のワークフローが起動していない。待ち直さずに「行き詰まり」として止まり、競合していることを報告する。
`UNKNOWN` は GitHub が計算している途中なので、間隔を空けて数回まで取得し直す。
それでも `UNKNOWN` なら、競合が無いとは扱わない。「行き詰まり」として止まり、`mergeable` を判定できなかったことを報告する。
競合が無いのに登録されなければ、この HEAD では CI が実行されないとみなして CI を待つのをやめ、収束の判定に進む。CI が無いこと自体は失敗ではない。
