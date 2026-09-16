---
date: 2026-09-16
type: hook
priority: high
status: pending
applied-to: []
session: claude-code
---

# assertion の到達性は文章規約でなく決定論的ゲートで要求する

## 事象

Issue #389 の eval 36 で assertion 6 を「present は見た目の担保ではない／導出が出すのは集合まで／
見た目の合否は画素比較と特性照合が出す」と 3 主張を束ねて書いた。prompt は「撮る状態をどう決めて
何をどこに残すか」「あとで状態を足したら何が起きるか」しか聞いておらず、3 つ目を引き出す文が無い。
`with_skill` が 2 run とも同じ箇所で落ち、うち 1 run は「修正の効果確認」として追加で回したぶん。
さらに落ちた原因を assertion 側の欠陥と切り分けられず「問われていないことを要求している」と擁護し、
ユーザーの是正（「無理がある」）を要した。

## 根本原因

- なぜ 2 run とも同じ箇所で落ちた? → assertion 6 の 3 つ目の主張を引き出す文が prompt に無い（到達不能）
  - なぜ気付かず確定させた? → assertion 追加時に、全 assertion について
    「引き出す prompt の文」を引用して並べた対応表を書かなかった
    - なぜ書かなかった? → その要求は `.agents/rules/eval-assertion-discrimination.md` の
      文章にしかなく、書いた証拠を残す場所も、書いていないことを検出する仕組みも無い。
      eval を足す commit は lint も test も素通りする ← 根本原因（対策可能）

KEDB 照合: [[2026-09-02-eval-assertion-reachability-must-be-written]]（`status: applied`）と同一の失敗。
その記録自身が [[2026-08-12-eval-prompt-change-breaks-assertion-reachability]] を「既に 3 件記録」と
書いており、規約を文章で強めた後の再発にあたる。applied ノートには追記しない。
[[2026-09-16-prose-rule-recurrence-needs-deterministic-gate]]（`status: pending`）が、この場合は同じ規約を
書き足さず決定論的ゲートへ上げよと言っている。

横断スコープ: 対象は `skills/*/evals/evals.json` 全体（parity-suite だけでなく全スキル）。
現存する全 eval が対応表を持たないため、ゲート導入には backfill が要る。

## 提案

eval の assertion は、それを引き出す prompt の文を機械検査できる形で併記し、検査に通らない eval を commit させない。

- 各 eval に `reachability` を足す。要素は
  `{ "assertion": "<assertion のテキスト>", "prompt_quote": "<その eval の prompt 内に実在する部分文字列>" }`
- `scripts/check-eval-reachability.js` を新設し、lefthook pre-commit と CI の `Lint` ジョブへ入れる。
  fail 条件: 対応要素が無い / `prompt_quote` が空 / `prompt_quote` が prompt の部分文字列でない /
  `assertion` がその eval の assertions に無い（テキスト一致。位置で対応づけない）
- 限界を明記する: 複数主張を束ねた assertion は 1 主張ぶんの引用で通る。compound 自体は検出しないので
  「1 assertion 1 主張」はレビュー観点として rule に残す
- backfill のコストが大きいため、apply 時に「全 eval を一度に / 変更した eval から段階的に」を決める
