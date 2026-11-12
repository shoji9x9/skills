# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（直近の iteration-37 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

新側のバージョンの照合を、`new.commit` から `.replace/` を除いたソースのツリーのハッシュ（`new.tree`）に変えた（Issue #998）。
記録と新側が同じリポジトリにあり、記録を commit して HEAD が進んだ構成で、軽量な手順を当てられるかを確かめる eval 29 を足したので、両方の configuration で 1 run ずつ実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 29 | 新しい eval | 5/5 | 4/5 | 無し（新しい eval） |

すべての run で `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean` だった。

## 観察

- 差が出たのは assertion 1（同梱の `source-version.mjs` で今の `new.tree` を取る）だけである。baseline は `git rev-parse HEAD:new-app` と `git status` で比べ、同じ結論（当てられる）に達した。
- assertion 2〜5 は baseline も満たした。結論だけを見る assertion は、この fixture ではスキルの有無で差が出ない。
