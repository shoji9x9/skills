---
paths:
  - "skills/**"
applyTo: "skills/**"
---

# API 取得のページネーション

`gh api` 等で一覧を取得する shell / markdown コードは、**指定件数で暗黙に打ち切らない**こと。
ページングを処理して必要な範囲をすべて辿る（REST は `--paginate`、GraphQL は `pageInfo`/`endCursor` ＋ `--paginate`）。
件数が大きくなりうる場合は、全件をメモリに抱えず**ページ単位で逐次処理**し、十分なら早期終了の条件を明示する。
この規約は `scripts/lint-pagination.js` が lefthook pre-commit と CI（`Lint` ジョブ）で検査する（完全なシェルパーサではなくヒューリスティックな安全網）。判定ロジックは vitest で `scripts/lint-pagination.test.js` がカバーする。
意図的な単発取得は当該箇所に `# pagination-ok` を付けて明示する。
