---
date: 2026-10-05
type: doc
priority: medium
status: pending
session: claude-code
---

# 文書を書き換えたら、push の前に差分に当たるミューテーションテストを実行する

## 事象

段階 ③ で `docs/tooling.md` などを書き換えた後、手元では lint-prose の定義だけを `check-mutation-proof.js` で実行して push した。
`check-time-sensitive-prose.test.js` には実リポジトリの文書を読むテストがあり、書き換えで「1 変異 = 対象テストファイル 1 回の実行」の表記がなくなった。
そのため CI の Mutation proof (PR) で、MC-ONE の変異をこのテストが検出しなくなり、失敗した。

## 根本原因

- 誤った理由: 文書だけの変更はミューテーションテストに影響しないと考えた。
- 確かめなかった理由: 手元で実行する定義を、自分が変えたテストファイルから選んだ。テストが読む文書は選ぶ材料にしなかった。
- その理由: CI と同じ選び方（`--changed-since`）を手元で実行する手順が、push の前の確認に入っていなかった。

## 提案

文書を含む変更を push する前に、`node scripts/mutation/check-mutation-proof.js --changed-since origin/main` を実行する。

- CI の Mutation proof (PR) と同じ選び方なので、文書を読むテストを持つ定義も選ばれる。
- 時間がかかるときは、バックグラウンドで実行して push の前に結果を確かめる。
