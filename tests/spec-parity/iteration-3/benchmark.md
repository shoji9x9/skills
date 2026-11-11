# Skill Benchmark: spec-parity

**Model**: claude-code / opus / 指定なし（iteration-2 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 1（`with_skill` だけを 1 run）

## 目的

iteration-2 の eval 6 で下がった assertion を受けて、verify の前提の段落を直した（`parity-replace` を案内してよい条件を、案内より先に書く）後の変更確認である。
直した段落を読む eval 6 だけを、`with_skill` だけで 1 run 実行した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill（iteration-2） |
| --- | --- | --- | --- |
| 6 | なし（スキルの本文） | 3/3 | 2/3 |

run の `skill_usage.read` は true、`invalid_run` は false で、`isolation.txt` は `sandboxed` だった。
1 run どうしなので、直したことで上がったのか、ばらつきなのかは区別できない。区別するには、eval 6 の 3 run が要る（実行するかは依頼者が決める）。
