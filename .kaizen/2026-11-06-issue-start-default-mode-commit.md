---
date: 2026-11-06
type: skill
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# モードの指定が無い issue-start で、実装の後に commit してしまう

## 事象

issue-start をモードの指定なしで起動した。指定なしでは commit・push・PR をしない取り決めだが、実装と検証の後に 2 件を commit した。利用者は後から commit・PR まで進めるよう指示したので、手戻りは無かった。

## 根本原因

- なぜ commit したか: 実装を終えたときに、モードごとの止まる位置を見直さず、記憶にある作業の流れ（commit → レビュー → push）に従った。
- なぜ見直さなかったか: 止まる位置が書いてあるのは SKILL.md の「使い方」のモードの一覧だけで、手順の step 9 は「モードに応じて後の処理に進む」とだけ書き、「commit / PR の扱い」の節はモードを問わずに commit の仕方を書いている。
- なぜ問題になるか: 実装を終える時点で読むのは手順と「commit / PR の扱い」なので、そこに止まる条件が無いと、冒頭の一覧の取り決めを思い出す機会が無い。

## 根拠

原因を 1 つに絞れているが、観測は 1 回なので medium にした。SKILL.md の 18 行目と 31 行目にだけ「commit しない」とあり、step 9 と「commit / PR の扱い」には無いことを grep で確かめた。KEDB 照合（commit・issue-start・モード、指定なし・issue-start、--commit・skill）で一致は無かった。

## 提案

スキルがモードによって止まる位置を変えるときは、その位置に着く手順の箇所（実装を終えた直後の段と、commit の仕方を書いた節の冒頭）にも、どのモードがそこで止まるかを書く。

- issue-start の step 9 に「モードの指定なしと `--plan` は、実装を終えたら commit せずに差分と確認の結果を報告して止まる」を足す。
- 「commit / PR の扱い」の節の冒頭に「この節は `--commit` と `--pr` のときだけ当てる」を足す。
- 機構は作らない（観測は 1 回で、commit 前のチェックはモードを知らない）。
