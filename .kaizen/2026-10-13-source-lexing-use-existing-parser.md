---
date: 2026-10-13
type: rule
priority: medium
status: applied
applied-to: [.agents/rules/state-space-and-mutation-proof.md]
session: claude-code
---

# ソースコードのコメント・文字列・構文を判定するチェックは、行の正規表現で近似せず既存のパーサを使う

## 事象

Issue #605 で足した `check-skill-lint-directives.ts` は、抑止コメントと `Array.isArray` を行単位の正規表現で判定した。
`/code-review` で 1 件、PR #615 の Copilot のレビューで 5 件、同じ種類の指摘が出た。
文字列の中の `//` の誤検知と見逃し、改行を挟んだ `Array\n.isArray` の見逃し、空白の無い行コメント、型ガードの中の 2 回目の呼び出しである。
TypeScript の構文木で読む形に作り直した。

## 根本原因

- なぜ指摘が続いたか: コメント・文字列・複数行の区別を、行の正規表現で近似したから
- なぜ近似したか: 新しいチェックを一から書き、既存の部品を探さなかった。
  `scripts/lib/text/code-comments.ts` は TypeScript のパーサでコメントの範囲を得ており、
  「自前で引用や置換を追う読み方は使わない」とも書いていたが、その lib の中のコメントでしかなかった
- なぜ探さなかったか: チェックを書くときに読む rule（`state-space-and-mutation-proof.md`）は
  「文法が許す形から状態を挙げる」とは言うが、「ソースコードの字句は既存のパーサで読む」
  「`scripts/lib` の既存の解析部品を先に探す」とは言っていない

## 提案

ソースコードのコメント・文字列・構文を判定するチェックは、行の正規表現で近似せず、既存のパーサ（`jsCommentRanges`・TypeScript の構文木・`shfmt --to-json`）を使う。

- 記述先: `.agents/rules/state-space-and-mutation-proof.md` の「入力を解析する処理は、入力の文法が許す形から状態を挙げる」の節に 1 段落足す（`paths: scripts/**` で読み込まれる）
- 書く前に `scripts/lib/` の既存の解析部品（`code-comments.ts`・`code-strings.ts`）を grep で探す、と添える
- 横断の範囲: `scripts/gates/` の他の `lint-*`（`lint-pagination.ts` など）が同じ近似をしていないかを、apply のときに確かめる
