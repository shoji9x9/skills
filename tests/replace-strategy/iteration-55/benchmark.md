# Skill Benchmark: replace-strategy

**Model**: claude-code / opus / high（iteration-54 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 3（`with_skill` だけを 1 run ずつ）

## 目的

PR #996 の変更確認である。iteration-54 の後に、setup の手順 6 の `style_policy` の説明・`references/status.md`・`procedure-staleness-check.mjs` の `free` の扱いを変え、eval 43 の fixture（`verify-metadata.json` に `new.dirty: false`）を変えた。
変更が影響する eval 40・41（setup の手順 6）と 43（status）だけを、依頼に従って `with_skill` だけで 1 run 実行した。`without_skill` と eval 42（issues）は実行していない。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill（iteration-54） |
| --- | --- | --- | --- |
| 40 | なし（スキルの本文） | 6/6 | 6/6 |
| 41 | なし（スキルの本文） | 5/5 | 5/5 |
| 43 | fixture（`verify-metadata.json` に `new.dirty: false`） | 6/6 | 6/6 |

すべての run で、`skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。下がった assertion は無い。
