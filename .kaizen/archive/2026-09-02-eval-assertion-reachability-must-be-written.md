---
date: 2026-09-02
type: rule
priority: high
status: applied
applied-to: [.agents/rules/eval-assertion-discrimination.md]
session: claude-code
---

# 新規 assertion の到達性は「引き出す文」を書き出して確かめる（自問で済ませない）

## 事象

Issue #277 の eval 追加で、`parity-diff` eval 19 の assertion 5
「測り直す組は同じ `noise-pass2/` へ撮り直す」を、**それを引き出す文が prompt に無いまま確定させた**。
with_skill の 1 回目 run が当該項目だけ未言及で 4/5 になり、prompt に問いを足して
with / without の 2 run を捨てて取り直した。

## 根本原因

- なぜ到達しなかった? → assertion 5 を引き出す文が prompt に無かった
  - なぜ気付かなかった? → 確定前に見たのは**弁別**（baseline が満たせないか）だけで、
    到達性は「答えられそう」と内心で済ませた
    - なぜ? → `.agents/rules/eval-assertion-discrimination.md` の到達性検証が
      「1 本ずつ自問し、答えられるか確かめる」という**内心の手続き**で、
      書き出す成果物が無い。抜けても誰にも見えない ← 根本原因（対策可能）

KEDB 照合: [[2026-08-12-eval-prompt-change-breaks-assertion-reachability]]（`status: applied`・既に 3 件記録）と
同じ rule の同じ節。applied ノートには追記せず、恒久側（rule）を更新した。

横断スコープ: 対象は `skills/*/evals/**` に閉じ、既存 rule の `paths` に収まる。

## 提案（恒久側の更新）

`.agents/rules/eval-assertion-discrimination.md`「到達性の検証手段」を、対応表を**書き出す**要求に変えた:

- assertion を追加・変更したら、その eval の全 assertion について
  「引き出す prompt の文」を**引用して並べた対応表を作る**。
  引用を書けない assertion は prompt に問いを足すか落とす。run を回すのはその後。
