---
date: 2026-11-06
type: rule
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# SVG から `on*` を除く処理を書いたとき、HTML が属性として読む形を仕様から挙げず、引用符の直後の `on*` を除けなかった

## 事象

2026-11-06、Issue #921 で aws-architecture-diagram の SVG から `<script>` と `on*` を除く部品（`strip-active-content.mjs`）を書いた。
`on*` の前の区切りは、思いついた空白と `/` だけを挙げた。
push の前の `/code-review --fix` が、引用符の直後に空白なしで続く属性（`width="1"onclick=...`）と、名前空間の接頭辞を付けた `<a:script>` を除けないと指摘した。
テストの期待値も 2 件、実際の出力を測らずに自分の理解で書いて外れた。

## 根本原因

- なぜ抜けたか → 除く形を、HTML の属性とタグの文法から挙げず、元のコードと Issue の 2 例から挙げた
- なぜ文法から挙げなかったか → `.agents/rules/state-space-and-mutation-proof.md` は埋め込み先の文法から挙げると書くが、例は Markdown だけで、HTML の属性の区切りやタグ名の形が無い
- 2026-10-08 の学び（embed-into-markup-enumerate-grammar、applied）と同じ原因の再発である

## 根拠

`/code-review` の指摘を手元で実行し、直す前のコードで 3 件とも残ることを確かめた。
同じ原因の applied の学びがあるが、applied との一致だけでは確信度を high にしないので medium にした。

## 提案

`.agents/rules/state-space-and-mutation-proof.md` の「埋め込み先の仕様から、文字列が構文として読まれる形を挙げる」に、HTML の例を足す。

- 例: 属性の区切り（空白・`/`・引用符で閉じた値の直後）、終了タグの後の属性、名前空間の接頭辞、取り除いた後に現れる形（入れ子）
- テストの期待値は、実際の出力か元の実装の出力を測って決める（仕様から決める規約の再確認）。
