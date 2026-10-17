---
date: 2026-10-17
type: doc
priority: medium
status: pending
applied-to: []
session: claude-code
---

# git add と git commit のように前の結果に依存する呼び出しは、同じ応答の中で並べて起動せず、前の呼び出しの成功を確かめてから次を起動する

## 事象

Issue #624 の作業で、`git add <paths>` と `git commit -F <msg>` を、同じ応答の中で別々のツールの呼び出しとして並べて起動した。
`git add` は worktree の隔離のチェックに拒否された（パスの `skills/git-worktree` に `git` の語が含まれるため）。
`git commit` はそれを待たずに実行され、前から stage してあった agent-usage の記録だけを、変更の内容を書いた message で commit した。

## 根本原因

- なぜ誤った内容で commit されたか → 並べて起動した呼び出しは互いの結果を待たない。`git commit` は `git add` が失敗したことを知らずに実行された
- なぜ並べたか → AGENTS.md は `git add` と `git commit` を同じ呼び出しに入れないよう求めているが、別の呼び出しにすれば依存が切れると扱い、同じ応答で並べた
- なぜ気づくのが遅れたか → commit の後に `git show --stat` で中身を確かめる前に、成功したと読んだ

## 提案

`git add` と `git commit` のように前の結果に依存する呼び出しは、同じ応答の中で並べて起動せず、前の呼び出しの成功を確かめてから次を起動する。

- 適用先候補: `AGENTS.md`「commit message」の「`git commit` を含む呼び出しに `git add` を入れない」の箇条に、別の呼び出しにしたうえで並べて起動しないことを足す
- commit の後は `git show --stat HEAD` で、意図したファイルだけが入ったかを確かめる
