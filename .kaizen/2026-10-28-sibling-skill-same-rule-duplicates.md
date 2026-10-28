---
date: 2026-10-28
type: doc
priority: low
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 姉妹スキルに同じ取り決めを同じ文面で足し、Markdown の重複のチェックが commit を止めた

## 事象

issue-batch の run の #794 で、`pr-finalize-loop` の `SKILL.md` と `pr-review-handle` の `SKILL.md` に、同じ取り決め（書き方の形を指す指摘は、PR の差分全体で同じ形を探す）を足した。
ローカルレビューの直しで 2 つの文面をそろえたところ、pre-commit の重複のチェック（`check-duplicates.ts`）が、6 行の Markdown の重複として commit を止めた。
`pr-review-handle` の側を短い言い回しに書き直して通した。

## 根本原因

- なぜ止まったか: `check-duplicates.ts` は Markdown の重複も検出し、配布スキルの間の同じ文面は、`identical-copies.json` に組として登録しないと失敗にする。
- なぜ同じ文面にしたか: 整合パス（`docs/skill-development.md`）は、姉妹スキルの同じ取り決めを同じ内容にそろえることを求め、レビューも文面のずれを指摘した。
- なぜ事前に避けなかったか: そろえるのが内容か文面かと、文面までそろえるなら登録が要ることを、取り決めを足す時点で確かめる手順が無い。

## 根拠

1 回の観測だが、止めたのが重複のチェックだと出力で確かめ、言い回しを変えると通ったので medium とする。
KEDB 照合は「重複」「SKILL.md」「jscpd」で行い、一致は無かった。

## 提案

複数の配布スキルに同じ取り決めを足すときは、内容をそろえて文面は各スキルの言い回しで書くか、文面までそろえるなら共通の部分を別のファイルに切り出して `identical-copies.json` に組として登録する。

`identical-copies.json` の範囲の組（`region`）は、印の行を `//` か `#` で書くファイルのためのもので、Markdown の `SKILL.md` の一部には使えない。
文面までそろえる例は、`references/review-threads.md` をファイル全体の組にした `pr-review-handle` と `pr-finalize-loop` である。

- `docs/skill-development.md` の整合パスの節に、この 2 つの選び方を書き足す。
- 機構は作らない。重複のチェックがその場で止めて直し方を示すので、手順の追記で足りる。
