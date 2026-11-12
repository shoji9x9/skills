# Skill Benchmark: spec-parity

**Model**: claude-code / opus / high
**Date**: 2026-11-12
**Evals**: 2（`with_skill` を 1 run ずつ）

## 目的

Issue #1003 で、spec-parity の文書（`references/runtime-errors.md`・`design-review.md`・`convergence.md`・`SKILL.md`）と収束の判定を変えた。
eval 8・9 の fixture の `setup.sh` の注記も変わったので、変更確認として `with_skill` を 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill（iteration-13） |
| --- | --- | --- | --- |
| 8 | fixture（`setup.sh` の注記） | 7/7 | 7/7（同じ） |
| 9 | fixture（`setup.sh` の注記） | 6/6 | 6/6（同じ） |

どちらの run も `isolation.txt` は `sandboxed` だった。assertion ごとの合否も、前回の with_skill と同じである。

## 観察

- eval 8 は、承認の記録が無いデザインの指摘と人による確認を、利用者に聞いて止まった。
- eval 9 は、`/orders` の幅 375 のはみ出しを `parity-replace` へ差し戻し、`verify.md` に差し戻す内容を書いた。
