# Skill Benchmark: multiagent-setup

**Model**: claude-code / opus（harness `run-skill-eval`）
**Date**: 2026-11-03
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #861 で、`references/skills.md` の「スキル作成手順」に、スキルを書く前と書いた後にスキルの有無で同じ依頼を比べる手順を足した。
期待する振る舞いがスキル無しですべて起きたら、スキルを書かずに利用者に確かめる分岐もある。
eval 1（スキルを追加したい）は、この分岐で止まると SKILL.md の作成を確かめる assertion が不合格になるので、変更確認として実行した。
evals.json の prompt と assertion は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | スキル本文 | 4/4 | 2/4 | 4/4（iteration-1） |

with_skill は、スキルが無い状態とスキルを入れた状態で同じ依頼を比べ、スキル無しで起きなかった振る舞いの指示だけを書いた。
止まる分岐には入らず、SKILL.md とシンボリックリンクを作った。

## 前回より下がった eval の切り分け

- 無し。前回の iteration-1 は 3 run で、executor の model の記録が無い（`<model-name>`）。今回は 1 run なので、ばらつきの比較はしていない

## 集計から外したもの

- 無し
