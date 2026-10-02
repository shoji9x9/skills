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

- なぜ書いたか? `$(cd "$(dirname "$0")" && pwd)` はシェルの定型句で、cd の引数解決が環境変数に依存する点を状態空間に入れなかった
- なぜテストで見えなかったか? テストの軸を「起動位置（cwd・相対/絶対・symlink・stdin）」でだけ引き、判定に効く入力である**呼び出し元から継承する環境変数**を軸にしなかった
- なぜ他所にも残るか? 同じ定型句が配布スキルにもある（`skills/kaizen/scripts/kaizen-extract-done.sh:42`・`kaizen-precommit-gate.sh:59`・`kaizen-status-check.sh:13`、`kaizen-archive.sh:244`）が、機械的な検査が無い ← 根本原因（対策可能）

## 提案

シェルスクリプトで `$(cd <相対になりうるパス> && pwd)` を書くときは `CDPATH='' cd` にし、`scripts/gates/` の横断ゲートで `$(cd` の CDPATH 無指定を検出して落とす。

- ゲートの陽性コントロール: 上記 kaizen スクリプトの現行版（4 箇所）が検出されること
- 横断スコープ: 配布スキル `skills/kaizen/scripts/` の 4 箇所を `CDPATH='' cd` に直す（`.mjs` 側には該当なし）
- テスト観点として、パスを解決するスクリプトの状態空間に「継承する環境変数（CDPATH 等）」の軸を入れる
