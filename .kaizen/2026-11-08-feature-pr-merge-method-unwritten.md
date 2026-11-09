---
date: 2026-11-08
type: doc
priority: medium
confidence: high
status: applied
applied-to: ["AGENTS.md", ".config/skills/shoji9x9/issue-batch.jsonc", "#962"]
session: claude-code
---

# 機能の PR を、リポジトリが使うマージの方法を確かめずに squash でマージした

## 事象

このセッションで、PR #951・#954・#958 を `gh pr merge --squash` でマージした。
`main` の first-parent の履歴では、ほかの機能の PR（#943〜#950・#955 など）は通常のマージ（`Merge pull request #...`）で取り込まれていて、squash は Dependabot の PR だけだった。
PR #959 をマージする前に、利用者が「マージする場合はsquashではなく通常のマージとして下さい」と指示した。

## 根本原因

- なぜ squash を選んだか → `gh pr merge` の方法を、前の PR で使った形から書き写し、リポジトリの取り込み方を確かめなかった
- なぜ確かめる手がかりが無かったか → `AGENTS.md`「ブランチ運用」は、PR で取り込むことと必須チェックを書くが、機能の PR をどの方法でマージするかを書いていない。
  設定にある `merge_method: squash` は `dependabot-merge` と `issue-batch` の設定で、手でマージする機能の PR には当たらない。
  リポジトリはどの方法も許可しているので、GitHub もエラーを出さない
- 方法を誤っても PR はマージされ、履歴の形が変わるだけなので、利用者が履歴を見るまで気付かない

## 提案

`AGENTS.md`「ブランチ運用」に、機能の PR は通常のマージ（`gh pr merge <番号> --merge`）で取り込み、squash は Dependabot の PR（`dependabot-merge` の設定）だけに使う、と足す。

- `issue-batch.jsonc` の `merge_method: squash` が、機能の PR を扱う `issue-batch` の決まりと食い違うので、`merge` に変えるかを利用者に確かめる
