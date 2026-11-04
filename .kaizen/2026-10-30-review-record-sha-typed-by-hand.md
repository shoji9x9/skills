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
- なぜ手で書いたか → 取得と投稿が別の呼び出しに分かれていて、取得した値を同じ呼び出しの中で渡す形になっていなかった
- なぜ同じ形にしなかったか → 取得した値を同じ呼び出しで渡す形を、繰り返したときに作るものと考え、初めての投稿では作らなかった ← 根本原因

`AGENTS.md`「シェルの書き方」の「ID・完全な SHA・長い prompt・スクリプト名は、表示された結果から手で書き写さない」に当たる。適用済みの学び `2026-09-10-do-not-transcribe-structured-tool-inputs` と同じ形である。

## 根拠

記録のスクリプトが拒否した出力（`渡した SHA … が PR の HEAD … と違う`）で確かめた。スクリプトの検査が働いたので、誤った記録は残っていない。

KEDB 照合は `SHA`・`local-review-record`・`書き写` で行い、pending の学びに一致は無かった。archive の applied の学びに同じ形がある。

2026-11-04 の PR #885 でも、同じ原因（取得と投稿が別の呼び出しで、初めての投稿で手で組み立てた）で再発した。記録のスクリプトの拒否の出力で確かめた。
注入の上限で省かれると学びが文脈に届かないので、同梱の手順（pr-finalize-loop の references/review-tool.md の「local」の手順 3 の例）を、headRefOid を同じ呼び出しで渡す形にするのが先である。

## 提案

`local-review-record.sh post` の `--sha` は、初めての投稿から、PR の HEAD を `gh pr view --json headRefOid` で取得して同じ呼び出しの中で渡す。

- 決まった形の呼び出しを繰り返すなら、変わる値（SHA・ID）をその場で取得して渡すスクリプトにまとめる
- 再発の根拠: PR #873 では、初めての投稿で同じ形が起きた（「2 回目に書く時点」では遅い）
- #832 と #873 の run では、PR の HEAD を取得してから記録を投稿するスクリプト（scratchpad の `post832rec.sh`・`post-record.sh`）に替えた
- 機構は作らない。記録のスクリプトが SHA を PR の HEAD と突き合わせて止めるので、誤った記録は残らない
