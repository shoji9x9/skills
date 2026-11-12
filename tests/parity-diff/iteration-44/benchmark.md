# Skill Benchmark: parity-diff

**Model**: claude-code / opus / 指定なし（前回の run に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 1（`with_skill` を 1 run）

## 目的

PR #1001 のレビューへの対応で、`references/preflight.md` の「新側のバージョンの一致」（配信型の target と一括の再検証の照合）を変えた。
最初の commit で実行した eval 4 を、変えた後の本文で `with_skill` だけ 1 run 実行し直した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 4 | 無し（スキルの文書） | 4/4 | iteration-43 と同じ |

`isolation.txt` は `sandboxed` だった。
