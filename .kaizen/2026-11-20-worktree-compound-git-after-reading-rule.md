---
date: 2026-11-20
type: hook
priority: high
confidence: high
status: pending
applied-to: []
recurrence-of: [2026-10-14-worktree-bash-literal-guard-recurs.md, 2026-09-17-worktree-session-rejects-computed-bash.md]
session: claude-code
---

# worktree の隔離セッションで、書き方の取り決めを読んだ後も git を含む複合コマンドを書き、拒否が再発した

## 事象

Issue #1096 で worktree に入った後、2 回、git を含む Bash の呼び出しをハーネスに拒否された。
1 回目は、`git log` を含む `for` ループで、学びの status が変わった日を数える呼び出しである。
2 回目は、`git diff`・`git rev-parse` を含む、受け入れ条件の検査の呼び出しである。
どちらも、Write ツールでスクリプトにして実行し直して通った。
`issue-start` の基本フローの step 7 にある「最初からその形で書く」は、worktree に入るときに読んでいた。

3 回目は、この学びを記録した直後に起きた。PR #1102 の Copilot の指摘を直すため、置換の本文に `git` の語を含む python の heredoc を書き、拒否された。
Edit ツールで 1 か所ずつ直して通った。

## 根本原因

- なぜ拒否されたか: 隔離セッションのガードは、worktree の外に出ないことを示せない git の複合コマンドを拒否する。
- なぜ同じ形を書いたか: 取り決めは worktree に入る手順の中にあり、コマンドを書く時点（調査・検証の途中）では、文脈に残っていても当てられなかった。
- なぜ当てられないか: 文章の取り決めは、書く時点に何も知らせない。適用済みの学び（`2026-10-14-worktree-bash-literal-guard-recurs.md`）の apply の判断は、「再発が続くなら、ハーネスの側で閉じる方法を探す」だった。

## 根拠

2 回とも、ハーネスの拒否の文（「names git in a form too complex to verify that it stays inside the worktree」）で確かめた。
KEDB 照合（「worktree」「Bash」「拒否」）で、applied の学び 2 件に一致した。根本原因を読み比べ、同じ原因（書き方の取り決めがコマンドを書く時点で当たらない）だと確かめた。
applied の学びとの一致は確信度を上げる根拠にしないので、記録した時点では、このセッションの観測で原因を 1 つに絞れたことから medium にした。
3 回目は、この学びを書いて文脈に持っている状態で、同じ原因で起きた。KEDB 照合でこの学び（pending・確信度 medium）に一致したので、確信度を high に上げた。
文脈にある文章の取り決めでは、コマンドを書く時点の誤りを防げないことの証拠である。

## 既存の規約

- 扱い: 強制なし
- 場所: `git-worktree` の `references/isolation.md`「隔離中の Bash は 1 コマンドずつ素の形で書く」と、`issue-start` の基本フローの step 7

## 提案

worktree の隔離セッションで、文章の取り決めを読んだ後も複合の git コマンドの拒否が再発するなら、文章を足さず、拒否された時点でスクリプトにするよう案内する仕組み（Hook かハーネスの設定）を検討する。

- 効果: 同じ原因の再発の記録が 3 回目になる。拒否は実行の前に起きるので害は小さいが、呼び出しを書き直す往復が毎回 1 回増える。
- 費用: 拒否される形を呼び出し側で列挙すると尽きない（適用済みの学びの apply の判断）。拒否の文を受けて案内するだけなら、形の列挙は要らない。
