---
date: 2026-11-17
type: doc
priority: medium
confidence: medium
status: pending
applied-to: []
session: claude-code
---

# スキルと fixture が固まる前に eval を起動し、run を 2 回捨てた

## 事象

Issue #1067 で eval 11 を足し、SKILL.md と fixture を書き終えた直後に with_skill と without_skill の run を起動した。
run の最中に SKILL.md の例を 1 行直したので、with_skill を 1 回実行し直した。
その後、push 前のローカルのレビュー（`/code-review --fix`）が SKILL.md の 2 か所と fixture の diff の hunk ヘッダを直した。
スキルと fixture が run の時点と変わったので、両方の config を実行し直した（合わせて 3 run を捨てた）。

## 根本原因

- なぜ run を捨てたか → run の後で、run の入力（スキルの本文と fixture）が変わった
- なぜ run の後で入力が変わったか → run を起動した後に、自分の追記と push 前のローカルのレビューで、スキルと fixture を直した
- なぜレビューの前に run を起動したか → `docs/skill-development.md`「スキルを追加・修正する」の手順は eval の実行（手順 5）の後に PR とレビュー（手順 7）を置き、push 前のローカルのレビューの位置を書いていない。eval を実行する時点が「スキルと fixture が固まった後」だと決まっていない

## 根拠

1 回の観測だが、捨てた 3 run はどれも、run の後にスキルか fixture を直したことで起きたので、原因を 1 つに絞れる。
KEDB 照合（語: eval・実行し直・code-review）では `2026-10-14-eval-review-before-run.md`（applied）が近い。
この学びが扱うのは eval の定義（assertion と prompt）の 4 点のレビューと run の順序で、スキルの本文と fixture をレビューで直す場合は扱っていない。

## 既存の規約

- 扱い: なし
- 場所: なし（近い規約は `.agents/rules/eval-assertion-discrimination.md`「到達できるかを確かめる方法」の「4 点のレビューは、LLM の run を起動する前に終える」。対象は eval の定義だけである）
- 照合した範囲: `AGENTS.md`・`docs/`・`.agents/rules/`・`skills/issue-start`・`skills/pr-finalize-loop` を、語「eval を実行する前」「run を起動する前」「レビューと run」「code-review」で検索した

## 食い違い

- 相手: なし
- 判断: なし

## 提案

`docs/skill-development.md`「スキルを追加・修正する」の手順 5 に、push 前のローカルのレビュー（`/code-review --fix` など）をするなら、それを終えてスキルと fixture を直し終えてから eval を起動する、と書く。

- 足す文の案: 「eval は、スキルと fixture の変更を終えてから起動する。push 前にローカルでレビューするなら、その修正を反映した後に起動する。run の後でスキルか fixture を変えたら、その入力を使う eval を実行し直す。」
- 機構は作らない。1 回の観測で、同じ種類の誤りの繰り返しを確かめていないため
