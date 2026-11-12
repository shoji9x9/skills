# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（前回の run に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 2（`with_skill` を 1 run ずつ）

## 目的

PR #1001 のレビューへの対応で、軽量な手順の「稼働中のコミットの確認」（`SKILL.md`）を変えた。
最初の commit で実行した eval 6・29 を、変えた後の本文で `with_skill` だけ 1 run ずつ実行し直した。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 6 | 無し（スキルの文書） | 3/4 | iteration-39 は 4/4。assertion 2 が fail |
| 29 | 無し（スキルの文書） | 5/5 | iteration-38 と同じ |

すべての run で `isolation.txt` は `sandboxed` だった。

## 観察

- eval 6 の fail は、スキルの変更が原因である。確かめる commit を「今の `new.commit`」（`source-version.mjs` で取る値）にしたが、fixture に新側のリポジトリが無かった。
  run は値を取れず、prompt が書いた短い commit を確かめる対象にしなかった。assertion 2 はその短い commit を名指しすることを求めていた。
- そこで eval 6 の fixture に `setup.sh` を足して新側を git のリポジトリにし、prompt と assertion 2 を直した。直した後の結果は iteration-41 にある。
