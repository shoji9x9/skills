---
date: 2026-10-17
type: hook
priority: medium
status: pending
applied-to: []
session: claude-code
---

# セッションが別の worktree に移ると、kaizen の処理位置が引き継がれず、処理済みの候補でコミットが止まる

## 事象

issue-batch の run で、#632 の worktree（`.claude/worktrees/632`）から #633 の worktree（`.claude/worktrees/633`）へ、EnterWorktree でセッションを移した。
その後の #633 の最初のコミットで、kaizen のコミット前の確認が 59 件の候補を挙げて止めた。挙げた行は transcript の 179 行目からで、#632 の作業中に抽出を済ませた範囲である。

調べると、次の 2 つが重なっていた。

- Claude Code は、セッションを移すと transcript を移した先の projects のディレクトリに移す（`-home-shoji9x9-projects-skills--claude-worktrees-632/` から `-633/` へ）。#632 の worktree に残ったセンチネルは、移す前のパスを指したままで、チェックは「transcript が実在しない」と案内した
- 処理位置 `.kaizen/.extract-checkpoint.<session>` は、worktree ごとの `.kaizen/` に置かれる。#632 の worktree にだけあり、#633 の worktree には無いので、チェックは transcript を最初から走査した

## 根本原因

- なぜ処理済みの候補で止まったか → #633 の worktree に、その transcript の処理位置が無かった
  - なぜ無かったか → 処理位置はセッションの id を名前に持つが、置き場所は抽出した worktree の `.kaizen/` で、他の worktree からは読まない
    - なぜ他の worktree から読まないか → 処理位置の設計が、1 つのセッションが 1 つの作業ツリーにとどまることを前提にしている。transcript のパスが変わることも想定していない ← 根本原因
- `kaizen-extract-done.sh` はすべての作業ツリーの `.kaizen/` を対象にセンチネルを消すが、処理位置の読み書きは同じようには扱っていない

## 提案

kaizen のコミット前の確認は、処理位置をセッションの id で探し、今の作業ツリーに無ければ、同じリポジトリの他の作業ツリーの `.kaizen/` からも読む。transcript のパスが違っても、同じセッションの id の処理位置は、行数とバイト位置が今の transcript の範囲に収まるなら使う。

- 適用先: `skills/kaizen/scripts/` のコミット前の確認と走査（`kaizen-precommit-gate.sh`・`kaizen-candidate-scan.sh`）、`kaizen-extract-done.sh`
- 処理位置を git の共通のディレクトリ（`git rev-parse --git-common-dir`）に置く案もある。worktree で共有でき、移っても失われない
- 確かめる状態: セッションが worktree A で抽出した後に worktree B へ移り、B で最初にコミットする。B のチェックが、A で処理した範囲を候補に数えないこと
