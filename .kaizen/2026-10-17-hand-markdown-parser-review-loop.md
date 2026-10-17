---
date: 2026-10-17
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# 手書きの Markdown の読み取りを直すときは、先に CommonMark と GFM の仕様から扱う形を表にし、micromark の描画と突き合わせるテストで確かめる

## 事象

Issue #611 の PR #670 で、replace-strategy の `lib/markdown.mjs` の HTML コメントの読み方を直した。
レビューの反復ごとに、GFM の描画と食い違う新しい形が見つかった。
反復 1 は行の途中の閉じない `<!--`・字下げ、反復 2 は表が段落を中断する形・セルの中のコメント・`<!-->`、反復 3 はリストと引用の中のコメント・エスケープである。
指摘を受けるたびに 1 形ずつ直し、反復 2 では読み方を書き直した。
反復 3 では、反復 2 の修正が別の形の回帰を生んでいた。

## 根本原因

- なぜ反復ごとに新しい形が出たか → 直す前に、入力の文法（CommonMark の HTML ブロックとインラインの HTML、GFM の表、コンテナのブロック）から形を挙げていなかった
- なぜ回帰に気づけなかったか → テストの期待値を自分の理解で書き、実際の描画（micromark）と比べるテストが無かった
- なぜ 3 巡まで続けたか → `.agents/rules/state-space-and-mutation-proof.md` の「同じ種類の誤りを 3 回以上指摘されたら入力の形式を疑う」を、反復の途中で当てなかった

## 提案

手書きの Markdown の読み取りを直すときは、先に CommonMark と GFM の仕様から扱う形と扱わない形を表にし、micromark の描画と突き合わせるテストで確かめる。

- 適用先候補: `.agents/rules/state-space-and-mutation-proof.md` の「入力を解析する処理は、入力の文法が許す形から状態を挙げる」に、Markdown の場合の例として micromark との突き合わせを書く
- 扱わない形（コンテナの中など）は、スキルの文書に「読めない形」として書き、レビューで同じ指摘が出ないようにする
