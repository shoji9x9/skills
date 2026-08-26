---
date: 2026-08-27
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 手順として書いたコマンド列は、通しで 1 回実走して各コマンドの実際の出力を確かめる

## 事象

Issue #223 で新規スキル `git-worktree` を作成した。reference に書く**外部ツールの挙動の主張**は
徹底的に実測した（symlink 越しの `sed -i` / `rm -rf name/` の破壊、`.worktreeinclude` の運搬が
新規作成時だけ走ること、`EnterWorktree` の name/path 契約を実装バイナリと公式ドキュメントの両方で確認）。

一方で **SKILL.md に書いた手順そのものは 1 度も実行しなかった**。`/code-review --fix` が 7 件を検出し、
うち 4 件が high。そのうち 3 件は**手順のコマンドを 1 回実行すれば判明する**ものだった。

- `enter` 手順 2「同じ branch を checkout 済みの worktree が既にないか `git worktree list --porcelain` で確認し、
  あれば再利用する」——**一覧の先頭は常にメインチェックアウト**なので、`gh issue develop --checkout` 直後の
  最も普通の経路で共有ツリーを「既存 worktree」として再利用し、隔離していないのに隔離したと報告する。
  さらに `git worktree add <パス> <branch>` は `fatal: '<branch>' is already used by worktree at ...`（exit 128）で失敗する。
- `cleanup` 手順に「解除前にセッションを出る」段が無い。`git worktree remove` は**自分の cwd を含む worktree でも
  成功し**（実測: exit 0）、以後のコマンドが `getcwd: cannot access parent directories` で失敗する。
- `cleanup` 手順 5 の `git branch -d`（`-D` 禁止）——squash merge 後は `not fully merged` で必ず拒否され、
  `git branch --merged` にも現れない。姉妹スキルの既定 merge 方法が squash なので、**全ての cleanup が必ず BLOCKED になる**。

## 根本原因

- なぜ残ったか? → SKILL.md の手順に書いた git コマンドを一度も実行しなかった。
  - なぜ? → 検証努力を「reference に書く**主張**（この操作はこう振る舞う）」に全振りし、
    SKILL.md の手順は主張ではなく**指示**なので検証対象と見なさなかった。
    - なぜ? → 既存の検証規律が対象語を「主張」「分岐」に取っている。
      `.agents/rules/external-tool-format-verification.md` は「**分岐**を書いたらその分岐が成立する状態で実測する」、
      [[2026-08-10-verify-branches-you-add]] は「修正で**新設した分岐**・受理する入力クラス」。
      どちらも**手順（一連のコマンド列）を通しで実走する**ことを名指ししていない。
      手順は分岐を持たない直線でも壊れる（前段の出力が後段の前提を満たさない）ため、
      分岐を軸にした列挙では拾えない。← 根本原因（対策可能）

横断スコープ: 手順を書く配布スキル全般（`skills/**`）。`issue-start` / `issue-batch` / `pr-*` /
`parity-*` はいずれも「列挙 → 判定 → 破壊的操作」の直線手順を持ち、同じ形の欠陥を持ちうる。
`paths: skills/**` で絞れるため rule に置く。

KEDB 照合: [[2026-08-10-verify-branches-you-add]]（pending）は**自作コードで新設した分岐**が対象で、
軸が「分岐」。本件は分岐の無い直線手順で起きたため、同じノートへの追記ではなく別軸として記録する。
[[2026-07-29-verify-the-branch-you-document]]（applied）も外部コマンドの分岐に閉じる。

## 提案

`.agents/rules/external-tool-format-verification.md`（`paths: skills/**`）に次を追加する。

- **手順として書いたコマンド列は、通しで 1 回実走して各コマンドの実際の出力を確かめる。**
  分岐が無い直線の手順でも、前段の出力が後段の前提を満たさずに壊れる
  （例: `git worktree list --porcelain` の**先頭は常にメインチェックアウト**なので、
  「一覧から既存 worktree を選んで再利用する」手順は共有ツリーを選ぶ）。
  検証の単位を「その主張は正しいか」ではなく「**この手順を上から順に実行したら何が起きるか**」に取る。
  実走できない環境では、各コマンドを単体で最も普通の前提状態に対して実行し、
  **出力の先頭行・終了コード・空になる条件**を確かめる。
- **破壊的操作を含む手順は、その操作を実行した直後に自分の実行環境が壊れないかまで確かめる。**
  （例: `git worktree remove` は自分の cwd を含む worktree でも成功し、以後のコマンドが `getcwd` で失敗する。）
- **「安全側の既定」として選んだフラグは、既定の運用でそれが成立するかを確かめる。**
  （例: `git branch -d`（`-D` 禁止）は安全に見えるが、squash merge 運用では必ず拒否されデッドロックする。）
