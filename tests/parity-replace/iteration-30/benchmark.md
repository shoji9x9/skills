# Skill Benchmark: parity-replace

**Model**: claude-code / opus（CLI 2.1.290 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 24（`with_skill` 1 run）

## 何を変えたか

Issue #372 段階 ④-c で、parity-replace の文章を書き方の規約に合わせて書き直した（1af3c8fd）。規則・条件・手順は変えていない。
description と assertion は変えていない。

## Summary

`with_skill` の平均 pass_rate は 0.981。前回から下がったのは 8（4/5）・16（4/5）。

## 読み取れたこと

- 8・16 は origin/main のスキルでも同じ assertion で落ちた（ばらつき）。
- 21 の承認（`approved_by` / `approved_at`）に触れた回数は、origin/main では 3 回中 2 回、書き換え後は 4 回中 0 回だった。
  書き換えで承認の文が記録の箇条から別の箇条に分かれていたので、記録の箇条に戻した。直した版では 3 回中 2 回になり、そのうちの 1 run（6/6）に差し替えた。
- 11 は 2 回ともスキルを読まなかった（`invalid_run`）。origin/main のスキルでも 2 回とも読まなかった。description は変えていないので、スキルが選ばれるかのばらつきである。iteration から外した。
