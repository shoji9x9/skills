---
date: 2026-10-14
type: hook
priority: high
status: pending
applied-to: []
session: claude-code
---

# worktree の隔離セッションで、本文に git の語を含む Bash 呼び出しの拒否が、適用済みの学びの後も再発した

## 事象

issue-batch の #631 の作業で、worktree に入った後の Bash 呼び出しが 6 回拒否された（`this command names git in a form too complex to verify`）。
拒否された形は次のとおりである。

- python の quoted heredoc の本文に `git(...)` や `GitHub` を含むもの
- `-t 'GitHub'` の引数や、`r.githubSkipped` を grep する引数
- `.agents/skills/git-worktree/...` のパスを含む複合コマンド
- `; git status --short` を末尾に付けた複合コマンド

どれも Write ツールでスクリプトを書いて `bash <絶対パス>` で実行する形に直して通した。

記録した後も、同じセッションで 9 回以上再発した。
例は、`kaizen-kedb-match.sh` に `"gh issue develop"` を渡した呼び出し（変数名 `githubTarget_` を置換する sed、`gh --jq` の `\(.number)` を含む式、`github.mjs` のパスを含む複合コマンドなど）。
記録が文脈にあっても、複合コマンドを書く時点では参照されなかった。

この制約は `.kaizen/archive/2026-09-17-worktree-session-rejects-computed-bash.md` で記録し、`skills/git-worktree/references/isolation.md` に適用済みである。

2026-10-15、#616 の作業（issue-start から git-worktree enter）で、worktree に入った後の Bash の呼び出しが 6 回拒否された。
`this command names git in a form too complex to verify` が 5 回、`this command is too complex to verify` が 1 回である。
拒否された形は次のとおりである。

- `for` ループと `cp`・`mise trust`・`pnpm install` をつないだ準備の処理
- `git rev-list` と `git log` を `;` でつないだ処理
- `curl -o` と `||` を含む処理
- run の結果を確かめる `node -e` と、関数の定義を含む処理

どれも、単独の呼び出しに分けるか、Write ツールでスクリプトにして `bash <絶対パス>` で実行する形に直して通した。
この学びは、セッション開始時に pending として注入されていたが、最初の拒否が起きるまで書き方は変わらなかった。
注入した要約の 1 行だけでは、コマンドを書く時点の行動を変えられない。優先度を上げる根拠はこの再発であり、文書より先に決定論的な対策（PreToolUse の Hook）を適用する。

2026-10-16、#655 の作業（issue-start から git-worktree enter）で、worktree に入った後の Bash の呼び出しが 4 回拒否された。
拒否された形は次のとおりである。

- `git rev-parse`・`cp`・`mise trust`・`pnpm install`・`git log` を `;` でつないだ準備の処理（`names git in a form too complex to verify`）
- handlebars を `pnpm update` で上げ、`pnpm audit` の結果を確かめる処理。変数を引数に使う `node` と `&&` を含む（`runs node with a value computed at runtime`）
- `bash <絶対パス>/kaizen-kedb-match.sh "worktree" "git" "Write"; echo rc=$?; cat <ファイル>`（`names git in a form too complex to verify`）
- `bash <絶対パス>/kaizen-kedb-match.sh "worktree" "heredoc"; echo rc=$?`（`runs bash inside a construct too complex to verify`）

どれも、単独の呼び出しに分けるか、Write ツールでスクリプトにして `bash <絶対パス>` で実行する形に直して通した。
この学びはセッション開始時に注入されていたが、最初の 2 回は書き方を変えなかった。
2 回目の後、handlebars を上げて確かめる処理はスクリプトに直した。それでも、後の kaizen の照合では、同じ形の複合コマンドを再び書いて 2 回拒否された。
これで、#631・#616・#655 の 3 つのセッションで、worktree に入った後の複合コマンドが拒否されている。
文書の注入では書き方が変わらないことの裏付けであり、「## 提案」の PreToolUse の Hook を先に適用する根拠を強める。
ただし、今回の 4 回のうち、提案の Hook の条件（heredoc か `;`・`&&` と、`git` の語の両方）に当たるのは 1 回目と 3 回目だけである。
2 回目は `git` の語を含まず、4 回目は `bash` の起動を理由に拒否された。
Hook の条件は、`;`・`&&` と `node` や `bash` の起動の組まで広げる（「## 提案」に追記した）。広げた条件で、4 回とも拾える。

## 根本原因

1. なぜ拒否されたか → 隔離セッションのガードは字面で判定し、本文・引数・パスに `git` を含む複合コマンドや heredoc を拒否する。
   `git` の語を含まなくても、実行時に決まる値を引数にした `node` や、複合コマンドの中の `bash` の起動は、git を実行しないことを示せないとして拒否する（#655 の 2 回目と 4 回目）。
2. なぜ同じ形を書いたか → 適用先の `isolation.md` は worktree に入る時点で読む文書で、コマンドを書く時点（実装・検証の途中）には参照されない。
3. なぜ参照されないか → issue-batch・issue-start の実装の手順に、worktree の中では検証や編集のスクリプトを最初から Write ツールでファイルにする、という書き方の取り決めが無く、文書の 1 か所に頼っている ← 根本原因

## 提案

worktree の隔離セッションでは、heredoc・複合コマンド・`git` の語を含む処理を、最初から Write ツールでスクリプトにして絶対パスで実行し、git の操作は単独の呼び出しにする。

- 反映先の候補: `issue-batch` の `references/orchestration.md`「issue-start への handoff」と `issue-start` の worktree の項に、この書き方を 1 行で置く。
  原本は `git-worktree` の `isolation.md` のまま参照する。
- 決定論的な対策の候補: PreToolUse の Hook で、worktree のセッションの Bash の本文に heredoc か `;`・`&&` と `git` の語が両方あれば、実行前に「スクリプトファイルにする」と案内する（ハーネスの拒否より先に、直し方を示す）。
  #655 の拒否から、条件には、`;`・`&&` と `node` や `bash` の起動の組も含める（引数が変数かどうかは問わない）。
  4 回目の `bash <スクリプト> <引数>; echo rc=$?` は `git` の語を含まないので、起動の組で拾う。`echo` の引数の `$?` は実行時に決まる値なので、拒否の理由にこの展開が関わっている可能性もある。
- KEDB 照合: `worktree`・`Bash`・`拒否` で `.kaizen/archive/2026-09-17-worktree-session-rejects-computed-bash.md`（applied）に一致。applied なので追記せず、この記録を新しく作った。

### apply のときに確かめること

PR #656 のレビューで出た指摘である。上の Hook の条件の細部は、apply の時点で次のことを確かめてから決める。

- 区切りを `;`・`&&` だけにすると、#616 の `curl -o` と `||` を含む拒否や、`for` ループ・パイプ・改行でつないだ形を拾えない。#631・#616・#655 のすべての拒否に条件を当てる。
- `;`・`&&` と `node`・`bash` の起動の組は、ハーネスが通す正当な複合コマンド（定数の引数だけの `pnpm exec vitest run a.test.ts && node scripts/x.ts` など）にも当たる。ハーネスの拒否の理由（`computed at runtime`・`inside a construct too complex`）に対応する形に絞り、誤検知しないことを確かめる例を挙げる。
- 新しい Hook を書かず、Bash の呼び出しをセグメントに分けて判定する既存の PreToolUse の Hook（`scripts/hooks/bash-command-guard.sh`）に足せるかを先に確かめる。
