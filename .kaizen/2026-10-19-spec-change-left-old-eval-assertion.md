---
date: 2026-10-19
type: rule
priority: low
status: pending
applied-to: []
session: claude-code
---

# スキルの手順を変えたら、eval を実行する前に、変えた手順を前提にした既存の assertion を挙げて直す

## 事象

issue-batch の #689 で、dirty な worktree の片付けを「記録だけなら次の Issue の branch に引き継ぎ、それ以外なら BLOCKED」に変えた。
受け入れ条件の eval（eval 13）を with_skill で実行すると、回答は新しい手順どおりだった。
しかし 1 つ目の assertion は前の手順（「dirty なら BLOCKED」）のままで、新しい手順どおりの回答を落とす形だった。assertion を直し、with_skill と without_skill を実行し直した。

## 根本原因

1. なぜ実行し直したか → 変えた手順と食い違う assertion を、実行する前に見つけなかった。
2. なぜ見つけなかったか → eval の入力を変えていないので、assertion を読み直す対象にしなかった。
3. なぜ対象にしなかったか → 手順を変えたときに、その手順の旧い振る舞いを答えとして持つ assertion を探す手順が無い ← 根本原因

## 提案

スキルの手順の振る舞いを変えたら、eval を実行する前に、変えた振る舞いの語（「BLOCKED にする」など）で evals.json の assertion を grep し、旧い振る舞いを答えにしている assertion を直してから実行する。

- 反映先の候補: `docs/skill-development.md` の「実走の既定スコープ」の、起動の前に書き出す項目に足す。
- KEDB 照合: 「assertion」+「手順を変え」、「assertion」+「取り決めを変え」で照合し、一致は無かった。
