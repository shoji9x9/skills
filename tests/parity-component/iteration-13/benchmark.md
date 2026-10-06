# Skill Benchmark: parity-component

**Model**: claude-code / opus（CLI 2.1.289 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 8（`with_skill` 1 run）

## 何を変えたか

Issue #372 段階 ④-b で、parity-component の文章を書き方の規約に合わせて書き直した（4b506877）。規則・条件・手順は変えていない。
description の語（差分器）も直した。assertion の語を直した 8・9 は iteration-14 に分けた。

## Summary

`with_skill` の平均 pass_rate は 0.975。前回から下がったのは 4（4/5）だけ。

## 読み取れたこと

- 4 は origin/main のスキルでも同じ assertion（golden-dataset のフェーズ A を促す）で落ちた（ばらつき）。促す文は書き換え前から本文に無い。
