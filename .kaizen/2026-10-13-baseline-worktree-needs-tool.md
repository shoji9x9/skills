---
date: 2026-10-13
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 旧版と現行版を比べる使い捨ての worktree を、手で組み立てて失敗した（適用済みの学びの再発）

## 事象

追加した回帰テストが旧版で落ちることを確かめるため、scratchpad に worktree を作って旧版で実行した。
1 回目は同名のディレクトリがあって `git worktree add` が失敗し、後続が別の古いログを表示した。
2 回目は `mise trust` をせずに vitest を起動して mise のエラーになった。
3 回目は node_modules を symlink して、pnpm が `ERR_PNPM_UNSAFE_MODULES_DIR` で拒否した。
4 回目（trust と install）でようやく測れた。
適用済みの `2026-09-23-adhoc-worktree-skips-mise-trust.md` の再発である。

## 根本原因

- なぜ失敗したか: 使い捨ての worktree を毎回手で組み立て、前提（空のパス・mise trust・実体の node_modules）を 1 つずつ踏んだ
- なぜ前提を忘れたか: `AGENTS.md` に mise trust の 1 行はあるが、手順が文章でしかなく、実行する時点で参照されない
- なぜ手で組み立てたか: 「旧版と現行版を同じ条件で測る」を求めるのに、旧版の作業ツリーを用意するツールが無い

## 提案

旧版と現行版を比べる使い捨ての作業ツリーは、手で組み立てず、worktree の作成・mise trust・依存の導入・後片付けを 1 つにまとめたツールで用意する。

- `scripts/tools/` に、ref を受け取って空のパスに worktree を作り、mise trust と pnpm install を済ませてパスを返すスクリプトを足す（`mutation-proof-shards.sh` の worktree の扱いを流用できるかも見る）
- `docs/agent-workflow.md`「回帰だという指摘は、旧版と現行版を同じ条件で確かめる」からそのツールを案内する
