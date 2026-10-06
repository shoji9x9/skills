# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus（CLI 2.1.290 (Claude Code)、harness `run-skill-eval/3`）
**Date**: 2026-10-06
**Evals**: 6（`with_skill` 1 run）

## 何を変えたか

Issue #372 段階 ④-c で、current-environment-bootstrap の文章を書き方の規約に合わせて書き直した（1af3c8fd）。規則・条件・手順は変えていない。
description の語（来歴）も直した。assertion は変えていない。

## Summary

`with_skill` の平均 pass_rate は 0.878。前回から下がったのは 1（4/5）・3（4/6）・5（4/5）。

## 読み取れたこと

- 1・3 は origin/main のスキルでも同じ assertion で落ちた（ばらつき）。3 は両方の版で、工程 3 で DB 設定が足りないとして止まった。
- 5 は前回の run も `db.seedable` に触れていなかった。前回の採点が緩かった見込みで、書き換えによる回帰の根拠は無い。
