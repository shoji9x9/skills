---
date: 2026-10-30
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# eval の fixture に置いた .gitignore が、同じ fixture のファイルを git add から外す

## 事象

Issue #705 で pr-finalize-loop#17 の fixture に `.gitignore`（`*.local.jsonc`）と `common.local.jsonc` を置き、`git add evals/pr-finalize-loop` で stage した。
fixture の `.gitignore` はこのリポジトリ自身にも当たるので、`common.local.jsonc` だけが警告なしに stage から外れた。
`git status` で気付き、`git add -f` で足した。

## 根本原因

- なぜ外れたか: git は下位のディレクトリの `.gitignore` も読む。fixture は下流のリポジトリを真似るので、下流で ignore されるファイルをそのまま置くことになる。
- なぜ気付きにくいか: ハーネスは作業ツリーから fixture をコピーするので、手元の eval は通る。別の clone や worktree だけでファイルが欠ける。
- なぜ防げなかったか: fixture のファイルがすべて追跡されているかを確かめる手順もチェックも無い。

## 根拠

1 回の観測。`git check-ignore -v` が fixture の `.gitignore` を示した。
KEDB 照合は「gitignore」「fixture」と「ignore」「git add」で行い、一致は無かった。

## 提案

fixture に `.gitignore` を置いたら、`git ls-files --others --ignored --exclude-standard evals/` が空であることを確かめ、ignore されるファイルは `git add -f` で追跡する。

- 適用先候補: `docs/skill-development.md` の fixture の説明に 1 文足す
- 機構は作らない。fixture の `.gitignore` は 1 件だけで、観測も 1 回である
