---
date: 2026-10-02
type: hook
priority: medium
status: pending
applied-to: []
session: claude-code
---

# スクリプト位置からのパス解決は CDPATH を空にした cd で行う

## 事象

Issue #547 で `scripts/tools/reinstall-skill.sh` の操作対象をスクリプトの位置から求める
`repo_root="$(cd -P -- "$(dirname -- "${script_path}")/../.." && pwd)"` を書いた。
相対パスで起動すると `cd` の引数が `scripts/tools/../..` になり、export された CDPATH に
別ツリーの `scripts/tools` があると `cd` がそちらへ移動し、移動先を stdout にも出して `repo_root` が 2 行になる。
自分のテスト 11 件・変異 5 件は全部緑で、`/code-review --fix` が初めて見つけた。

## 根本原因

- なぜ書いたか `$(cd "$(dirname "$0")" && pwd)` はシェルの定型句で、cd の引数解決が環境変数に依存する点を状態空間に入れなかった
- なぜテストで見えなかったか テストの軸を「起動位置（cwd・相対/絶対・symlink・stdin）」でだけ引き、判定に機能する入力である**呼び出し元から継承する環境変数**を軸にしなかった
- なぜ他所にも残るか `CDPATH` 無指定の `$(cd ...)` が配布スキル kaizen に 8 箇所あり、機械的な検査が無い ← 根本原因（対策可能）
  - 相対になりうる引数: `kaizen-extract-done.sh:42`・`kaizen-status-check.sh:13`・`kaizen-precommit-gate.sh:59`（`dirname "${BASH_SOURCE[0]}"`）、
    `kaizen-archive.sh:232`（`.kaizen/archive`）・`kaizen-archive.sh:244`（`dirname "${f}"`）
  - 引数の出所を要確認: `kaizen-hook-common.sh:188`・`:193`（`base`）、`kaizen-precommit-gate.sh:721`（`head`）
  - 最初の横断確認は `$(cd ...dirname` で grep したため `kaizen-archive.sh:232` を取りこぼした（PR #551 のレビューで判明）。走査は `dirname` に限らず `$(cd` の全出現で取る

## 提案

シェルスクリプトで `$(cd <相対になりうるパス> && pwd)` を書くときは `CDPATH='' cd` にし、`scripts/gates/` の横断チェックで `$(cd` の CDPATH 無指定を検出して落とす。

- チェックが検出することの確認: 上記 kaizen スクリプトの現行版（8 箇所）が検出されること
- 横断スコープ: 配布スキル `skills/kaizen/scripts/` の上記箇所を `CDPATH='' cd` に直す（`.mjs` 側には該当なし）
- テスト観点として、パスを解決するスクリプトの状態空間に「継承する環境変数（CDPATH 等）」の軸を入れる
