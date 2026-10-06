# Skill Benchmark: parity-suite

**Model**: claude-code / opus（CLI 2.1.290 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 1（eval 38。`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #372 段階 ⑤-a で、eval 38 の assertion の使わない語を新しい語にした（#1・#6 の「写し」を「コピー」）。prompt とスキルは変えていない。

## Summary

| config | pass_rate |
| --- | --- |
| with_skill | 8/8 |
| without_skill | 2/8 |

前回の with_skill から下がった assertion は無い。

## 読み取れたこと

- 語を変えた assertion は、どちらも with_skill だけが合格した（区別している）。前回（iteration-47）落ちた #5 も合格した。
