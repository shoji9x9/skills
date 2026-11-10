---
date: 2026-10-19
type: rule
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# 既存の assertion を残すときは、eval を実行する前に 1 本ずつ今のスキルの取り決めと突き合わせる

## 事象

issue-batch の #689 で、dirty な worktree の片付けを「記録だけなら次の Issue の branch に引き継ぎ、それ以外なら BLOCKED」に変えた。
受け入れ条件の eval（eval 13）を with_skill で実行すると、回答は新しい手順どおりだった。
しかし 1 つ目の assertion は前の手順（「dirty なら BLOCKED」）のままで、新しい手順どおりの回答を落とす形だった。assertion を直し、with_skill と without_skill を実行し直した。

2026-11-10、Issue #918 で pr-review-handle の eval 2 の prompt を、場面を書いて説明させる形に書き直した。
既存の assertion「conventional commits 規約で commit すると述べている」をそのまま残したところ、with_skill が 3 run とも落ちた。
スキルは commit の規約を固定せず、設定の `conventions_doc` か `AGENTS.md` などの文書から決めるからである。
assertion を直し、eval 2 の 6 run を実行し直した。

## 根本原因

1. なぜ実行し直したか → 今のスキルの取り決めと食い違う assertion を、実行する前に見つけなかった。
2. なぜ見つけなかったか → 前からある assertion は確かめ済みとして扱い、新しく書いた assertion だけを原本と突き合わせた。
3. なぜ確かめ済みとして扱ったか → スキルの手順を変えたときも、eval の prompt を書き直したときも、残す assertion を読み直す対象にする手順が無い ← 根本原因

## 根拠

確信度が medium なのは、2 回の事象のきっかけ（手順の変更と prompt の書き直し）は違うが、どちらも残した assertion を原本と突き合わせなかったことに帰着するからである。
Issue #918 では、採点の後に with_skill の 3 run がそろって落ちたことで食い違いに気付いた。
KEDB 照合（「既存の assertion」「evals.json」）で、このノートだけが一致した。

## 既存の規約

- 扱い: 埋もれている
- 場所: `.agents/rules/eval-assertion-discrimination.md`「原本と合っているか」。対象を「assertion を書いた時点」としていて、書き直しで残す assertion を含めていない
- 照合した範囲: `.agents/rules/`・`docs/skill-development.md` を「既存の assertion」で検索した

## 食い違い

- 相手: なし
- 判断: なし

## 提案

eval の入力かスキルの手順を変えたら、実行する前に、その eval に残すすべての assertion を今の `SKILL.md` と `references/` に突き合わせ、取り決めに無い振る舞いを求める assertion を直してから実行する。

- 反映先: `.agents/rules/eval-assertion-discrimination.md`「原本と合っているか」に、書き直しで残す assertion と、手順を変えたスキルの eval の assertion も対象だと足す。
- 手順を変えたときは、変えた振る舞いの語（「BLOCKED にする」など）で `evals.json` の assertion を grep し、旧い振る舞いを答えにしている assertion を挙げる。
