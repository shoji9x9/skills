# Skill Benchmark: pr-review-handle

**Model**: claude-code / opus / high（harness `run-skill-eval`）
**Date**: 2026-11-14
**Evals**: 1（`with_skill` を 1 run）

## 目的

Issue #1030 の PR B で、`review_tool` の値 `claude-code-action` を足し、`SKILL.md` と `references/review-threads.md`・`review-tool.md` を変えた。
`claude-code` のトップレベルのコメントを読む eval 10 が、前と同じ結果になるかを確かめる変更確認である。prompt・fixture・assertion は変えていない。

## Summary

| eval | 今回 | 前回（iteration-13） |
|------|------|------|
| 10 | 4/4 | 4/4 |

## 前回より下がったもの

無し。

## 実行し直した run

無し。

## 集計から外したもの

無し。run は `sandboxed` で、`invalid_run` は無い。
