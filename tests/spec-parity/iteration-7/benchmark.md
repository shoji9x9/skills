# Skill Benchmark: spec-parity

**Model**: claude-code / opus / 指定なし（iteration-6 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 2（`with_skill` だけを 1 run ずつ）

## 目的

PR #996 のレビューの 3 回目の指摘で、eval 8・9 の fixture の `setup.sh`（HEAD の無いリポジトリと grep のエラーの扱い）を変えた後の変更確認である。
fixture が変わった eval 8・9 を、`with_skill` だけで 1 run 実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill（iteration-6） |
| --- | --- | --- | --- |
| 8 | fixture（`setup.sh`） | 7/7 | 7/7 |
| 9 | fixture（`setup.sh`） | 6/6 | 6/6 |

すべての run で、`skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。下がった assertion は無い。
