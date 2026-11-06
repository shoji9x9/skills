---
date: 2026-10-14
type: rule
priority: high
confidence: high
status: pending
applied-to: []
session: claude-code
---

# eval の定義のレビューを終える前に LLM の run を起動し、assertion を直して全 run をやり直した

## 事象

Issue #623 で eval 23・24 を足し、reachability のチェックが通った直後に 4 run（2 eval × 2 config）を起動した。
並行して起動した Sonnet のサブエージェントのレビューが、複数の主張を束ねた assertion（「確認を送らず、BLOCKED にして、#102 に進む」など）を 6 件指摘した。
assertion を主張ごとに分けたので、fingerprint が変わり、4 run をすべてやり直した。

再発（2026-10-15、Issue #614）: eval 3・4 の prompt に問いを足す案を書き、規約の観点のレビューを通す前に利用者に承認を求めた。
承認の後のレビューが、案が判断の軸を baseline に渡すことと、`--target` が無いことを指摘した。案を作り直して、もう一度承認を求めた。
2 回目のレビューでも、fixture と assertion に指摘が続いた。

再発（2026-10-21、Issue #741）: eval 30 を足し、reachability のチェックが通った後に、4 点のレビューを通さずに run を起動した。
assertion「branch・worktree・PR・manifest を作らず、担当者を割り当てないと述べている」の prompt_quote は、その点を問わない文を指していた。
with_skill が 7/8 になり、prompt に問いを足して eval 30 を実行し直した（iteration-28）。

## 根本原因

- なぜ run をやり直したか → assertion を変えると、その run の採点も baseline の再利用もできない
- なぜ assertion を変えたか → 1 つの assertion に複数の主張を束ねていた。`.agents/rules/eval-assertion-discrimination.md` は「1 つの assertion で 1 つのことを主張する」をレビューで確かめる項目に挙げている
- なぜ束ねたまま run したか → 機械のチェック（`check-eval-reachability.ts`）は部分文字列の実在しか見ない。レビューで確かめる 4 点を、run の前に通す手順が無かった。レビューを run と並行に起動したので、指摘が届いたときには run が終わっていた

## 根拠

同じ原因での再発を確かめた（部分文字列のチェックだけを通し、引き出す文があるかのレビューを run の前に通さなかった）。
2026-10-14 の事象（#623）と 2026-10-15 の事象（#614）に、2026-10-21 の事象（#741）が続く。

## 提案

evals.json の assertion を足したり変えたりしたら、rule の「レビューで確かめる 4 点」を通すレビューを終えてから LLM の run を起動し、レビューと run を並行に起動しない。

- 適用先の候補: `.agents/rules/eval-assertion-discrimination.md`「到達できるかを確かめる方法」の 4 点の直後に、「4 点のレビューは run を起動する前に終える」と足す
- 候補（試して採否を決める）: assertion の文に読点で並んだ動詞が 2 つ以上あるものを警告する lint。誤検知率は実データで測ってから決める
- eval の定義（prompt・assertion・fixture）の案を利用者に示して承認を求めるときも、観点のレビューを先に終え、指摘を反映した案を示す。承認した案を後から変えると、利用者に同じ判断を 2 度求めることになる
