---
date: 2026-10-17
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 型述語のように書き方が多い宣言を読むチェックは、構文を自分でたどる前に、型チェッカーの API で読めるかを確かめる

## 事象

PR #682 で、型ガードの絞る型を検査する `check-type-guard-brands.ts` を、TypeScript の構文木を自分でたどる形で書いた。
レビューは 3 巡続けて、型述語の書き方の抜けを指摘した。
抜けていたのは、変数の注釈・オブジェクトの欄・代入の `@type`・オーバーロード・括弧で囲んだ型・条件式の枝・`Array<T>`・`symbol` である。
1 巡ごとに書き方を足して直したが、そのたびに別の書き方が見つかった。

## 根本原因

- なぜ抜けが続いたか → 型述語を置ける場所を、思いついた書き方から 1 つずつ列挙した。型述語は宣言・注釈・文脈の型のどこからでも付くので、構文の形は閉じない
- なぜ形を変えなかったか → `.agents/rules/state-space-and-mutation-proof.md` の「レビューが同じ種類の誤りを 3 回以上指摘したら、入力の形式を疑う」を、2 巡目の時点で当てなかった
- 代わりの方法 → 型チェッカーの `getSignatureFromDeclaration` と `getTypePredicateOfSignature` なら、別名・オーバーロード・文脈の型を TypeScript 自身が解決する

## 提案

型述語のように書き方が多い宣言を読むチェックは、構文を自分でたどる前に、型チェッカーの API で読めるかを確かめる。

- 適用先候補: `.agents/rules/state-space-and-mutation-proof.md` の「ソースコードのコメント・文字列・構文を判定するチェックは、既存のパーサで読む」に、型の情報（型述語・別名の解決）が要るなら型チェッカーで読むことを足す
- `check-type-guard-brands.ts` は、PR #682 の反復 4 で型チェッカーで読む形に変えた（リポジトリ全体で約 4 秒）
