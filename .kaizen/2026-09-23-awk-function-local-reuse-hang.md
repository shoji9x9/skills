---
date: 2026-09-23
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# awk 関数に処理を足すときは既存のローカル名を使い回さない

## 事象

`scripts/bash-command-guard.sh` の `heredoc_open`（awk 関数）に外側のコマンド置換を記録するループを足した際、
区切り語の終端を持つローカル `j` をループ変数に使い回し、直後の `i = j - 1` で `i` が後退して無限ループになった。
検証を timeout なしで走らせたため 5 分ハングし、PID を指定して殺した。

## 根本原因

- なぜループした? awk の関数内にはブロックスコープが無く、仮引数列で宣言済みの名前を `for` に使うと値が上書きされる
- なぜ気付かなかった? 新しいループを書くときに、関数の仮引数列（ローカル宣言）と後続の参照を読まなかった
- なぜ長引いた? 検証コマンドに timeout を付けていなかった
  （`.kaizen/archive/2026-09-03-blocked-child-process-diagnose-by-stderr.md`（applied）と同根の再発）

## 提案

awk の関数に処理を足すときは新しい変数を仮引数列へ追加して既存のローカル名を使い回さず、シェルゲートを検証するコマンドには必ず timeout を付ける。

- 決定論的な対策: `scripts/bash-command-guard.test.js` の `run` に `spawnSync` の `timeout` を入れ、ハングを失敗として捕まえる
- 適用先候補: `scripts/bash-command-guard.test.js`
