# Skill Benchmark: issue-batch

**Model**: claude-code / opus
**Date**: 2026-10-18
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #676 で、全体 preflight の 10 に、不確実性の高い Issue を対象から外すことを提案する判断を足した。
兆候を 4 つ挙げ、2 つ以上に当たる Issue を外す候補にする。外した Issue は `EXCLUDED` にし、branch と worktree を作らない。
これを測る eval 25 を新しく足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill |
| --- | --- | --- | --- |
| 25 | 新規 | 7/7 | 3/7 |

## 備考

- without_skill は #105 を自分の判断で対象外にし、利用者に外すかを確かめなかった。#106 も保留にした。
- with_skill は、1 つの記述を 2 つの兆候に数えない取り決めに従い、範囲の兆候を数えなかった。
