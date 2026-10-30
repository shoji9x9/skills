---
date: 2026-10-17
type: hook
priority: high
confidence: high
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

2026-10-18、issue-batch の run で、#662 の worktree から #651 の worktree へ移ったときにも同じことが起きた。
transcript は `-issue-662/` から `-issue-651/` の projects のディレクトリに移り、#662 の worktree の処理位置は移す前のパスを指していた。
`kaizen extract --current --record-pending` の手順で走査ツールを呼ぶ前に、処理位置の 1 行目を移した後のパスに書き換えた複製を #651 の worktree に置いて、処理済みの範囲を読み直さないようにした。

2026-10-19、issue-batch の run で、#710 の worktree から #701 の worktree へ戻ったときにも同じことが起きた。
処理位置は #710 の worktree にあり、`-710-kaizen-scan-api-request-blob/` の transcript を指していたので、走査ツールは先頭から読んで 42 件の候補を挙げた。
上の #651 のときと同じく、1 行目を今の transcript のパスに書き換えた複製を #701 の worktree に置くと、候補は 2 件になった。
2026-10-20、BLOCKED になった PR を順に仕上げる作業で、main のチェックアウトから #715 の worktree へ移ったときにも起きた。
main で立ったセンチネルは `-home-shoji9x9-projects-skills/` の transcript を指したままで、チェックは「transcript が実在しない」と案内した。
transcript は `-home-shoji9x9-projects-skills--claude-worktrees-697-defer-decisions-by-impact/` に移っており、処理位置も無いので、走査は先頭から候補を挙げた。
移った後のパスを `find ~/.claude/projects -name '<session id>*'` で探し、そのパスで `kaizen-extract-done.sh` を実行して解消した。
続けて PR #718 の worktree へ移った後も、同じ形で起きる。
PR #722 の worktree へ移った後の最初の commit でも、処理位置が #718 の worktree と一緒に消えていたので、走査は transcript の先頭から 37 件の候補を挙げて止めた。
PR #720 の worktree でも同じく、最初の `git commit` で先頭から 42 件を挙げて止めた（`git merge` の merge commit は、`git commit` の語を含まないのでチェックを通った）。
同じ日のうちに PR #714・#721・#713 の worktree でも同じく止まった。移るたびに起きるので、run で Issue を 1 つ進めるごとに、最初の commit で 1 回止まる。
2026-10-20、issue-batch の run で、main のチェックアウトから #653 の worktree へ、続けて #687 の worktree へ移ったときにも起きた。
処理位置は main のチェックアウトの `.kaizen/` にあり、1 行目が移す前の transcript のパスを指していた。
Issue #653 では、走査ツールに移す前のパスを渡して「transcript が無い」で exit 2 になり、移った後のパスを探して渡し直した。
Issue #687 では、移った後のパスを渡すと、処理位置を使わずに先頭から 37 件を挙げた。処理位置の 1 行目を移った後のパスに書き換えると、28 件になった。
2026-10-30、issue-batch の run で、main のチェックアウトから #766 の worktree へ移った後の最初の `git commit` でも起きた。
処理位置は main のチェックアウトにあり、1 行目は前に使った #818 の worktree の transcript を指していた。
transcript は 57 MB まで大きくなっていて、チェックは先頭から読み直そうとして 8 秒の期限に達し、候補を数えずに「判定できない」として止めた。
移った後の transcript の先頭 53,239,060 バイトが 24,113 行で改行で終わることを確かめてから、1 行目だけを書き換えた複製を走査ツールに渡すと、候補は 9 件になった。
transcript が大きいほど、先頭から読み直す走査は期限に達しやすく、候補の件数ではなく時間切れで止まる。
2026-10-30、issue-batch の run で、#766 の worktree から #801 の worktree へ移った後の 2 回目の `git commit` でも、チェックが 8 秒の期限に達して止めた。
処理位置は main のチェックアウトにあり、1 行目は #766 の worktree の transcript（60 MB）を指していた。1 行目だけを移った後のパスに書き換えた複製を走査ツールに渡すと、候補は 2 件になった。
同じ run で #801 の worktree から #839 の worktree へ移った後の 2 回目の `git commit` でも、チェックが 8 秒の期限に達して止めた。
1 行目は #801 の worktree の transcript（65 MB）を指していた。書き換えた複製を渡すと、候補は 7 件になった。
同じ run で #839 の worktree から #835 の worktree へ移った後の最初の `git commit` でも、同じく 8 秒の期限に達して止めた。
1 行目は #839 の worktree の transcript（67 MB）を指していた。書き換えた複製を渡すと、候補は 6 件になった。

## 根本原因

- なぜ処理済みの候補で止まったか → 走査（`kaizen-candidate-scan.sh`）が、処理位置を使わずに transcript の先頭から読んだ
  - なぜ使わなかったか → 走査は、処理位置の 1 行目（transcript のパス）が今の transcript のパスと文字列として等しいときだけ、バイト位置を使う（30 行目）
    - なぜ一致しなかったか → Claude Code がセッションを移すときに transcript のパスを変える。処理位置の照合は、同じセッションの transcript のパスが変わらないことを前提にしている ← 根本原因

## 根拠

同じ原因の再発が続き、処理位置の 1 行目を書き換えると直ることも確かめたので high とする。
再発のすべてで、処理位置の 1 行目が移す前の transcript を指していた。
Issue #651・#701・#687・#801 では、1 行目だけを移った後のパスに書き換えると候補が減ることを確かめた。
Issue #715 と #653 では、処理位置が無いか、走査ツールに移す前のパスを渡して止まり、移った後のパスを渡して解消した。

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
