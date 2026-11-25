---
date: 2026-11-26
type: doc
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# テストの補助関数を近くのテストからまねて書き、共有の repo-file.ts を使わなかった

## 事象

Issue #1147 で `scripts/gates/packaging/skill-checks-declared.test.ts` を足した。
リポジトリのルートを求める式と、一時ディレクトリにファイルを書く `put` を、隣の `check-skill-configs.test.ts` と同じ形で自分で書いた。
`/simplify` の再利用のレビューが、`scripts/lib/testing/repo-file.ts` の `REPO_ROOT` と `write` で置き換えられると指摘し、同じファイルを書き直した。

## 根本原因

1. なぜ自前で書いたか → 隣のテストの書き方をそのまま手本にした
2. なぜ手本にしたか → 共有の補助関数を探す手順を踏まず、近くのファイルの形を正しい書き方とみなした
3. なぜ探さなかったか → docs/testing.md は `makeTempDir` を使うことは書くが、`repo-file.ts` の `REPO_ROOT`・`write` には触れていない。リポジトリでも 60 件のテストがルートの式を自分で書いている ← 根本原因

## 根拠

1 回の観測だが、原因（共有の補助関数が文書に無く、近くのテストも使っていない）を 1 つに絞れたので medium にした。
`/simplify` の再利用の観点のレビューが指摘し、置き換えた後もテストは 5 件すべて通った。
`fileURLToPath(import.meta.url)), "..", "..", ".."` を書くテストは `scripts/**/*.test.ts` に 60 件ある。
KEDB 照合: 「ヘルパー」と「repo-file」、「REPO_ROOT」と「test」で照合し、一致は無かった。

## 既存の規約

- 扱い: なし
- 場所: なし
- 照合した範囲: docs/testing.md・AGENTS.md・.agents/rules/ を「lib/testing」「test-tmpdir」「makeTempDir」「repo-file」「REPO_ROOT」で検索した。`makeTempDir` の記述だけが当たった

## 食い違い

- 相手: なし
- 判断: なし

## 提案

テストを書くときは、近くのテストの補助関数をまねる前に `scripts/lib/testing/` の共有の補助関数を探して使う。

- 反映先: docs/testing.md の一時ディレクトリの箇条の近くに、`repo-file.ts` の `REPO_ROOT`（リポジトリのルート）・`write`（一時ディレクトリにファイルを書く）を使うと書き足す
- 既存の 60 件の書き換えは、この提案に含めない
