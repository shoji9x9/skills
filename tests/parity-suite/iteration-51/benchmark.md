# Skill Benchmark: parity-suite

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-08
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #571 で、`references/baseline.md`「状態を変えるスイートは 2 回続けて緑にする」と SKILL.md の手順 9 に、
`repeat_run.cleanup_in_suite` の記録と、`true` でなければ `--stage suite` でも失敗する条件を書いた。
チェックは記録した値だけを読み、戻す操作がスイートの中にあるかは確かめないことも書いた（ローカルのレビューの指摘を反映した後の文面で測った）。
eval 40 の入力（prompt・assertion）は変えていない。

## Summary

| eval | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 40 | 7/7 | 4/7 | 5/7（iteration-50） |

- with_skill は、`cleanup_in_suite` が `true` でないことと `runs` が 2 件に満たないことで exit 1 になり、`--stage suite` でも外れないと説明した（iteration-50 で落ちた assertion #5・#6 を満たした）。
  `true` と書けば通ってしまうので、戻す操作の有無はレビューで見るとも説明した。
- without_skill は、機械的に止めるものは無いと答え、#4・#5・#6 を満たさなかった。
- iteration-50 の without_skill は reasoning effort が未指定で再利用の条件を満たさないため、新しく実行した。
