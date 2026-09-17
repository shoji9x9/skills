---
date: 2026-09-17
type: skill
priority: medium
status: pending
applied-to: []
session: claude-code
---

# worktree 隔離セッションでは、プログラム名・引数を実行時に組み立てる Bash 呼び出しが拒否される

## 事象

worktree へ移動したセッションで、次の 3 つの Bash 呼び出しが実行前に拒否された。

- heredoc でファイルを書いて `wc -l` まで繋げた複合コマンド
- `S=<dir>` を定義して `node $S/swap-block.mjs ...` と引数を変数で組み立てた呼び出し
- `for c in with_skill without_skill; do ... node -e ... done` のループ

いずれも「git 操作が worktree の外を向いていないことを静的に確認できない」という理由で
実行されずに戻り、絶対パスの素のコマンドへ書き直す・Write ツールへ迂回して通した（3 回の手戻り）。

## 根本原因

1. なぜ拒否されたか → 隔離セッションのガードは、その呼び出しが自分の worktree 内だけを
   触ると静的に確認できない形（変数展開・複合コマンド・ループ）を実行前に拒否する。
2. なぜその形で書いたか → `AGENTS.md` の検証規律（パイプでの成否判定・heredoc で
   インタプリタへ渡す等）に沿うと複合コマンドを書く動機が強く、隔離側の制約と衝突する。
3. なぜ事前に避けられなかったか → この制約が、隔離の前提を集約する `git-worktree` スキルにも
   基底ドキュメントにも書かれておらず、拒否されてから知る経路しかない ← 根本原因

## 提案

worktree 隔離セッションでは Bash 呼び出しを 1 コマンドずつ絶対パスの素の形で書き、プログラム名と引数を変数・複合コマンド・ループで組み立てない（組み立てが必要な処理はスクリプトファイルへ書いてから絶対パスで実行する）。

- 反映先: `skills/git-worktree/references/isolation.md` の「破ってはいけない前提」に 1 項目追加する
- 呼び出し側（`issue-start` / `issue-batch`）へは複製しない（`isolation.md` を正本にする）
- 横断スコープ: 同じ制約は worktree を使う全フロー（`issue-batch` の連続処理・レビュー系）に効くので、
  検証コマンドを書く規律の側（基底ドキュメントの「パイプ越しの成否判定」等）にも隔離セッションでの
  書き方の但し書きが要るか、次の適用時に判断する
- KEDB 照合: 既存の近い記録は `2026-09-08-quoted-separator-must-not-trigger-command-gate.md`
  （kaizen ゲートの正規表現の誤発火）で別事象。cd 非永続系（`2026-08-23-bash-cwd-persists-between-calls.md`）とも別
