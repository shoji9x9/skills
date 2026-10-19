---
date: 2026-10-19
type: hook
priority: low
status: pending
applied-to: []
session: claude-code
---

# bash-command-guard.sh が、ファイル名に pkill と -f を含む grep の呼び出しを止めた

## 事象

`grep -n applied-to .kaizen/archive/2026-09-11-pkill-f-matches-own-command-line.md` を含む呼び出しを、`scripts/hooks/bash-command-guard.sh` が止めた。
止めた理由は、「pkill/killall -f はこの呼び出し自身にも一致する」だった。
パスを glob（`ls .kaizen/archive/2026-09-11-p*`）で取る形に変えて通した。

## 根本原因

- なぜ止めたか: 検査は、引用の外のコード部分に `*pkill*` と `*-f*` が部分文字列として両方あるかを見る。
  ファイル名の `pkill-f-matches` が両方に当たった
- なぜ区別できないか: コマンドの語（`pkill` が実行するコマンドの位置にあるか）と、オプションの語（`-f` が独立した引数か）を、トークンの単位で見ていない

## 提案

`bash-command-guard.sh` の pkill / killall の検査を、トークンの単位で判定する形に変える。

- `pkill` か `killall` がコマンドの位置にあり、`-f` か `-f` を含む短いオプション（`-af` など）が独立した引数にあるときだけ止める
- 誤検知しないことの確認として、引数のパスに `pkill-f` を含む `grep` と `cat` を、テストに通すケースとして足す
