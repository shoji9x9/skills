# Skill Benchmark: parity-replace

**Model**: claude-code / opus（CLI 2.1.290 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 1（eval 23。`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #372 段階 ⑤-a で、eval 23 の assertion の使わない語を新しい語にした（#4 の「ゲート」を「チェック」）。prompt とスキルは変えていない。

## Summary

| config | pass_rate |
| --- | --- |
| with_skill | 5/5 |
| without_skill | 2/5 |

前回の with_skill から下がった assertion は無い。

## 読み取れたこと

- 語を変えた assertion は、without_skill も合格した。この assertion は語を変える前から、完了を取り消さないことだけを確かめる形で、区別しないのは語の変更によるものではない。
- with_skill は 2 回スキルを読まなかった（`invalid_run`）。2 本とも `tests/parity-replace/iteration-31/eval-23/with_skill/run-1` に出力し、採点と集計から外して、同じ条件で実行し直した 3 回目の run に差し替えた。
  SKILL.md と prompt は前回から変えていないので、スキルが選ばれるかのばらつきである。
