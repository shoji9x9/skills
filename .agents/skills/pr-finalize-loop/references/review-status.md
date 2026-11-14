# HEAD のレビュー済み判定と、指摘の集め方

`pr-finalize-loop` の基本フローの手順 1（状態の取得）と手順 2（収束の判定）で読む。

すべてのレビュアーを対象にするので、未解決のスレッドやレビューを取得するときに作成者で絞る必要は無い。
`review_tool: copilot` では、Copilot の作成者の login が API によって違う。判定で使う書き方は、[`review-tool.md`](review-tool.md) の「copilot」で定める。

## HEAD のレビュー済み判定

現在の HEAD（最新の commit）がレビュー済みかは、次の根拠を現在の HEAD と突き合わせて判定する。前の commit へのレビューや古い完了のコメントを根拠に、最新の push をレビュー済みとしないためである。

```bash
gh api graphql --paginate -f query='
query($endCursor: String) {
  repository(owner: "<owner>", name: "<repo>") {
    pullRequest(number: <番号>) {
      headRefOid
      author { login }
      reviews(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { author { __typename login } state commit { oid } }
      }
    }
  }
}'
```

- レビューは `--paginate` で全ページを取得する。
  作成者を除くこと（次の項目）を前提にすると、作成者の返信（COMMENTED のレビュー）が直近に続いたときに、作成者以外の HEAD へのレビューが `last: N` の範囲から押し出されることがある。
  そのため 1 回だけの取得では「レビューされていない」と誤って判定し、要らない再依頼をしてしまう。
- PR の作成者（`pullRequest.author.login`）によるレビューは、必ず判定から除く。
  レビュースレッドへの返信は、REST と GraphQL では作成者の `state: COMMENTED` のレビューとして記録され、その `commit.oid` が返信した後の新しい HEAD を指すことがある（実測）。
  除かないと、このスキルの標準の流れ（直す・返信する・push する）を回すたびに、誰もレビューしていない新しい HEAD を「レビュー済み」と誤って判定し、再依頼を忘れる。
- 作成者以外のレビューのうち、次のどちらかに当たる人のレビューの `commit.oid` が `headRefOid` と一致すれば、現在の HEAD はレビュー済みである。
  1. bot（`author.__typename` が `Bot`）。レビューのツールの GitHub App は、リポジトリに導入されていないとレビューを投稿できない。
  2. リポジトリへの書き込み権限を持つ人。`gh api repos/<owner>/<repo>/collaborators/<login>/permission --jq .permission` が `admin` か `write` の人である。

  PR にコメントできる人なら誰でもレビューを投稿できるので、権限の無い人のレビューを数えると、その人が HEAD をレビュー済みにして収束させられる。
  権限の無い人のレビューの指摘は、これまでどおり集めてコードの事実で評価する。数えないのは、レビュー済みの判定だけである。
  権限を取得できないときは、その人のレビューを数えず、レビューされていないとして扱う。
- `review_tool` が `claude-code` か `codex` のときは、指摘が 0 件だと、レビューの結果がトップレベルのコメントか check-run だけに載り、`reviews[]` にレコードそのものが作られないことがある。次のどちらかも、レビューが届いた根拠として認める。
  1. `headRefOid` を ref にして取得した check-run のうち、名前・GitHub App・出力の内容から Claude のレビュー用だと確かめられ、正常に完了したもの。
     `status: completed` だけでは足りない。`conclusion` と、`output.title`・`output.summary` も読み、失敗・timeout・skip・spend cap などでレビューが行われなかったものを除く。
  2. PR の作成者以外のレビューの bot によるトップレベルのコメントのうち、本文がレビューの完了かレビューの結果を示し、レビューした commit が現在の `headRefOid` と一致するもの。
     Codex は `Reviewed commit` を短縮 SHA で書く（実測）ので、手で補わず、`gh api repos/<owner>/<repo>/commits/<短縮SHA> --jq .sha` で完全な SHA に解決し、`headRefOid` と文字単位で一致することを確かめる。
     解決に失敗したもの、候補が複数あるもの、一致しないもの、working などの進行中のもの、エラーや skip のもの、関係の無い bot のコメントは除く。
- コメントの `created_at` や `updated_at` が直近の push の基準の時刻より後だというだけでは、レビュー済みの根拠にしない。前の HEAD で始まったレビューが新しい push の後に完了すると、この時刻の条件を満たしてしまうからである。
  本文の commit を完全な SHA に解決できない完了のコメントは、指摘を集めることと check-run の意味を確かめることには使えるが、それだけで現在の HEAD にレビューが届いた証拠にはならない。
- check-run は、GitHub の commit の ref 用の endpoint で、現在の HEAD に絞って取得する。
  デフォルトの `filter=latest` は、同じ名前の check-run の古い再実行をまとめてしまう。その HEAD のすべての試行を判定する必要があれば、`filter=all` とページネーションを使う。

  ```bash
  gh api --paginate \
    "repos/<owner>/<repo>/commits/<headRefOid>/check-runs?filter=all&per_page=100" \
    --jq '.check_runs[] | {name, head_sha, status, conclusion, app: .app.slug, started_at, completed_at, title: .output.title, summary: .output.summary}'
  ```

  API の形は [GitHub の check runs REST API](https://docs.github.com/en/rest/checks/runs) を、Claude Code Review の指摘が 0 件のときの出力は [Claude Code Review 公式ドキュメント](https://code.claude.com/docs/en/code-review) を参照する。
- `review_tool` が `local` のときは、上の根拠の代わりに、同梱の `scripts/local-review-record.sh check --pr <PR URL>` で判定する。
  exit 0 で、出力の `head` が `headRefOid` と一致するときだけレビュー済みとする。exit 2 は判定できないので、間隔を空けて数回取得し直す。
  それでも exit 2 なら、レビュー済みとも未レビューとも扱わずに「行き詰まり」として止まり、`check` の stderr を報告に書く。権限の不足のような続く失敗で、ループが終わらなくなるのを防ぐ。
  exit 4 は、gh のユーザーを取得できず、本人の記録を見分けられないことを表す。取得し直しても変わらないので、すぐに「行き詰まり」として止まり、`local` を使えない理由を報告に書く。
  exit 1 でも `status=open` なら、今の HEAD はレビューしてあり、未対応の指摘が残っている。レビューを依頼し直さない。
  未対応に直すと決めた指摘があれば、収束とは判定せず、`SKILL.md` の手順 4 でその指摘を直し、手順 5 で push する。
  未対応が判断待ちだけなら、HEAD はレビュー済みとして扱い、ほかの判断待ちと同じ扱いにする（`--defer-decisions` では「判断待ちで終了」、付けないときは利用者に確かめる）。
  直すと決めた指摘が残っているか、判断待ちだけかは、記録の本文に書いた対応で見分ける。
  記録は PR の作成者か担当者が投稿するので、作成者を除く上の規則は、この記録には当てない（[`review-tool.md`](review-tool.md) の「local」）。
- `review_tool` が `claude-code-action` のときは、上の根拠の代わりに、同梱のスクリプトの `check` で判定する。
  コマンドは `scripts/claude-review-action.sh check --pr <PR URL> --effort <今の段階の effort> [--since <直近の対応の createdAt>]` である。
  exit 0（`status=reviewed`）で、出力の `head` が `headRefOid` と一致するときだけレビュー済みとする。
  exit 1 は、出力の `status` で扱いを分ける（[`review-tool.md`](review-tool.md) の「claude-code-action」の表）。`in-progress` は完了を待ち、`not-reviewed` は `SKILL.md` の手順 6 で依頼し、`paused` と `failed` は依頼せずに「レビュー未着で待機終了」として止まる。
  exit 2 は判定できないので、間隔を空けて数回取得し直し、それでも exit 2 なら「行き詰まり」として止まる。exit 3 はワークフローが無いので、すぐに「行き詰まり」として止まり、導入が要ることを報告に書く。
  レビューのレコード・check-run・bot のコメントの本文は、このツールの判定に使わない。指摘が 0 件でも、目印で判定できる。
- 上の根拠がどれも無ければ、最新の HEAD はレビューされていない。
  レビュー済みと判定した後も、レビューの本文・トップレベルのコメント・check-run の出力に、対応していない指摘や失敗が無いかを、この後の収集と突き合わせで確かめる。「届いた」と「指摘が無い」を同じものとして扱わない。
- 収束の判定では、この「HEAD がレビュー済み」を条件に入れる（`review_tool: none` を除く）。すでにレビュー済みならレビューを依頼しない。完了した PR に余計なレビューを起こさないためである。

## レビュー内容との整合検証（スレッド反映ラグ）

レビューが submit された直後は、レビュー（`reviews`）は取得できるのに、`reviewThreads` へのコメントの反映が遅れることがある（実測）。
未解決のスレッドが 0 件というだけで「指摘なし」と判定すると、コメント付きのレビューを取りこぼす。

レビューは [`state-query.md`](state-query.md) の 1 段目（review の索引。`comments { totalCount }` を含み、`body` は取らない）で取得し、レビュー済みかの判定と、この突き合わせの両方に使う。
本文は、同じファイルの 2 段目で、対象のレビューだけを取得する。

- HEAD への作成者以外のレビューの `comments.totalCount` が 1 以上なのに、そのレビューのコメントを reviewThreads から取得できなければ、反映が遅れているとみなす。
  Copilot なら、レビューの本文の「generated N comments」でも件数を確かめられる（実測）。
  間隔を空けて再取得し（`SKILL.md` の「ポーリングと待機」の上限に従う）、合うまで収束の判定をしない。
- 上限までに合わなければ、「スレッドがまだ反映されていない可能性」を残りの作業として書いて報告する。警告なしに「指摘なし」と結論しない。

## スレッド外に置かれた指摘（レビュー本文・トップレベルコメント）

指摘が書かれる場所はスレッドだけではない。レビューの本文と PR のトップレベルのコメントにも置かれる。置き場所と実測した形、トップレベルのコメントから集める対象は、[`review-threads.md`](review-threads.md)「スレッドの外の指摘の形と集める対象」にある。
参照先を読めなければ、収束したと判定せず、「行き詰まり」として止まる。

取得は、[`state-query.md`](state-query.md) の 2 段の取得に従う。索引（1 段目）で本文を読む対象を決め、その本文だけを個別に取得する。

```bash
# レビュー本文（索引で対象と決めた review だけ）
gh api repos/<owner>/<repo>/pulls/<番号>/reviews/<review-database-id> \
  --jq '{id, user: .user.login, commit_id, submitted_at, state, body}'

# トップレベルコメント（索引で新規・更新と決めたものだけ。本文は切り詰めない）
gh api repos/<owner>/<repo>/issues/comments/<comment-id> \
  --jq '{id, login: .user.login, type: .user.type, created_at, updated_at, body}'
```

- 反復ごとに、索引から本文を読む対象（HEAD への作成者以外のレビュー、前回の取得より後に届いたレビュー、未処理のレビュー）を決めて、`body` を読む。`state` が `COMMENTED` でも、本文に指摘や総合の判定が入る。
- トップレベルのコメントも、反復ごとに、索引で新しいものと更新されたものを見つけて読む。
  特に `review_tool` が mention で依頼する方法（`claude-code`・`codex`）のときは、レビュアーが総評と指摘をここに置くものとして扱う。`reviews[].body` が空でも指摘はある。
  `claude-code-action` も、行に付けない指摘を `github-actions[bot]` の総評のコメントに書く。
  自分（PR の作成者）の投稿と、作成者か担当者が投稿した `<!-- pr-finalize-loop:local-review` で始まる記録は、集める対象から除く。それ以外の人が投稿した、目印で始まるコメントは除かない。`.user.type` で bot だけに絞らない。人のレビュアーが総評をトップレベルに置くこともある。
- 切り詰めずに読む。`review-request.md`「レビュー進行中の検出」の補助のシグナルは同じ API を `body: .body[:200]` で取得するが、それは進行中か完了かの判定のためである。
  その取得を指摘の収集に使い回さない。200 文字より後ろの指摘を取りこぼす。
- レビューの本文とトップレベルのコメントにある指摘には、返信するスレッドが無く、`resolve` もできないので、PR のトップレベルのコメントで返す（`SKILL.md` の手順 4 の 4）。
  指摘の側には対応の記録が残らないので、対応したかどうかは、自分のコメントだけを証跡として扱う。
- レビュアーが次の回の総評で、前の指摘を「対応されていない」として載せ直すことがある（実測）。載せ直された指摘も対応していない指摘として扱い、自分の証跡のコメントと突き合わせて、対応済みかを判断する。
- 総合の判定（`Not ready to approve` など）が残ったまま完了するときは、その根拠（どの指摘に基づくのか、直したのか見送ったのか）を報告に書く。
  必須チェックに影響しない判定でも、利用者がマージしてよいかを判断する材料になる。
