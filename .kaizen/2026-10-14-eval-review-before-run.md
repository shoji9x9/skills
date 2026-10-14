---
date: 2026-10-14
type: rule
priority: medium
status: pending
applied-to: []
session: claude-code
---

# eval の定義のレビューを終える前に LLM の run を起動し、assertion を直して全 run をやり直した

## 事象

Issue #623 で eval 23・24 を足し、reachability のチェックが通った直後に 4 run（2 eval × 2 config）を起動した。
並行して起動した Sonnet のサブエージェントのレビューが、複数の主張を束ねた assertion（「確認を送らず、BLOCKED にして、#102 に進む」など）を 6 件指摘した。
assertion を主張ごとに分けたので、fingerprint が変わり、4 run をすべてやり直した。

## 根本原因

- なぜ run をやり直したか → assertion を変えると、その run の採点も baseline の再利用もできない
- なぜ assertion を変えたか → 1 つの assertion に複数の主張を束ねていた。`.agents/rules/eval-assertion-discrimination.md` は「1 つの assertion で 1 つのことを主張する」をレビューで確かめる項目に挙げている
- なぜ束ねたまま run したか → 機械のチェック（`check-eval-reachability.ts`）は部分文字列の実在しか見ない。レビューで確かめる 4 点を、run の前に通す手順が無かった。レビューを run と並行に起動したので、指摘が届いたときには run が終わっていた

## 提案

evals.json の assertion を足したり変えたりしたら、rule の「レビューで確かめる 4 点」を通すレビューを終えてから LLM の run を起動し、レビューと run を並行に起動しない。

- 適用先の候補: `.agents/rules/eval-assertion-discrimination.md`「到達できるかを確かめる方法」の 4 点の直後に、「4 点のレビューは run を起動する前に終える」と足す
- 候補（試して採否を決める）: assertion の文に読点で並んだ動詞が 2 つ以上あるものを警告する lint。誤検知率は実データで測ってから決める
