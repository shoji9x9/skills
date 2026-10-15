---
date: 2026-10-15
type: doc
priority: low
status: pending
applied-to: []
session: claude-code
---

# リントの違反を入力にするテストは、例を辞書から読む

## 事象

応答の使わない語を確かめる Hook のテストに、使わない語を文字列で直接書き、pre-commit の prose（textlint はコードの文字列も見る）で 5 件止まった。
直した際に辞書の JSON を `as` で型付けし、oxlint でもう一度止まった。

## 根本原因

- なぜ止まったか: テストの文字列も textlint の対象で、`as` は oxlint が禁じている。
- なぜ書いたか: 同じ辞書を入力にする既存のテスト（`scripts/gates/prose/lint-prose.test.ts`）の書き方を、書く前に読まなかった。
- なぜ読まなかったか: 新しいテストを書く前に、同じ入力を扱う既存のテストを grep して雛形にする手順が無い。

## 提案

リントの違反を入力にするテストは、違反の例を文字列で書かず原本（`.textlint/words.json` の `example`）から型ガードで読み、書く前に同じ入力を扱う既存のテストを grep して書き方をそろえる。

- 置き場所の候補: `docs/tooling.md` のテストの節。
