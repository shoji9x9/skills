# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（前回の run に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #1001 のレビューで、eval 29 の `setup.sh` の「最上位なら git init しない」分岐が、無条件の `git init` と同じ結果になると指摘を受けた。
分岐を消して eval 6 と同じ無条件の `git init` にそろえたので、fixture の変更確認として両方の configuration で 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 29 | fixture | 5/5 | 4/5 | 前回（iteration-44）と同じ |

すべての run で `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean` だった。

## 観察

- 差は、前回と同じく `source-version.mjs` で tree を取る assertion だけである。baseline は `git rev-parse HEAD:new-app` で同じ結論に達した。
