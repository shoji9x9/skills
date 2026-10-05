---
paths:
  - "skills/**"
applyTo: "skills/**"
---

# API 取得のページネーション

`gh api` などで一覧を取得するシェルや Markdown のコードは、指定した件数で取得を打ち切らずに、ページングを処理して必要な範囲をすべて取得する。
REST では `--paginate` を、GraphQL では `pageInfo`・`endCursor` と `--paginate` を使う。
件数が大きくなりうる場合は、全件をメモリに保持せずにページ単位で順に処理する。途中で終えてよいなら、終える条件を書く。

この規約は `scripts/gates/lint-pagination.js` が lefthook の pre-commit と CI の `Lint` ジョブでチェックする。
完全なシェルのパーサではなく、ヒューリスティックで検出するチェックである。判定の処理は `scripts/gates/lint-pagination.test.js` がテストする。
意図して 1 回だけ取得する箇所には、`# pagination-ok` を付ける。
