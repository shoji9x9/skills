---
date: 2026-10-30
type: doc
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# commit message の種別は、使わない種別ではなく使える種別の一覧で書く

## 事象

Issue #684 の commit で、性能の改善に perf: を選び、commitlint の type-enum で拒否された。
commit の前に commitlint --edit で確かめたので、commit は失敗せず、種別を test: に直しただけで済んだ。

## 根本原因

- なぜ perf を選んだか: conventional commits の一般的な種別の一覧を前提にした。
- なぜ確かめずに選んだか: AGENTS.md の commit message の節が、使わない種別（build・style）だけを挙げ、使える種別を挙げていない。挙げていない perf は使えると読んだ。
- なぜその書き方か: 原本は commit-types.ts にあり、AGENTS.md は除外だけを書いた。除外の列挙は、残りを一般の一覧で補わせる。

## 根拠

原因は 1 つに絞れたが、観測は 1 回なので medium にした。
commitlint の出力が許す種別を feat・fix・docs・refactor・test・ci・chore と示した。
KEDB 照合（commit・commitlint・type、種別・commit-types）で、種別の選び方の学びは無かった。

## 提案

AGENTS.md の commit message の節に、使える種別（commit-types.ts の一覧）を列挙し、使わない種別だけを挙げる書き方をやめる。

- 一覧の原本は commit-types.ts のままにする。AGENTS.md との一致を commit-types-consistency.test.ts で確かめるかは、適用のときに効果と費用で決める。
