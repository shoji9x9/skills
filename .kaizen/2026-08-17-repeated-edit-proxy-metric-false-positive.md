---
date: 2026-08-17
type: hook
priority: medium
status: pending
applied-to: []
session: claude-code
---

# コミット前ゲートの repeated edit は代理指標で、正常な複数箇所編集を候補と誤検出する

## 事象

Issue #200（mise ツール bump）で `git commit` がゲートにブロックされた。理由は
`repeated edit: transcript line 90`。実体は `package.json` 内で同一バージョン文字列を持つ
2 箇所（`devEngines.packageManager.version` と `packageManager`）を Edit 2 回で直しただけで、
やり直し・手戻りは起きていない。セッション全体でツールエラー 0・ユーザーの修正指示 0。
抽出すべき学びが無いのに抽出サイクルを 1 往復強いられた。

## 根本原因

- なぜブロックされたか → `kaizen-candidate-scan.sh` が同一 file_path への 2 回目以降の
  Edit / Write を無条件で候補にする（`skills/kaizen/scripts/kaizen-candidate-scan.sh:240-247`）
  - なぜ無条件か → `skills/kaizen/references/extract.md` の抽出パターン「同一ファイルへの複数回の編集
    （作成→削除→再作成など）」から、括弧内の“やり直し”条件を落として実装しているため
    - なぜ落ちたか → 検出したい事象は「同じ箇所を作り直した（手戻り）」なのに、観測が容易な
      「同一パスへの編集回数」という代理指標に置き換わり、正常系と弁別できなくなった ← 根本原因

Edit ツールは `old_string` の一意性を要求するため、同一文字列が 1 ファイル内の複数箇所にある場合、
1 つの論理的変更でも必ず複数回の Edit になる。「同一ファイル複数回編集」は手戻りの兆候ではなく、
ツール仕様上不可避な正常パターンでもある。

KEDB 照合: [[2026-08-03-detector-nonzero-hits-not-proof]]（applied）と同系だが、あちらは偽陰性、
本件は偽陽性で裏返しの派生形。applied のため追記しない。

横断スコープ: 同スクリプトの `U`（ユーザー修正指示）判定も正規表現に `ではなく` を含み、
「A ではなく B を使う」という通常の指示文で発火しうる同種の代理指標。

## 提案

検出器の判定条件は、観測しやすい代理指標ではなく検出したい事象そのものに合わせる。
弁別できない代理指標は正常系を候補へ格上げし、無意味な抽出サイクルを強いる。

- repeated edit 判定を弁別可能にする（いずれか）
  - 手戻りの実体を見る: 後続 Edit の `new_string` が先行 Edit の `old_string` と一致したときだけ候補
  - 弱い代替: 同一パスへの編集を 3 回以上に閾値化（2 回は Edit の一意性制約で正常に起こる）
- 変更時は陽性・陰性の両コントロールを fixture で取る。
  `skills/kaizen/evals/fixtures/candidate-scan/` には repeated-edit の陽性 fixture はあるが、
  「同一ファイルの別箇所を 2 回編集した正常系」の陰性 fixture が無い
- 反映先: `skills/kaizen/scripts/kaizen-candidate-scan.sh` ＋ 上記 fixture / evals
