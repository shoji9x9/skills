# Skill Benchmark: parity-component

**Model**: claude-code / opus（CLI 2.1.290 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 1（eval 9。`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #372 段階 ⑤-a で、eval 9 の assertion の使わない語を新しい語にした（#1・#10 の「壊れうる」「壊れる処理」を「不具合を起こしうる」「不具合を起こす処理」）。prompt とスキルは変えていない。

## Summary

| config | pass_rate |
| --- | --- |
| with_skill | 11/11 |
| without_skill | 2/11 |

前回の with_skill から下がった assertion は無い。

## 読み取れたこと

- 語を変えた assertion は、どちらも with_skill だけが合格した（区別している）。
