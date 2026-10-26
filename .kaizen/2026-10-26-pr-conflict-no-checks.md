---
date: 2026-10-26
type: skill
priority: medium
confidence: high
status: pending
---

# PR が main と競合していると CI が起動せず、pr-finalize-loop は no checks を未登録として扱う

## 事象

PR #784 を作った時点で、先に main に入った PR #783 と、report.mjs・html.mjs が競合していた（`mergeable: CONFLICTING`、`mergeStateStatus: DIRTY`）。
`pull_request` の CI が起動せず、HEAD の check-run は 0 件で、`gh pr checks --watch` は `no checks reported` で終わった。
pr-finalize-loop の手順は `no checks` を「push の直後でまだ登録されていない」とだけ扱い、確かめ直した後は「この HEAD では CI が実行されない」として収束の判定に進む。
今回は、check-run の数を API で数えてから `gh pr view --json mergeable` を見て、競合に気付いた。

## 根本原因

- なぜ CI が無かったか → GitHub は、競合している PR の merge commit を作れないので、`pull_request` の workflow を起動しない
- なぜ手順が拾わないか → `no checks` の原因を「未登録」と「CI が無いリポジトリ」の 2 つだけで挙げ、「競合で起動しない」を挙げていない ← 根本原因
- なぜ挙がらなかったか → 書いたときの事例が push の直後の未登録だけで、PR の作成から時間がたつ間に main が進む場合を状態に入れていなかった

## 根拠

- `gh api repos/shoji9x9/skills/commits/947847d1.../check-runs` の `total_count` が 0
- `gh pr view 784 --json mergeable,mergeStateStatus` が `CONFLICTING`・`DIRTY`
- `git merge-tree --write-tree HEAD origin/main` が、report.mjs・html.mjs とそのインストール済みのコピーの 4 ファイルで競合を出した

## 提案

pr-finalize-loop の「CI 状態の確認」で、`no checks` のときは `gh pr view --json mergeable,mergeStateStatus` を確かめ、`CONFLICTING` なら確かめ直しを続けずに base を取り込んで競合を解く手順を足す。

- 競合を解く手順は、rebase と force push をせず、base を merge する形で書く（`--amend`・force push をしない取り決めと揃える）
- `mergeable` は計算が終わるまで `UNKNOWN` を返すことがあるので、`UNKNOWN` は確かめ直す
