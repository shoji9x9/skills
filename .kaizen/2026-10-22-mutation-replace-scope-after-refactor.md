---
date: 2026-10-22
type: hook
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 関数を分けた後、変異の replace が移した変数を参照して、テストの全件を落とした

## 事象

Issue #756 で `code-strings.ts` の関数を分け、配列 `md` を `markdownBuilder` の中に移した。
変異 `CS-FRONTMATTER` の `find` は当たったが、`replace` が `md` を参照していたので、変異を当てると `ReferenceError` で宣言外のテストがすべて落ちた。
直列で 1 時間近くかかる実行の終わりで初めて分かった。

## 根本原因

- なぜ落ちたか → 変異を当てたコードが、存在しない変数を参照した
- なぜ実行の前に気付かなかったか → 定義を直した後の確認が `find` の出現数だけで、`replace` を当てたコードが動くかを確かめていなかった
- なぜその確認だけにしたか → 関数を分けると `replace` が使う名前のスコープが変わることを、手順に入れていなかった

## 根拠

1 回の観測だが、原因は `ReferenceError` と `replace` の中身で 1 つに絞れた。
KEDB 照合（replace・mutations.json、find・リファクタ、変異・置換）で、同じ原因の学びは無かった。
一致した `2026-09-17-format-then-patch-recurred-after-prose-rule.md` は、整形した後の `find` の不一致で、原因が違う。

## 提案

変異の対象のコードを分けたら、`find` の出現数に加えて、各変異を当てたファイルが構文と型の検査を通るかを、長い実行の前に確かめる。

- 適用先候補: `scripts/mutation/` に、各変異を当てた内容を構文の検査（tsc の文法と名前の解決）だけで確かめる `--check-only` を足す
