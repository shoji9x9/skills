---
date: 2026-09-10
type: doc
priority: medium
status: applied
applied-to:
  - AGENTS.md
session: codex
---

# 構造化されたツール入力を手で転記しない

## 事象

PR finalize 中に、短縮 commit SHA を完全 SHA として手補完して GitHub API が HTTP 422 になり、eval prompt を手で再入力して一字違いの無効な run を作った。正本から prompt を取得した次の run は、開いた stdin を CLI が追加入力として読んで失敗した。

## 根本原因

1. なぜ API と eval が失敗したか → 正本と一致しない SHA / prompt、意図しない stdin をツールへ渡した。
2. なぜ一致しない値を渡したか → 直前の表示を人手で補完・転記し、消費直前の形式・一致検証を行わなかった。
3. なぜ入力経路が増えたか → 引数で値を渡せば十分だと考え、非対話 CLI が stdin も読む契約を閉じなかった。

KEDB の既存規律には正本利用と background stdin の注意があったが、opaque ID・完全 SHA・eval prompt を同じ「手転記しない入力」として扱う接続が無かった。横断すると、API node ID、commit OID、review ID、長い本文、eval prompt など機械可読の正本を持つ全入力に同じ原因がある。

## 提案

opaque ID・完全 SHA・長い prompt は構造化された正本から消費する同じ呼び出し内で機械取得し、形式・非空・一致を検証して渡す。非対話 CLI の stdin は明示的に `/dev/null` へ閉じる。

基底ドキュメントへ適用した。
