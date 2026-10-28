# レビュースレッドの取得・返信・解決

PR のレビュースレッドを `gh` で取得し、返信して解決する手順。
このファイルは、`pr-review-handle` と `pr-finalize-loop` が同じ内容で持つ。返信してから解決する順序は、各スキルの `SKILL.md` の手順に従う。

## 未解決スレッドの取得（GraphQL・全ページ取得）

`threadId`（解決に要る）、解決の状態、先頭のコメントの `databaseId`（返信に要る）をまとめて取得できる。
未解決のスレッドは 1 ページに収まらないことがあるので、`first: 50` のように 1 回だけ取得すると、50 件を超えた分を取りこぼす。
`pageInfo` と `endCursor` を含めて、`--paginate` で全ページを取得する。

```bash
gh api graphql --paginate -f query='
query($endCursor: String) {
  repository(owner: "<owner>", name: "<repo>") {
    pullRequest(number: <番号>) {
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
}' --jq '.data.repository.pullRequest.reviewThreads.nodes[] |
  {id, isResolved, databaseId: .comments.nodes[0].databaseId, author: .comments.nodes[0].author.login,
   path: .comments.nodes[0].path, line: .comments.nodes[0].line, body: .comments.nodes[0].body}'
```

`--paginate` は、`pageInfo { hasNextPage endCursor }` と `$endCursor` の変数があれば、全ページを自動でたどる。
`--jq` は、返信と解決に要る項目だけを、解決済みのスレッドも含めて出力する。解決済みも出すのは、レビューのコメントの件数と、取得できたスレッドを突き合わせるためである。
処理するのは `isResolved == false` のスレッドだけで、1 件ずつ扱う。すべてのレビュアーを対象にし、作成者では絞らない。
返信先には、先頭のコメントの `databaseId` を使う。`databaseId` が `null` のスレッド（先頭のコメントが削除されたものなど）には返信も解決もせず、そのスレッドの `id` を報告する。
pr-finalize-loop は、この取得を使わず、`state-query.md` の索引の出力（`id` と `comments.nodes[0].databaseId`）を返信と解決に使う。

## 返信（REST）

スレッドの先頭のコメントの `id`（`databaseId` と同じ）に返信する。
本文はバッククォートや `$` を含みうるので、quoted heredoc（かファイルを書くツール）でファイルに書き、`-F body=@<path>` で渡す。`gh api` には `--body-file` が無い。

```bash
body_file=$(mktemp)
cat > "$body_file" <<'EOF'
<返信本文>
EOF
gh api --method POST \
  repos/<owner>/<repo>/pulls/<番号>/comments/<comment-id>/replies \
  -F body=@"$body_file"
rc=$?
rm -f "$body_file"
(exit "$rc")  # gh の失敗を後片付けの終了コードで隠さない
```

## 解決（GraphQL）

返信を投稿した後で、スレッドを解決する。

```bash
gh api graphql -f query='
mutation {
  resolveReviewThread(input: { threadId: "<threadId>" }) {
    thread { isResolved }
  }
}'
```

## スレッドの外の指摘の形と集める対象

指摘が書かれる場所はスレッドだけではない。集める対象は次の 3 つである。

1. レビュースレッド（`reviewThreads`）
2. レビューの本文（`reviews[].body`）
3. PR のトップレベルのコメント（`issues/<番号>/comments`）

2 と 3 は `reviewThreads` にも `comments.totalCount` にも現れない。
そのため、未解決のスレッドが 0 件で、作られたコメントが 0 件でも、対応していない指摘が残っていることがある。実測で見つかった形は次の 2 つである。

- レビューの本文: Copilot は、確信度の低い指摘を本文の `<details>` の中に `### Comments suppressed due to low confidence (N)` として入れ、ヘッダには `Comments generated: 0 new` と書く。
  本文の冒頭には、`### 🟡 Not ready to approve` のような総合の判定も入る。
- トップレベルのコメント: Claude の GitHub Action（`review_tool: claude-code`）は、総評と軽い指摘をトップレベルのコメントに置き、`reviews[].body` を空、`state` を `COMMENTED` にする。
  この形では、指摘がスレッドにも本文にも現れない。

トップレベルのコメントから指摘を集める対象は、自分（PR の作成者。pr-review-handle と pr-finalize-loop が書いた依頼のコメントや対応の記録を含む）以外の投稿すべてである。
ただし、`review_tool: local` の記録のうち、PR の作成者か担当者が投稿したもの（本文が `<!-- pr-finalize-loop:local-review` で始まるコメント）は除く。
記録は担当者が投稿することもあり、作成者を除くだけでは除けない。
それ以外の人が投稿した、目印で始まるコメントは除かず、ほかのコメントと同じように指摘を集める。
記録の本文の指摘は、記録の `open` で追う（[`review-tool.md`](review-tool.md) の「local」）。
`select(.user.type=="Bot")` で bot に絞らない。人のレビュアーが総評をトップレベルに置くこともあるので、絞ると取りこぼす。
`.user.type` は bot か人かを区別するためだけに使い、集める対象の絞り込みには使わない。
