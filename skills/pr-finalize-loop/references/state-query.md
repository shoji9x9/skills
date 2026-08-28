# PR 状態取得のコンテキスト節約

CI とレビューを繰り返し確認するとき、毎回 reviews・timeline・トップレベルコメントの全文を返すと、状態がほぼ同じでもコンテキストを消費する。
取得を「索引」と「必要な本文」の2段に分け、判定精度を落とさず出力量を抑える。

## 1段目: compact index

各反復では最初に次だけを取得する。

- PR: `state`、`headRefOid`、author
- reviews: ID、author、state、commit OID、submittedAt、inline comment件数。`body` はまだ取らない
- reviewThreads: `isResolved == false` のスレッドと、その指摘本文
- トップレベルコメント: 非著者分のID、author、createdAt、updatedAt、body文字数。`body` はまだ返さない
- timeline: review request・review開始など、進行判定に必要なeventと時刻だけ

reviews と reviewThreads は pagination cursor が別なので、1つの `$endCursor` を共用せず別クエリで全ページを取得する。
`gh api --jq` で必要な行だけ出力し、未加工のAPIレスポンス全体を会話へ返さない。

```bash
# review index。bodyを要求しない
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

# unresolved threadsだけを出力する
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

# 非著者コメントの索引。本文は文字数だけ
gh api --paginate repos/<owner>/<repo>/issues/<number>/comments \
  --jq '.[] | select(.user.login != "<author>") |
    {id, login: .user.login, created_at, updated_at, body_length: (.body | length)}'
```

## 2段目: 対象だけ全文取得

indexを前回の取得状態と比較し、次に該当する本文だけを個別取得する。

1. 現在の `headRefOid` に対する非著者review
2. 前回取得後にsubmitされたreview。commitが旧HEADでも、push前から進行していた遅延reviewは現HEADへ適用できる指摘を含むため対象
3. 未処理のreview ID。自分の対応記録コメントにIDが無く、まだ妥当性判断していないもの
4. 新規・更新された非著者トップレベルコメント
5. 未解決review thread（1段目で本文取得済み）

```bash
gh api repos/<owner>/<repo>/pulls/<number>/reviews/<review-database-id> \
  --jq '{id, user: .user.login, commit_id, submitted_at, state, body}'

gh api repos/<owner>/<repo>/issues/comments/<comment-id> \
  --jq '{id, login: .user.login, created_at, updated_at, body}'
```

同じID・同じ`updated_at`の本文は反復ごとに再取得しない。
auto-compaction後はGitHubのreview/comment IDと、自分がPRへ残した対応記録から処理済み集合を再構築する。

## 取りこぼし防止

- 「最新HEADのreviewだけ」には限定しない。前回取得後に遅延到着した旧HEAD reviewも必ず読む
- review本文・トップレベルコメントの妥当性判断では全文を読む。進行中検出用の`.body[:200]`を流用しない
- `comments.totalCount > 0` のreviewに対応するthreadが見えなければ、反映ラグとして再取得する
- indexが空でも即座に「指摘なし」としない。CI/review開始直後は上限付きで再確認する

API形状は [GitHub GraphQL PullRequest](https://docs.github.com/en/graphql/reference/objects#pullrequest)、
[Pull request reviews REST API](https://docs.github.com/en/rest/pulls/reviews)、
[Issue comments REST API](https://docs.github.com/en/rest/issues/comments) を参照する。
