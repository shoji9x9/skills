---
date: 2026-10-15
type: upstream
priority: low
status: pending
applied-to: []
session: claude-code
---

# gh issue develop の GraphQL のエラーは、作られたものが無いことを確かめてから名前を変えて試す

## 事象

issue-batch の Issue #628 で、`gh issue develop` が 2 回続けて `GraphQL: Something went wrong while executing your query` で失敗した。
名前は `feature/628-agent-usage-codex-branch-retract-tz`、ベースは `main` だった。
`gh api graphql` の単純な問い合わせは通り、`git ls-remote` と `gh issue develop --list` でブランチが作られていないことを確かめた。
`--repo shoji9x9/skills` を付け、名前を `feature/628-agent-usage-retract-tz` に短くすると通った。

## 根本原因

1. なぜ失敗したか → GitHub の createLinkedBranch がサーバの内部エラーを返した（原因は応答から分からない）。
2. なぜ 2 回目も失敗したか → 同じ引数で再実行したので、同じ条件に当たった。
3. なぜ原因を切り分けられないか → エラーの本文に原因が無く、どちらの変更（名前・`--repo`）で通るようになったかを確かめていない ← 上流の不具合の可能性がある

## 提案

`gh issue develop` が GraphQL の内部エラーで失敗したら、ブランチが作られていないことを `git ls-remote` で確かめてから、`--repo` を付けて名前を短くして試す。

- 再現の条件（名前の長さ・`--repo` の有無）を切り分けられたら、cli/cli か GitHub に報告するかを決める。
