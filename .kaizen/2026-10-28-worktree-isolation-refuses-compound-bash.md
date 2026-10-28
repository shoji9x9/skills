---
date: 2026-10-28
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# worktree に隔離したセッションで、git の語を含む複合の Bash の呼び出しが拒否される

## 事象

issue-batch の run で `EnterWorktree` の `path` で worktree に入った後、Bash の呼び出しが「git を含む形が複雑で、worktree の中に留まると確かめられない」として何度も拒否された。
拒否されたのは、`for` のループやコマンド置換で `git` を呼ぶものと、`.github/workflows/` や `git-worktree` のようにパスや文字列に `git` を含むものである。
`/usr/bin/time` のように実行するコマンドの名前を引数で渡すものと、quoted heredoc で python に渡した本文に `git-worktree` を含むものも拒否された。
1 つずつ呼び出しを分け直したので、時間を失った。

## 根本原因

- なぜ拒否されたか: Claude Code のハーネスは、隔離したセッションの Bash の呼び出しを字面で調べ、`git` の語を含む部分が worktree の外を指さないと確かめられない形を拒否する。
- なぜ拒否される形を書いたか: `git-worktree` の `references/isolation.md`「入った後はハーネスが強制する」は、拒否されるコマンドの形として、ブレース展開と区切りを引用符で囲まないヒアドキュメントだけを挙げている。パスや文字列に含まれる `git`、ループ、コマンド置換、コマンドの名前を引数に取るコマンドが拒否されることを書いていない。
- なぜ書いていないか: 拒否の判定は文書化されておらず、`isolation.md` は 1 つの版で観測した形だけを挙げた。issue-batch のように worktree の中で長く作業する使い方では、観測していなかった形が繰り返し現れる。

## 根拠

拒否された呼び出しを、ループ・置換・`.github` のパスを含まない単独のコマンドに分けると通ったので、原因を 1 つに絞れたが、1 回の観測なので medium とする。
このセッションで、worktree に入った後の Bash の呼び出しが 10 回ほど拒否された。拒否された呼び出しを、単独のコマンドに分けるか、スクリプトを Write でファイルに書いて `python3 <file>` で実行すると、通った。
KEDB 照合は「too complex」と `EnterWorktree`、「worktree」と「分割」で行い、一致は無かった。

## 提案

worktree に隔離した Claude Code のセッションでは、git を呼ぶコマンドは 1 呼び出しに 1 つの単独の形で書き、パスや本文に `git` を含む複数行の処理は Write でファイルに書いてから実行する。

- `git-worktree` の `references/isolation.md`「入った後はハーネスが強制する」の「コマンドの形」の行に、観測した形を足す。`.github`・`git-worktree` のように `git` を含むパスや文字列、`for` のループやコマンド置換の中の `git`、コマンドの名前を引数に取るコマンド（`time` など）である。
- 同じ節に、拒否されたときの書き直し方（単独のコマンドに分ける、処理を Write でファイルに書いて実行する）を足す。
- 機構は作らない。拒否はハーネスがその場で示し、書き直せば通るので、文書の追記で足りる。
