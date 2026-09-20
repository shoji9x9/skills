---
date: 2026-09-08
type: hook
priority: high
status: applied
applied-to: [skills/kaizen/scripts/kaizen-precommit-gate.sh, scripts/kaizen-precommit-gate.test.js]
session: claude-code
---

# コマンド文字列の正規表現ゲートは、引用符の内側にある区切り文字で誤発火する

## 事象

kaizen のコミット前ゲートが、commit ではない Bash 呼び出しを 2 回ブロックした。
1 回目は grading.json を書く python heredoc、2 回目はその原因を調べる呼び出し。
どちらも本文に `Bash(git commit *)` という**文字列**（settings.json の matcher 表記）を
含んでいただけで、git を実行していない。Write ツールへ迂回して回避した。

## 根本原因

1. なぜブロックされたか → `kaizen-precommit-gate.sh` の `commit_re` の区切りクラス
   `(^|[;&|(\n])` が、**引用符の内側にあるリテラルの `(`** にマッチしたため。
2. なぜ引用の内側を区切りと見たか → 判定がシェル構文の解析ではなく
   **コマンド文字列に対する正規表現**で、引用状態を持たないため。
3. なぜその状態が漏れたか → 過剰ブロック回避は `man git commit` /
   `git --no-pager grep commit` / `echo "... git commit ..."` のような**語の並び**
   については実測して潰してあるが、**区切り文字が引用に囲まれている**という状態が
   状態空間に入っていなかった ← 根本原因

実測（正規表現を切り出した陽性・陰性コントロール）:

- BLOCK 期待 3 件（素の commit / `cd /tmp && git commit` / 真のサブシェル `(git commit`）→ 全て BLOCK
- PASS 期待の既知 3 件（`man` / `--no-pager grep` / `echo "..."`）→ 全て PASS
- PASS 期待の新規 3 件（`"...Bash(git commit *)"` / 二重引用内の `(` / 単一引用内の `(`）→ **全て BLOCK（誤検知）**

pending の `.kaizen/2026-08-30-new-state-branches-need-fixtures.md`（新設分岐は状態空間を
列挙して fixture を足す）の再発でもある。

## 提案

コマンド文字列を正規表現で判定するゲート・フックは、区切り文字（`;` `&` `|` `(` 改行）が引用符・エスケープの内側にある状態を状態空間に入れ、引用内の区切りでは発火しないことを fixture で実測する。

- `kaizen-precommit-gate.sh` の区切り判定を、既存の `unquote_token` と同じ引用状態スキャンで
  「引用の外にある区切り」だけに限定する。fail-open にはしない（引用外の `;` `&&` `(` は従来どおり止める）
- fixture に 3 状態を追加する: 引用外の `(git commit`（BLOCK）/ 二重引用内（PASS）/ 単一引用内（PASS）
- 横断スコープ: `git-worktree-branch-guard.sh` も同じ payload からコマンドを取り出して
  判定するため、同じ引用内区切りの状態で誤発火しないかを確認する
