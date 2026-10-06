# Skill Benchmark: issue-start

**Model**: claude-code / opus（CLI 2.1.290 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 1（eval 13。`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #372 段階 ⑤-a で、eval 13 の assertion の使わない語を新しい語にした（「原文を quote に写した」を「転記した」）。prompt とスキルは変えていない。

## Summary

| config | pass_rate |
| --- | --- |
| with_skill | 7/7 |
| without_skill | 2/7 |

前回の with_skill から下がった assertion は無い。

## 読み取れたこと

- 語を変えた assertion は、with_skill だけが合格した（区別している）。
