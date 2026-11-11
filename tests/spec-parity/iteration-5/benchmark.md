# Skill Benchmark: spec-parity

**Model**: claude-code / opus / 指定なし（iteration-4 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 2（`with_skill` だけを 1 run ずつ）

## 目的

eval 8・9 の fixture（`verify-unapproved`・`verify-overflow`）に、新側のリポジトリを git で作り、記録の `commit` をその HEAD にそろえる `setup.sh` を足した後の変更確認である。
fixture が変わった eval 8・9 を、`with_skill` だけで 1 run 実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill（iteration-4） |
| --- | --- | --- | --- |
| 8 | fixture（`setup.sh`） | 7/7 | 7/7 |
| 9 | fixture（`setup.sh`） | 6/6 | 5/6 |

すべての run で、`skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。
どちらの run も、手順 7 で新側の HEAD が記録の `new.commit` と同じで作業ツリーが clean であることを確かめてから、`convergence-check.mjs --write` を実行した。
