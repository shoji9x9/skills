---
date: 2026-10-21
type: doc
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# テストから使う補助のファイルも、失敗の分岐をテストしないと pre-push のカバレッジで止まる

## 事象

Issue #658 で、テストから oxlint を起動する補助 `scripts/gates/code/oxlint-plugin/run-oxlint.ts` を足した。
出力を読めないときの例外の分岐をテストせず、pre-push の `test:coverage` が分岐 75%（閾値 80%）で push を止めた。

## 根本原因

- なぜ止まったか → 補助のファイルも `scripts/` のカバレッジの対象で、例外の分岐が実行されなかった
- なぜ気付かなかったか → pre-commit はカバレッジを測らず、commit までに実行した vitest は通っていた
- なぜ例外の分岐をテストしなかったか → 補助のファイルを、テストする対象ではなくテストの一部として扱った

## 根拠

1 回の観測だが、失敗したファイルと分岐を pre-push の出力で特定し、例外の分岐のテストを足して通した。
KEDB 照合（カバレッジ・pre-push、coverage・push）で同じ原因の学びは無かった。

## 提案

`scripts/` にテストから使う補助のファイルを足したら、その例外と失敗の分岐にもテストを書き、push の前に `pnpm run test:coverage` を実行する。

- 適用先候補: `docs/testing.md` の「カバレッジ」に、テストの補助も対象であることを書き足す
