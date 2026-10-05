# PR の状態を取得するときにコンテキストを節約する

CI とレビューを繰り返し確かめるときに、reviews・timeline・トップレベルのコメントの全文を毎回返すと、状態がほとんど変わっていなくてもコンテキストを使う。
取得を「索引（compact index）」と「必要な本文」の 2 段に分け、判定の正確さを落とさずに出力を減らす。

## 1 段目: 索引（compact index）

反復ごとに、最初は次のものだけを取得する。

| 対象 | 取得するもの |
| --- | --- |
| PR | `state`、`headRefOid`、作成者 |
| reviews | ID、作成者、state、commit の OID、submittedAt、行に付いたコメントの件数。`body` はまだ取らない |
| reviewThreads | `isResolved == false` のスレッドと、その指摘の本文 |
| トップレベルのコメント | 作成者以外のコメントの ID、作成者、createdAt、updatedAt、本文の文字数。`body` はまだ返さない |
| timeline | review request やレビューの開始など、進行中かの判定に要るイベントと時刻だけ |
| check-runs（`review_tool` が `claude-code` か `codex` のとき） | 現在の `headRefOid` を ref にした、レビュー用の候補の ID、name、head_sha、app、status、conclusion、started_at、completed_at。1 段目では `output` を返さず、2 段目で候補だけについて `output.title` と `output.summary` を取り出す |

reviews と reviewThreads はページネーションのカーソルが別なので、1 つの `$endCursor` を共用せず、別のクエリでそれぞれ全ページを取得する。
`gh api --jq` で要る行だけを出力し、加工していない API の応答の全体を会話に返さない。

```bash
# review の索引。body は要求しない
gh api graphql --paginate -f query='query($endCursor: String) {
  repository(owner: "<owner>", name: "<repo>") {
    pullRequest(number: <number>) {
      headRefOid
      author { login }
      reviews(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          databaseId
          author { login }
          state
          submittedAt
          commit { oid }
          comments { totalCount }
        }
      }
    }
  }
}' --jq '.data.repository.pullRequest'

# 未解決のスレッドだけを出力する
gh api graphql --paginate -f query='query($endCursor: String) {
  repository(owner: "<owner>", name: "<repo>") {
    pullRequest(number: <number>) {
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes { databaseId author { login } path line body }
          }
        }
      }
    }
  }
}' --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)]'

# 作成者以外のコメントの索引。本文は文字数だけを出す
gh api --paginate repos/<owner>/<repo>/issues/<number>/comments \
  --jq '.[] | select(.user.login != "<author>") |
    {id, login: .user.login, created_at, updated_at, body_length: (.body | length)}'

# 現在の HEAD の check-run の索引。output は 2 段目で候補だけ取得する
gh api --paginate \
  "repos/<owner>/<repo>/commits/<headRefOid>/check-runs?filter=all&per_page=100" \
  --jq '.check_runs[] | {id, name, head_sha, app: .app.slug, status, conclusion, started_at, completed_at}'
```

## 2 段目: 対象だけ全文を取得する

索引を前回に取得した状態と比べ、次に当たるものだけ本文を個別に取得する。

1. 現在の `headRefOid` に対する、作成者以外のレビュー
2. 前回の取得より後に submit されたレビュー。commit が前の HEAD でも、push の前から進んでいて遅れて届いたレビューは、今の HEAD にも当てはまる指摘を含むので対象にする
3. 未処理のレビューの ID。自分が残した対応の記録のコメントに ID が無く、まだ妥当かを判断していないもの
4. 作成者以外の、新しいか更新されたトップレベルのコメント
5. 未解決のレビュースレッド（1 段目で本文を取得済み）
6. `review_tool` が `claude-code` か `codex` のときに、レビューが届いたかの判定に使う、現在の HEAD の check-run。
   候補だけについて `output.title` と `output.summary` を取得し、正常に完了したか、失敗・timeout・skip などかを判定する。
   トップレベルのコメントだけを根拠にするときは、本文に書かれたレビューした commit を GitHub API で完全な SHA に解決し、現在の `headRefOid` と一致することも確かめる

```bash
gh api repos/<owner>/<repo>/pulls/<number>/reviews/<review-database-id> \
  --jq '{id, user: .user.login, commit_id, submitted_at, state, body}'

gh api repos/<owner>/<repo>/issues/comments/<comment-id> \
  --jq '{id, login: .user.login, created_at, updated_at, body}'

gh api --paginate \
  "repos/<owner>/<repo>/commits/<headRefOid>/check-runs?filter=all&per_page=100" \
  --jq '.check_runs[] | {id, name, head_sha, app: .app.slug, status, conclusion, started_at, completed_at, title: .output.title, summary: .output.summary}'
```

ID と `updated_at` が同じ本文は、反復ごとに取得し直さない。
コンテキストの自動圧縮（auto-compaction）の後は、GitHub のレビューとコメントの ID と、自分が PR に残した対応の記録から、処理済みのものの集合を作り直す。

## 取りこぼさないために

- 最新の HEAD のレビューだけに絞らない。前回の取得より後に遅れて届いた、前の HEAD へのレビューも必ず読む。
- レビューの本文とトップレベルのコメントが妥当かを判断するときは、全文を読む。進行中の検出に使う `.body[:200]` を使い回さない。
- `comments.totalCount > 0` のレビューに対応するスレッドが見えなければ、反映が遅れているとみなして再取得する。
- 索引が空でも、すぐに「指摘なし」としない。CI やレビューが始まった直後は、上限を決めて確かめ直す。

API の形は次を参照する。
[GitHub GraphQL PullRequest](https://docs.github.com/en/graphql/reference/objects#pullrequest)、
[Pull request reviews REST API](https://docs.github.com/en/rest/pulls/reviews)、
[Issue comments REST API](https://docs.github.com/en/rest/issues/comments)、
[Check runs REST API](https://docs.github.com/en/rest/checks/runs)。
