---
date: 2026-11-07
type: doc
priority: medium
confidence: medium
status: applied
applied-to: ["docs/package-manager.md"]
session: claude-code
---

# 依存を足すときに、既存の exact の指定を理由を確かめずにまねた

## 事象

Issue #672 で devDependencies を 4 つ足すとき、既存の依存が exact で指定されていたのに合わせて exact にした。
利用者に理由を問われて調べると、git 履歴にも文書にも固定する理由が無かった。

## 根本原因

- なぜ exact にしたか: 既存の依存の書き方に合わせた。
- なぜ合わせたか: 書き方を規約とみなし、元の意図を確かめなかった。
- なぜ確かめなかったか: バージョンの指定の方針が文書に無く、既存の書き方しか手がかりが無かった。

## 根拠

確信度 medium: 1 回の観測で、原因は方針の文書が無いことに絞れる。
KEDB 照合では `2026-09-23-recommend-before-precedent-survey.md`（applied）が近い。あちらは選択肢を示すときの調査で、今回は既存の書き方をそのまま踏襲した場面である。

## 提案

既存の書き方に合わせて設定や指定を足すときは、その書き方の理由が文書か git 履歴にあるかを先に確かめ、無ければ方針を決めて文書に書く。

- 適用: `docs/package-manager.md`「依存のバージョンの指定」
