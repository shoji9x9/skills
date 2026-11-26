---
date: 2026-11-26
type: rule
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 配布スキルのシェルスクリプトに、Bash 4 以降にしか無い機能（連想配列・mapfile）を確かめずに使った

## 事象

Issue #1125 の `kaizen-effectiveness.sh` で、`/simplify` の効率の観点の指摘に従い、ファイル名での対応づけを連想配列（`declare -A`）と `mapfile` に置き換えた。
PR #1151 の Copilot のレビューが、macOS の標準の Bash 3.2 では `list` と `candidates` が止まると指摘した（high）。
ほかの kaizen のスクリプトはこれらを 1 つも使っておらず、`SKILL.md` の前提も「bash（POSIX 互換シェル）」とだけ書いて Bash 4 を求めていない。
Bash 4 を前提に足すと、規約の定義では破壊的変更（前提の依存の追加）になる。そのため、awk での対応づけに書き直し、レビューの往復を 1 回やり直した。
Bash 3.2 を手元でビルドして確かめようとしたが、権限の判定で止められ、実行では確かめられなかった。

## 根本原因

- なぜ使ったか → 効率の指摘が示した「連想配列にする」をそのまま採り、配布先の bash のバージョンを確かめなかった
- なぜ確かめなかったか → 配布スキルのシェルが対応する bash の最低のバージョンを、どの規約も決めていない。各スキルの前提は「bash（POSIX 互換シェル）」とだけ書く
- なぜ気付けなかったか → 手元と CI の bash は 5 系なので、テストもチェックもすべて通る。Bash 4 の機能を検出するチェックも無い。`skills/git-worktree/scripts/git-worktree-branch-guard.sh` も `mapfile` を使っていて、同じ形が既に残っている

## 根拠

確信度は medium である。原因は 1 つに絞れたが、Bash 3.2 で実行して再現してはいない。
2026-11-26、PR #1151 の Copilot のレビュー（discussion_r4708248460）で指摘された。KEDB 照合（「Bash 3.2」「declare -A」「mapfile」「連想配列」「macOS」）で一致は無かった。

## 既存の規約

- 扱い: なし
- 場所: なし（`.agents/rules/distributed-skill-stack-independence.md` は、前提の節に書いていない必須の依存を直すものに挙げるが、bash のバージョンには触れない）
- 照合した範囲: `AGENTS.md`・`docs/`・`.agents/rules/`・`skills/*/SKILL.md` を「bash 4」「bash 3」「連想配列」「mapfile」「POSIX 互換」で検索した

## 食い違い

- 相手: なし
- 判断: なし

## 提案

配布スキルのシェルスクリプトは Bash 3.2 にある機能だけで書き、連想配列・`mapfile`・`readarray`・`${x,,}`・`${x^^}` を使わない、と `distributed-skill-stack-independence.md` に足す。

- 足す先は `.agents/rules/distributed-skill-stack-independence.md` の「直すもの」である。連想配列は `declare -A` と `local -A` を指す
- 理由も書く。macOS の標準の bash は 3.2 で、手元と CI の bash は 5 系なので、テストが通っても配布先で止まる
- 機構の案は、`skills/*/scripts/**/*.sh` からこれらの字面を探すチェックである。効果は、記録が今回の 1 件と、既にある `git-worktree-branch-guard.sh` の `mapfile` の 1 件である。費用は、コメントと文字列の中を外す分岐が要り、実行時間は小さい。記録が 1 件なので、まず規約の追記で閉じ、再発したらチェックを作る
- `git-worktree-branch-guard.sh` の `mapfile` を直すかは、この学びを適用するときに別に決める
