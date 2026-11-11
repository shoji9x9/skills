# Skill Benchmark: parity-replace

**Model**: claude-code / opus / 指定なし（直近の iteration-35 に合わせた）（harness `run-skill-eval/5`）
**Date**: 2026-11-11
**Evals**: 2（`with_skill` だけを 1 run ずつ）

## 目的

Issue #993 で `parity-replace` の `SKILL.md` と `references/` に `style_policy: free` の分岐を足した。
`style_policy: reproduce` の手順が変わらないことを確かめるために、入力を変えていない既存の eval 6（軽量な手順と配信型の target）と eval 23（完了の報告と `parity-diff` の案内）を、`with_skill` だけで 1 run ずつ実行した。
iteration-36 と configuration の組が違うので、iteration を分けた。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 6 | なし | 4/4 | 4/4（iteration-34） |
| 23 | なし | 5/5 | 5/5（iteration-31） |

どちらの run も `isolation.txt` は `sandboxed`、`skill_usage.read` は true だった。下がった assertion は無い。

## 観察

- eval 6 は `style_policy` が無い設定を `reproduce` として扱い、`free` の分岐に入らなかった。
- eval 23 は完了の報告で `parity-diff --feature order-list --target local-dev` を案内し、`spec-parity` には触れなかった。
