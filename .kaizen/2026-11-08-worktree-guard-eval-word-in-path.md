---
date: 2026-11-08
type: doc
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# worktree の隔離中は、eval などのシェルの組み込みの名前を含むパスも、スクリプトのファイルから実行する

## 事象

Issue #933 の作業で worktree に入った後、`scripts/eval` の下を `ls` する呼び出しと、`git ls-files` で `evals/kaizen/...` を挙げる呼び出しが、隔離のガードに拒否された。
拒否の理由は、コマンドが文字列を `eval` に渡しているので worktree の中に留まると確かめられない、というものだった。
どちらの呼び出しも `eval` を実行しておらず、パスの一部に `eval` という語があっただけである。
もう 1 回、`bash <スクリプト> <引数>; echo rc=$?` の複合コマンドが拒否された。
どれも、Write ツールでスクリプトを書いて `bash <絶対パス>` で実行する形に直して通した。

## 根本原因

- なぜ拒否されたか: ガードはコマンドの文字列を見て判定するので、パスの中の `eval` を組み込みの `eval` の呼び出しと同じに扱った。
- なぜその形を書いたか: `git-worktree` の `references/isolation.md`「判定は文字列で決まる」は、本文にバージョン管理のコマンドの名前が現れる場合だけを挙げている。シェルの組み込みの名前（`eval` など）がパスに現れる場合は書かれていない。
- なぜ前の学びで防げなかったか: 前の学びと規約は、`git` の語と複合コマンドを対象にしている。このリポジトリには eval のランナーと fixture の置き場所（`scripts/eval/`・`evals/`）があり、パスに `eval` を含む呼び出しは頻繁に書く。

## 根拠

拒否のメッセージが `eval` を理由に挙げ、同じ語を含むパスで 2 回再現したので、原因を 1 つに絞れた（medium）。

- 観測: worktree に入った後、`scripts/eval` を引数にした `ls` と、`evals/kaizen/fixtures/...` を引数にした `git ls-files` が拒否された。スクリプトに書いて実行すると通った。
- KEDB 照合: `worktree`・`Bash`・`拒否` で照合し、applied の 2 件が一致した。
  `.kaizen/2026-10-14-worktree-bash-literal-guard-recurs.md` と `.kaizen/archive/2026-09-17-worktree-session-rejects-computed-bash.md` である。
  どちらも `git` の語と複合コマンドの拒否で、`eval` の語は扱っていない。applied との一致なので、確信度は上げていない。

## 既存の規約

- 扱い: なし
- 場所: なし（近い規約は `skills/git-worktree/references/isolation.md`「隔離中の Bash は 1 コマンドずつ素の形で書く」。対象は `git` の語・組み立てた引数・複合コマンド・ヒアドキュメントで、シェルの組み込みの名前を含むパスは挙げていない）
- 照合した範囲: `AGENTS.md`・`docs/`・`.agents/rules/`・`skills/git-worktree/`・`skills/issue-start/` を、`1 コマンドずつ素の形`・`判定は文字列で決まる`・`eval` で検索した

## 提案

worktree の隔離中は、`eval` などのシェルの組み込みの名前をパスや引数に含む呼び出しも、Write ツールでスクリプトに書いて `bash <絶対パス>` で実行する。

- 適用先: `skills/git-worktree/references/isolation.md`「判定は文字列で決まる」の段落に、拒否される語の例として、バージョン管理のコマンドの名前に加えてシェルの組み込みの名前（`eval` など）を足す。
- 機構の効果と費用: 誤りの記録は今回だけで、ガード自身が拒否して知らせるので、ほかに気付く手段がある。機構は作らない。
