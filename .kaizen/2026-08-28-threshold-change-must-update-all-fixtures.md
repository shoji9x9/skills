---
date: 2026-08-28
type: rule
priority: medium
status: pending
applied-to: []
session: codex
---

# 検出閾値を変えたら全入力形式の fixture と assertion を同じ変更で検証する

## 事象

`kaizen-candidate-scan.sh` の repeated-edit 判定を同一パスの 3 回目へ変更した際、通常形式の fixture は更新したが、
Codex の `event_msg` / `FileChange` 形式 fixture と eval 15 の「2 回」を前提にした assertion を更新しなかった。
レビューで、構造化 fixture が exit 1 になる矛盾と、パスを変数名へ正規化したことによる衝突が指摘された。

## 根本原因

1. なぜ矛盾が残ったか → 検証を更新した通常 fixture に限定し、同じ検出経路へ入る構造化入力とその評価文を列挙しなかった。
2. なぜ列挙しなかったか → 変更した実装行から参照先を追い、入力形式ごとの状態空間で回帰対象を導出しなかった。
3. なぜ防げなかったか → 閾値・判定キーの変更時に、同じ意味論を表す全 fixture と assertion を同時に突き合わせる規律が無かった。

KEDB 照合: `repeated edit` / `fixture` / `review` で既存の pending 記録は見つからなかった。

## 提案

検出器の閾値・キー・判定条件を変えたら、入力形式ごとの fixture、陽性・陰性・境界ケース、eval assertion を意味論で列挙して同じ変更で更新し、各形式を実行して期待する終了コードまで確認する。
