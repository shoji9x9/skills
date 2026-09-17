---
date: 2026-09-17
type: skill
priority: high
status: pending
applied-to: []
session: claude-code
---

# worktree へ node_modules をリンクで運ぶと pnpm が全拒否し、mise は未 trust で落ちる

## 事象

`git-worktree enter` で入った worktree で、検証ツールが 2 段階で全滅した。

1. `node -e` が `mise ERROR ... are not trusted` で落ちた（新しい worktree パスの `mise.toml` が未 trust）
2. `pnpm exec oxfmt` が `ERR_PNPM_UNSAFE_MODULES_DIR: Refusing to remove the modules directory ... because its resolved target is not a strict subdirectory of the project root` で落ち、
   pnpm 経由の lint / format / test が 1 つも回せなかった（pnpm 11.23.0）

2 は共有ツリーの `node_modules` へシンボリックリンクを張ったため。リンクを外して worktree 内で
`pnpm install --frozen-lockfile` して解消した（3.4 秒）。

## 根本原因

- なぜリンクを張ったか: `git-worktree` の `references/carry-in.md` が `worktree.symlinkDirectories` の例として
  `node_modules` を挙げ、「再生成できるものはリンクしてよい」と明記しているから
- なぜそう書いてあるか: その節の観点が「リンク越しの書き込み事故」だけで、
  **パッケージマネージャ自身が symlink を拒否する**軸が無いから ← 根本原因
- なぜ mise で落ちたか: `enter` の手順が「運搬」までしか見ておらず、信頼・承認がパス単位のツール（mise の trust）を扱っていない

## 横断スコープ

このリポジトリの `.claude/settings.json` に `worktree.symlinkDirectories` は無く `.worktreeinclude` も無い（実測）ので、
罠は配布先のドキュメント側にある。pnpm を使う下流プロジェクトが設定例を写すと同じ障害になる。

## 提案

`git-worktree` の `references/carry-in.md` と `enter` の手順を直す。

- `node_modules` を `symlinkDirectories` の例から外し、**pnpm / npm の `node_modules` はリンクで運ばず worktree 内で install する**と書く
  （pnpm は project root 外を指す `node_modules` を拒否し、`pnpm exec` 経由の全ツールが落ちる）
- `enter` の後に「パスで信頼を判定するツール（mise 等）の trust を通す」を足す
- 両方とも「入った直後に検証コマンドを 1 つ回してツールチェーンの生存を実測する」という確認手順で締める
