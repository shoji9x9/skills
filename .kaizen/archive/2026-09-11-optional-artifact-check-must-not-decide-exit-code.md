---
date: 2026-09-11
type: doc
priority: low
status: applied
applied-to:
  - AGENTS.md
session: claude-code
---

# 存在が構成で変わる成果物の確認を終了コードの決定位置に置かない

## 事象

eval run の結果確認で末尾に置いた `contamination.txt` の `cat` が非 0 を返し、run 自体は `rc=0` で成功していたのにツールエラーとして記録された。`contamination.txt` は `without_skill` だけが書く成果物で、`with_skill` 側には存在しない。

## 根本原因

1. なぜツールエラーになったか → 末尾コマンドの非 0 がそのまま呼び出し全体の終了コードになった。
2. なぜ末尾に置いたか → 「存在するか未確認のファイルを読む確認」を終了コードを決める位置に置いた。
3. なぜ未確認のまま書いたか → 成果物一覧が config で変わることを確かめず、両 config で同じ artifact が揃う前提を置いた ← 根本原因

KEDB 照合（`終了コード` / `Bash` / `非 0` と `exit code` / `tool error` で陽性ヒットを確認したうえで）:
[[2026-09-10-expected-nonzero-must-be-mapped-before-tool-return]] が同一の根本原因だが `status: applied`。
既存規律は「終了コードが状態を表すコマンド」（`grep`・KEDB 検査）を対象としており、
**存在が構成で変わる任意成果物を読む確認**という軸は覆っていない。applied ノートには追記せず恒久側を直接強化した。

横断スコープ: 同型は「run 成果物の有無を前提にした確認」全般に潜む。`tests/*/iteration-*/eval-*/` の artifact は config で揃わない（`contamination.txt` は `without_skill` のみ）。

## 提案

存在が実行構成で変わる成果物の確認は、終了コードを決める位置に置かず、先に実在を確かめるか `[ -f ]` で分岐する。artifact 一覧が config によって変わらないことを確かめずに同じ確認を当てない。

基底ドキュメントの終了コード規律へ適用した。
