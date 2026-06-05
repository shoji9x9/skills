---
date: 2026-06-05
type: doc
priority: medium
status: pending
session: claude-code
---

## 事象

Copilot レビューが「`dependabot/fetch-metadata` の `updated-dependencies-json` は
kebab-case（`new-version`）なので `.newVersion` 参照だと major 判定が常に 0 になり
自動マージされない。`new-version` に直せ」と指摘した。一次情報（fetch-metadata の
テスト）で確認したところ、出力キーは **camelCase**（`updatedDependencies[0].newVersion`
等）で、指摘は誤りだった。鵜呑みに「修正」していたら全件 review 落ちで**自動マージを
完全に無効化**していた。

## 根本原因

レビュー指摘のうち「外部ツール / API / ライブラリの仕様」に関する factual な主張を、
一次情報で裏取りせずに適用すると、自信ありげな誤指摘がそのままリグレッションになる。
特に「常に失敗する / 壊れる」系の主張は影響が大きい。

## 提案

`pr-review-handle` の妥当性判断で、外部仕様に関する主張は**公式ソース / テスト /
ドキュメント等の一次情報で裏取りしてから**対応する。「常に壊れる」系の主張は、適用前に
最小確認（実出力・テスト・公式 doc）で真偽を確定する。適用先候補は
`skills/pr-review-handle/SKILL.md` の「妥当性の判断ガイド」への一文追加。
関連: [[2026-06-05-dependabot-commit-prefix-from-commit-types]]。
