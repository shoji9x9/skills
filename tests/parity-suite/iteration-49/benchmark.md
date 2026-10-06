# Skill Benchmark: parity-suite

**Model**: claude-code / opus（CLI 2.1.290 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 1（eval 38。`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #372 段階 ⑤-a で、eval 38 の assertion の使わない語を新しい語にした（#1・#6 の「写し」を「コピー」）。prompt とスキルは変えていない。

## Summary

| config | pass_rate |
| --- | --- |
| with_skill | 7/8 |
| without_skill | 2/8 |

前回（iteration-47）の with_skill から下がったのは #3 だけである。

## 読み取れたこと

- 語を変えた assertion は、どちらも with_skill だけが合格した（区別している）。前回（iteration-47）落ちた #5 は合格した。
- #3 は VERSION が上がったことに触れず、不合格だった（前回は「VERSION 6」と明記して合格）。スキルと #3 の文は変えていないので、実行ごとのばらつきである。
