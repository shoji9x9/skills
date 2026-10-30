---
date: 2026-10-30
type: doc
priority: low
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

## 根本原因

- なぜ違う SHA を渡したか → 同じ形の呼び出しを 3 回目に書くとき、前の回のコマンドをコピーし、SHA だけを手で書き換えた
- なぜ手で書き換えたか → 取得と投稿が別の呼び出しに分かれていて、取得した値を同じ呼び出しの中で渡す形になっていなかった
- なぜ同じ形にしなかったか → 繰り返す呼び出しをスクリプトにまとめる判断を、3 回目まで延ばした ← 根本原因

`AGENTS.md`「シェルの書き方」の「ID・完全な SHA・長い prompt・スクリプト名は、表示された結果から手で書き写さない」に当たる。適用済みの学び `2026-09-10-do-not-transcribe-structured-tool-inputs` と同じ形である。

## 根拠

記録のスクリプトが拒否した出力（`渡した SHA … が PR の HEAD … と違う`）で確かめた。スクリプトの検査が働いたので、誤った記録は残っていない。

KEDB 照合は `SHA`・`local-review-record`・`書き写` で行い、pending の学びに一致は無かった。archive の applied の学びに同じ形がある。

## 提案

決まった形の呼び出しを 2 回目に書く時点で、変わる値（SHA・ID）をその場で取得して渡すスクリプトにまとめる。

- この run では、PR の HEAD を取得してから記録を投稿するスクリプト（scratchpad の `post832rec.sh`）に替えた
- 機構は作らない。記録のスクリプトが SHA を PR の HEAD と突き合わせて止めるので、誤った記録は残らない
