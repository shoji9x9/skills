---
date: 2026-10-17
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# ローカルのミューテーションテストは、変えた判定と足したテストに関わる変異に `--only` で絞り、全件は CI に任せる

## 事象

Issue #632 の作業で、テストの assertion を変えるたびに、rule の「全件を実行し直す」に従って `cli.mutations.json`（80 件）をローカルで全件実行した。
1 回に 20〜40 分かかり、レビューの反復が全件の実行を待って止まった。
利用者から「CI でミューテーションテストを全件行っているので、ローカルは対象を絞る」「開発速度を上げたい」と指示を受けた。
絞った実行（10 件）は数分で終わり、足したテストが既存の変異 `undecided-branch-passes` を宣言の外で落とすことも、その中で見つかった。

## 根本原因

- なぜ全件を実行したか → `.agents/rules/state-space-and-mutation-proof.md` が、assertion を変えたら `--only` で絞らず全件を実行し直すと書いている
- なぜそれが遅さになったか → CI の `Mutation proof (PR)` が差分に当たる定義を 12 shard で全件実行しており、ローカルの全件は同じ確認を重ねていた
- なぜ気づかなかったか → rule が、CI がすでに同じ範囲を確かめることを前提にした書き方になっていない

## 提案

ローカルのミューテーションテストは、変えた判定と足したテストに関わる変異に `--only` で絞り、全件の実行は CI の `Mutation proof (PR)` に任せる。

- 適用先候補: `.agents/rules/state-space-and-mutation-proof.md` の「assertion を書き換えたら」の節と `docs/tooling.md` のミューテーションテストの節
- 絞り方: 足した変異、`find` を変えた変異、変えた関数を対象にする変異を選ぶ。宣言の外で落ちる変異は CI が検出するので、push の後に CI の結果で直す
