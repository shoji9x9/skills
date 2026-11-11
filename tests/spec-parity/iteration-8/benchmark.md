# Skill Benchmark: spec-parity

**Model**: claude-code / opus / 指定なし（iteration-7 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 2（`with_skill` だけを 1 run ずつ）

## 目的

PR #996 のレビューの 4 回目の指摘への対応で、verify の手順 1・7 と `verify-metadata.json` の雛形の `new.dirty` の取り方を、何も外さない `git -C <新側のリポジトリ> status --porcelain` に戻した後の変更確認である。
変えた手順を読む eval 8・9 を、`with_skill` だけで 1 run 実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill（iteration-7） |
| --- | --- | --- | --- |
| 8 | eval が読む `SKILL.md` の手順 1・7 と雛形 | 7/7 | 7/7 |
| 9 | eval が読む `SKILL.md` の手順 1・7 と雛形 | 6/6 | 6/6 |

すべての run で、`skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。下がった assertion は無い。
どちらの run も、判定の直前に新側の HEAD と作業ツリーの状態を取得し直し、未 commit の変更が無いことを確かめてから判定した。
