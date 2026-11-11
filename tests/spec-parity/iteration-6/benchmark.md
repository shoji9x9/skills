# Skill Benchmark: spec-parity

**Model**: claude-code / opus / 指定なし（iteration-5 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 2（`with_skill` だけを 1 run ずつ）

## 目的

PR #996 のレビューの 2 回目の指摘で、verify の手順 1・7 の `new.commit` と `new.dirty` の取り方（新側のリポジトリで取り、verify が書く場所だけを外す）と、eval 8・9 の fixture の `setup.sh` を変えた後の変更確認である。
変えた手順と fixture を使う eval 8・9 を、`with_skill` だけで 1 run 実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill（iteration-5） |
| --- | --- | --- | --- |
| 8 | fixture（`setup.sh`） | 7/7 | 7/7 |
| 9 | fixture（`setup.sh`） | 6/6 | 6/6 |

すべての run で、`skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。下がった assertion は無い。
