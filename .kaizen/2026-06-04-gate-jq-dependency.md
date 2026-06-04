---
date: 2026-06-04
type: skill
priority: medium
status: applied
session: claude-code
---

## 事象

kaizen 回帰ベンチ（iteration-2）の eval-4 で、worktree 分離サブエージェント環境では
`kaizen-precommit-gate.sh` が `git commit` をブロックしないことが判明した。原因は環境の
`jq` が mise の shim で、worktree の `mise.toml` が untrusted のため jq がエラー終了し、
コマンド抽出が空になって生 JSON にフォールバックした結果、`"command":"git commit ..."` の
`git commit` がゲートの区切り文字判定（行頭/`;&|(` 直後）に合致せず素通りした。

## 根本原因

ゲートのコマンド抽出が `jq` 単一依存で、jq が無い／壊れた環境のフォールバック（生 JSON）が
正しく機能しなかった。生 JSON では `git commit` の直前が JSON のクォート (`"`) になるため、
クリーン抽出を前提にした区切り文字クラス `[;&|(]` ではマッチしない。3 階層の why:

- なぜ素通りしたか? → 生 JSON 上の `"git commit` が区切り文字判定にマッチしなかった
  - なぜ生 JSON になったか? → jq が失敗してコマンドを抽出できず生入力にフォールバックした
    - なぜ抽出できなかったか? → 抽出が jq 単一依存で、jq 不在/失敗時の代替手段が無かった
      ← 根本原因（対策可能）

## 提案

`kaizen-precommit-gate.sh` のコマンド抽出を多段フォールバック（jq → python3 → 生 JSON）に
する。さらに生入力フォールバック時のみ、正規表現の境界に JSON クォート (`"`) を含めて
`"git commit` も検出できるようにする（クリーン抽出時は誤検知を避けるため厳しめの境界を維持）。
実装済み・検証済み（jq あり／jq なし python3 あり／両方なしの 3 経路で commit はブロック、
非 commit と `echo "...git commit"` は素通りを確認）。
