# Skill Benchmark: spec-parity

**Model**: claude-code / opus / high
**Date**: 2026-11-13
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #1007 で足した eval 11 を実行した。許容として承認された署名の分類の欄を環境ノイズに書き換えた記録で、環境ノイズの承認が無いことを承認待ちにするかを見る。
run は iteration-17 と同じ起動で採り、configuration の組が違うので iteration を分けた。

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 11 | 5/5 | 3/5 |

## 観察

- `with_skill` は、`convergence-check.mjs` の承認待ちの理由から、許容の承認を環境ノイズの承認として数えないと答え、環境ノイズとして承認するか許容に分類し直すかを利用者に求めた。`approvals` には追記しなかった。
- `without_skill` は、`requires_skills` で置いた `parity-diff` の `references/triage.md`「承認の記録（`approvals`）」の照合の規則を読み、2 つ目の assertion を満たした。そのため 2 つ目は区別しない。
- `without_skill` は `convergence-check.mjs` を実行できず（1 つ目）、`parity-replace` への差し戻しを既定にして、分類の承認を求めなかった（3 つ目）。
- 5 つ目（`converged` を `true` にしない）は、fixture の `converged` が `false` なので区別しない。後退の検出のために置く。
