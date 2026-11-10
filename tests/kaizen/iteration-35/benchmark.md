# Skill Benchmark: kaizen

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-10
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #952 で、eval 1 の assertion が `.kaizen/` とファイルが作られたかを検査していて、prompt が保存先を述べるのでスキルを使わない run も満たすという指摘を直した。
ディレクトリとファイルが作られたかを見る 2 本を消した。代わりに、学びを 1 件だけ記録したか、`confidence` の値、「既存の規約」節の扱いと照合した範囲を見る 4 本を足した。

入力が変わったのは eval 1（assertion）である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | assertion | 8/8 | 2/8 | iteration-9（1 run） |

文が同じ 4 本（frontmatter の欄・節・status と applied-to・根本原因）は、iteration-9 の with_skill も今回もすべて満たした。下がったものは無い。
足した 4 本は文が新しいので、前の記録とは比べない。

## without_skill が満たした assertion

- 「学びを 1 件だけ記録している」: prompt が 1 件を求めるので、スキルが無くても満たす。
- 「個別の失敗ではなく根本原因が記述されている」: 推定の原因を書いた。

## 実行し直した run

最初の run の後に「学びを 1 件だけ記録している」を足したので、その 2 run を捨てて実行し直した。結果を良くするためではなく、入力を変えたためである。
