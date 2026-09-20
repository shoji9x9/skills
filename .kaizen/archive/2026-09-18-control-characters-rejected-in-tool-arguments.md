---
date: 2026-09-18
type: doc
priority: low
status: applied
applied-to: [.agents/rules/state-space-and-mutation-proof.md]
session: claude-code
---

# 制御文字を含む引数はツール側で拒否される

## 事象

変異実証で「鍵を NUL（`U+0000`）で連結する行」を needle として Bash ツールへ渡したところ、
`command contains control characters that would be hidden in the approval dialog` で拒否された。
別の行（`if (paramPairs.has(`）を needle にして通した。

## 根本原因

- なぜ拒否された? → 承認ダイアログで見えない制御文字を含むコマンドをツールが通さない
  - なぜ含めた? → コードの実在文字列をそのまま写した（変異の needle は一字一句写す規律に従った）
    - なぜ回避できなかった? → 「制御文字を含む行は needle にしない」という手順が無い ← 根本原因

KEDB 照合: [[2026-09-17-worktree-session-rejects-computed-bash]] は worktree 隔離ガードによる
**実行前の拒否**で、同じ「ツールが実行前に弾く」形だが別のガード（判定材料が制御文字か、git 操作の静的確認か）。
同じノートへまとめると回避策が混ざるため分ける。

## 提案

変異実証の needle には制御文字（`U+0000` 等）を含まない行を選ぶ。

- 判定行そのものが制御文字を含むなら、その直前の分岐行を変異して同じ経路を無効化する
- 鍵の区切りに制御文字を使うと、検証・ログ・承認 UI で扱いにくい——見えない文字を選ぶときは
  「後でこの行をどう検査するか」まで見て決める（本件は `Set` の鍵で、可視文字でも衝突しない設計にできた）
