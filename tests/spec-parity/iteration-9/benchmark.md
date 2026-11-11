# Skill Benchmark: spec-parity

**Model**: claude-code / opus / 指定なし（iteration-8 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 2（`with_skill` だけを 1 run ずつ）

## 目的

PR #996 の手元のレビュー（`/code-review high`）の指摘への対応で、verify の手順 1 の `new.dirty` の説明（`.gitignore` で無視されないパス）、雛形の `new.dirty`、eval 8・9 の fixture の `setup.sh`（`new-app` がリポジトリの最上位かを確かめる・置き換えの後の grep の終了コード）を変えた後の変更確認である。
変えた手順と fixture を使う eval 8・9 を、`with_skill` だけで 1 run 実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill（iteration-8） |
| --- | --- | --- | --- |
| 8 | fixture（`setup.sh`）と、eval が読む `SKILL.md` の手順 1 と雛形 | 7/7 | 7/7 |
| 9 | fixture（`setup.sh`）と、eval が読む `SKILL.md` の手順 1 と雛形 | 6/6 | 6/6 |

すべての run で、`skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。下がった assertion は無い。
どちらの run も、判定の直前に新側の HEAD と作業ツリーの状態を取得し直し、未 commit の変更が無いことを確かめてから判定した。
