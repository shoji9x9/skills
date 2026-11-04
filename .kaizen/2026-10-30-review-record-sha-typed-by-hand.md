---
date: 2026-10-30
type: doc
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# 手元のレビューの記録に、表示された短い SHA から組み立てた SHA を渡し、記録のスクリプトに拒否された

## 事象

issue-batch の run の #766（PR #832）で、pr-finalize-loop の反復 3 の記録を `local-review-record.sh post` で投稿した。
`--sha` に、`git log --oneline` に表示された短い SHA の後ろを補って組み立てた 40 桁を渡し、スクリプトが「PR の HEAD と違う」で投稿を拒否した。
反復 1 と 2 では、`gh pr view --json headRefOid` から取得した SHA を渡していた。

2026-11-03、Issue #871（PR #873）の pr-finalize-loop の反復 2 で、`local-review-record.sh post` が「PR の HEAD と違う」で投稿を拒否した。
`--sha` に、レビューの結果に表示された短い SHA から組み立てた 40 桁を手で渡していた。
PR の HEAD を `gh pr view --json headRefOid` で取得して形を確かめてから投稿するスクリプト（scratchpad の `post-record.sh`）に替えて通した。反復 3 も同じスクリプトで投稿した。
反復 1 では記録を投稿しておらず、反復 2 が初めての投稿だった。そのため「2 回目に書く時点でスクリプトにする」という提案では防げず、1 回目の投稿でも起きた。

2026-11-04、Issue #855（PR #885）の pr-finalize-loop の反復 2 で、`local-review-record.sh post` が「PR の HEAD と違う」で投稿を拒否した。
`--sha` に、commit の出力に表示された短い SHA（`8a388b4e`）の後ろを記憶から補った 40 桁を渡していた。
この学びはセッション開始時の注入の上限（30 件）の外で、文脈には入っていなかった。
PR の HEAD を `gh pr view --json headRefOid` で取得し、形と手元の HEAD との一致を確かめてから投稿するスクリプト（scratchpad の `post-record.sh`）に替えて通した。
反復 1 では記録を投稿しておらず、#873 と同じく初めての投稿で起きた。#832・#873 に続く 3 回目である。

## 根本原因

- なぜ違う SHA を渡したか → #832 では、同じ形の呼び出しを 3 回目に書くとき、前の回のコマンドをコピーし、SHA だけを手で書き換えた。
  #873 では、初めての投稿で、レビューの結果に表示された短い SHA から 40 桁を組み立てた
- なぜ手で書いたか → レビューした SHA を、取得したときにファイルや変数に残さず、投稿のときに表示から組み立て直していた
- なぜ残さなかったか → 取得した値を機械で渡す形を、繰り返したときに作るものと考え、初めての投稿では作らなかった ← 根本原因

`AGENTS.md`「シェルの書き方」の「ID・完全な SHA・長い prompt・スクリプト名は、表示された結果から手で書き写さない」に当たる。適用済みの学び `2026-09-10-do-not-transcribe-structured-tool-inputs` と同じ形である。

## 根拠

記録のスクリプトが拒否した出力（`渡した SHA … が PR の HEAD … と違う`）で確かめた。スクリプトの検査が働いたので、誤った記録は残っていない。

KEDB 照合は `SHA`・`local-review-record`・`書き写` で行い、pending の学びに一致は無かった。archive の applied の学びに同じ形がある。

2026-11-04 の PR #885 でも、同じ原因（レビューした SHA を残さず、初めての投稿で表示から手で組み立てた）で再発した。記録のスクリプトの拒否の出力で確かめた。
注入の上限で省かれると、学びは文脈に届かない。そのため、同梱の手順の例を先に直す（「## 提案」の、`review-tool.md` の `post` の例を直す箇条）。

## 提案

`local-review-record.sh post` の `--sha` は、初めての投稿から、レビューを始める前に `gh pr view --json headRefOid` で取得してファイルに保存した SHA を、そのファイルから読んで渡す。

- 決まった形の呼び出しを繰り返すなら、変わる値（SHA・ID）を構造化された出力から取得して保存し、保存した値を渡すスクリプトにまとめる
- 再発の根拠: PR #873 では、初めての投稿で同じ形が起きた（「2 回目に書く時点」では遅い）
- #832 と #873 の run では、PR の HEAD を取得してから記録を投稿するスクリプト（scratchpad の `post832rec.sh`・`post-record.sh`）に替えた
- 機構は作らない。記録のスクリプトが SHA を PR の HEAD と突き合わせて止めるので、誤った記録は残らない
- 同梱の手順の例を直す。`pr-finalize-loop` の `references/review-tool.md` で、「local」の手順 3 の `post` の例は `--sha` に手順 1 で取得した値を手で渡す形である。
  これを、手順 1 でレビューする SHA をファイルに保存し、手順 3 でそのファイルから読んで渡す形にする。学びが注入の上限で省かれても、手順を読めば保存した SHA を渡す形になる（PR #885 の再発）
  - 投稿の時点の `headRefOid` を `--sha` に渡す形にはしない。`post` は `--sha` を投稿の時点の `headRefOid` と比べるので、出所が同じ値になり、レビューの後に push があってもレビューしていない HEAD を記録してしまう
