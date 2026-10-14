---
date: 2026-10-14
type: skill
priority: medium
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

この制約は `.kaizen/archive/2026-09-17-worktree-session-rejects-computed-bash.md` で記録し、`skills/git-worktree/references/isolation.md` に適用済みである。

## 根本原因

1. なぜ拒否されたか → 隔離セッションのガードは字面で判定し、本文・引数・パスに `git` を含む複合コマンドや heredoc を拒否する。
2. なぜ同じ形を書いたか → 適用先の `isolation.md` は worktree に入る時点で読む文書で、コマンドを書く時点（実装・検証の途中）には参照されない。
3. なぜ参照されないか → issue-batch・issue-start の実装の手順に、worktree の中では検証や編集のスクリプトを最初から Write ツールでファイルにする、という書き方の取り決めが無く、文書の 1 か所に頼っている ← 根本原因

## 提案

worktree の隔離セッションでは、heredoc・複合コマンド・`git` の語を含む処理を、最初から Write ツールでスクリプトにして絶対パスで実行し、git の操作は単独の呼び出しにする。

- 反映先の候補: `issue-batch` の `references/orchestration.md`「issue-start への handoff」と `issue-start` の worktree の項に、この書き方を 1 行で置く。
  原本は `git-worktree` の `isolation.md` のまま参照する。
- 決定論的な対策の候補: PreToolUse の Hook で、worktree のセッションの Bash の本文に heredoc か `;`・`&&` と `git` の語が両方あれば、実行前に「スクリプトファイルにする」と案内する（ハーネスの拒否より先に、直し方を示す）。
- KEDB 照合: `worktree`・`Bash`・`拒否` で `.kaizen/archive/2026-09-17-worktree-session-rejects-computed-bash.md`（applied）に一致。applied なので追記せず、この記録を新しく作った。
