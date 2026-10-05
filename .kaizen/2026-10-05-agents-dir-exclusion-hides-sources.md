---
date: 2026-10-05
type: hook
priority: medium
status: applied
applied-to: [scripts/lib/source-scope.js, scripts/gates/lint-scope.test.js]
session: claude-code
---

# .agents/ を丸ごと除外すると rule と private skill の実体がチェックから外れる

## 事象

- #372 で新設した lint-prose の対象範囲を、lefthook の `*agent-copies`（`.agents/**` と `.claude/**`）と同じ除外で決めた。
  `.agents/rules/` の rule の実体と private skill が対象から外れ、利用者の指摘で気づいた。
- 同じ除外は既存の設定にもあった。markdownlint-cli2 は rule をリンクの `.github/instructions/` でしか見ず、
  private skill は一度も見ていなかった（直したら違反が 4 件出た）。lefthook の markdownlint は rule だけの commit で実行されなかった。
- 横断で確かめると、oxlint と oxfmt の `ignorePatterns`、CI の Shell lint と JSON lint の `find` も `.agents` を丸ごと除いている。
  private skill の `normalize-pnpm-audit.js` は lint も整形もされていない。

## 根本原因

- なぜ 1: 新しいチェックの対象範囲を、既存の除外の定義をそのまま使って決めた。
- なぜ 2: 既存の除外は「`.agents/` はインストール済みのコピー」という前提で書かれていた。
  実際には `.agents/` にコピー（`.agents/skills/<name>/`）と実体（`.agents/rules/` と private skill）が一緒に置かれている。
- なぜ 3: 実体のファイルが各チェックの対象に入っていることを確かめる仕組みが無い。
  除外で外れたファイルは出力に現れないので、除外を足しても何も失敗しない。
  #372 で markdownlint には `markdownlint-scope.test.js` を足したが、他のツールには無い。

## 提案

各 lint と整形の対象範囲が、実体（`.agents/rules/` と `.private-skill` を持つ `.agents/skills/<name>/`）を含み、コピーと `.claude/` を除くことを、ツールごとにテストで確かめる。

- 対象: oxlint と oxfmt の `ignorePatterns`、CI の Shell lint と JSON lint の `find`、lefthook の `*agent-copies` を使うジョブ、
  `lint-yaml.js` と `check-control-chars.js` などスクリプトの対象の決め方
- 除外は `.agents/**` ではなく `.agents/skills/**` と書き、private skill を含め直す（markdownlint で確かめた形）
- 実体とコピーの一覧を 1 か所で計算し、各ツールの設定がそれと一致するかをテストする
