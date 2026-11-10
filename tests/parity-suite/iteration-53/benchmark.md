# Skill Benchmark: parity-suite

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-10
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #952 で、使わない語のカタカナの形（「〜コントロール」）を、SKILL.md・references・assets と eval 12 の assertion から消した。
assertion の文が変わったのは eval 12 の 1 本目（括弧の中の別名を消しただけ）である。
SKILL.md・references・assets の変更も括弧の中の別名と見出しの語だけなので、ほかの eval は実行していない（利用者の判断）。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 12 | assertion | 4/4 | 2/4 | iteration-50（1 run） |

文が同じ 3 本は、iteration-50 の with_skill も今回もすべて満たした。下がったものは無い。
1 本目は文が変わったので、前の記録とは比べない（iteration-50 では with_skill も満たさなかった）。

## 実行し直した run

なし。
