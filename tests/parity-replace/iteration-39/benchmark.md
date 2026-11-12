# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（直近の iteration-37 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-12
**Evals**: 2（`with_skill` を 1 run ずつ）

## 目的

新側のバージョンの照合を、`new.commit` から `.replace/` を除いたソースのツリーのハッシュ（`new.tree`）に変えた（Issue #998）。
eval 6 の prompt と fixture（`lightweight-deploy-target` に `new.tree` を足した）、eval 27 の assertion 3（`new.commit` を `new.tree` にした）を変えたので、変更確認として `with_skill` で 1 run ずつ実行した。
eval 29 は configuration の組が違うので、iteration-38 に分けた。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 6 | prompt・fixture | 4/4 | 文が同じ assertion 4 件は前回（iteration-37）も pass |
| 27 | assertion 3 | 6/6 | 文が同じ assertion 5 件は前回（iteration-36）も pass。assertion 3 は文を変えたので比べない |

すべての run で `isolation.txt` は `sandboxed` だった。下がった assertion は無い。
