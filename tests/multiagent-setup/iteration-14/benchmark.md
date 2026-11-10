# Skill Benchmark: multiagent-setup

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-10
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #952 で、eval 2・3 の assertion が成果物の有無を検査していて、スキルを使わない run も満たすという指摘を直した。

- eval 2: `AGENTS.md` と `.agents/` が作られたかを見る 2 本を、`CLAUDE.md` が `AGENTS.md` を参照すること・共通の内容を複製しないことの 2 本に替えた
- eval 3: 「`.agents/rules/<name>.md` が作成されている」を、ルールの本体の置き場所を見る文に替えた

入力が変わったのは eval 2・3（assertion）である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 2 | assertion | 4/4 | 3/4 | 記録なし |
| 3 | assertion | 7/7 | 0/7 | iteration-2（3 run） |

eval 2 は、これより前の iteration に結果が無いので、比べる記録は無い。
eval 3 の文が同じ assertion は、iteration-2 の with_skill（3 run）も今回もすべて満たした。下がったものは無い。

## without_skill が満たした assertion

- eval 2: 足した `CLAUDE.md` の 2 本と、「ユーザー設定は変更されていない」。without_skill も `CLAUDE.md` に `@AGENTS.md` を書いた。
  1 run では、この 2 本でスキルの有無を区別できないとは決められない。スキルの有無は、参照ガイドの節の有無で分かれた。

## 実行し直した run

eval 3 は、最初の run の後に置き場所の assertion を足したので、その 2 run を捨てて実行し直した。結果を良くするためではなく、入力を変えたためである。
