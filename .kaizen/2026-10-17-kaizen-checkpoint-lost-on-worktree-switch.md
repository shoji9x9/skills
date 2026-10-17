---
date: 2026-10-17
type: hook
priority: medium
status: pending
applied-to: []
session: claude-code
---

# セッションが別の worktree に移ると transcript のパスが変わり、kaizen の走査が処理位置を使わずに処理済みの候補でコミットを止める

## 事象

issue-batch の run で、#632 の worktree（`.claude/worktrees/632`）から #633 の worktree（`.claude/worktrees/633`）へ、EnterWorktree でセッションを移した。
その後の #633 の最初のコミットで、kaizen のコミット前の確認が 59 件の候補を挙げて止めた。挙げた行は transcript の 179 行目からで、#632 の作業中に抽出を済ませた範囲である。

調べると、次の 2 つが重なっていた。

- Claude Code は、セッションを移すと transcript を移した先の projects のディレクトリに移す（`-home-shoji9x9-projects-skills--claude-worktrees-632/` から `-633/` へ）。#632 の worktree に残ったセンチネルは、移す前のパスを指したままで、チェックは「transcript が実在しない」と案内した
- 処理位置 `.kaizen/.extract-checkpoint.<session>` は #632 の worktree にあり、1 行目に移す前の transcript のパスを持っていた

初めは、処理位置を他の worktree から読まないことが原因だと考えて記録した。PR #666 のレビューで誤りと分かった。
`kaizen-precommit-gate.sh` は、今の作業ツリーに処理位置が無ければ、`kaizen_find_control_file` で全作業ツリーから探す。`kaizen-extract-done.sh` も、書き込み先を同じ関数で決める。

## 根本原因

- なぜ処理済みの候補で止まったか → 走査（`kaizen-candidate-scan.sh`）が、処理位置を使わずに transcript の先頭から読んだ
  - なぜ使わなかったか → 走査は、処理位置の 1 行目（transcript のパス）が今の transcript のパスと文字列として等しいときだけ、バイト位置を使う（30 行目）
    - なぜ一致しなかったか → Claude Code がセッションを移すときに transcript のパスを変える。処理位置の照合は、同じセッションの transcript のパスが変わらないことを前提にしている ← 根本原因

## 提案

kaizen のコミット前の確認は、セッションが worktree を移っても処理位置を引き継げるようにする（処理位置を移った後も残る場所に置き、key で見つけた処理位置だけは transcript のパスの違いを許す）。

- 適用先: `skills/kaizen/scripts/kaizen-candidate-scan.sh` の処理位置の照合（30 行目）。
  session 単位の処理位置は、`kaizen-precommit-gate.sh` が今のセッションの key（`kaizen_session_key` が session id から作る）の名前で探すので、見つかった時点で同じセッションのものである。
  ただし、走査ツールのパスの比較は残す。`references/extract.md` の手順は処理位置のパスを手で組み立てて走査ツールを呼ぶので、その比較が、別の transcript の処理位置を弾く唯一の確認になっている。
  key で処理位置を見つけた gate の呼び出しだけが、引数でパスの違いを許し、走査ツールはバイト位置と行数が今の transcript の範囲に収まるかで判定する。
  名前に key を持たない旧形式の `.extract-checkpoint` には、パスの違いを許さない
- 使ってよいかの確かめ: 移した後の transcript の先頭から記録したバイト位置までが、移す前と同じ内容かを確かめる方法を決める（バイト位置の直前の行の内容を処理位置に記録しておく、など）
- 確かめる状態: セッションが worktree A で抽出した後に worktree B へ移り、B で最初にコミットする。B のチェックが、A で処理した範囲を候補に数えないこと。別のセッションの処理位置を誤って使わないこと
- A を解除した後も確かめる。処理位置は `.gitignore` の対象なので、`git worktree remove` が A と一緒に消す。
  issue-batch は Issue ごとに worktree を片付けるので、この場合も起きる。パスの違いを許すだけでは直らないので、処理位置を git の共通のディレクトリに置くか、解除する前に移す方法を合わせて決める
