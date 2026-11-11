# Skill Benchmark: parity-diff

**Model**: claude-code / opus / 指定なし（直近の iteration-41 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 1（`with_skill` だけを 1 run ずつ）

## 目的

Issue #565（`style_policy: free` と `spec-parity` の追加）で新しく足した eval の変更確認である。`with_skill` だけを 1 run 実行し、`without_skill` と既存の eval は実行していない。新しく足した eval なので、比べる記録は無い。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 30 | 新規 | 5/5 | - |

すべての run で、`skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。
