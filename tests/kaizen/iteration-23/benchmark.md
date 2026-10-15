# Skill Benchmark: kaizen

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-15
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #614 で、evals.json の assertion の全角ダッシュを 2 つ続けた記号（U+2014 の連続）を書き換えた（意味を変えない表記の変更）。
入力が変わったのは eval 24 だけである。スキル本文（SKILL.md・references）は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 24 | assertion | 6/6 | 1/6 | 6/6（iteration-22） |

with_skill の平均 pass_rate は 1.00、without_skill は 0.17。

## 前回から変わった assertion

- `with_skill` は変わっていない。
- `without_skill` の 6 行目（提案の文面の語で判定しない理由）が、iteration-22 の F から P になった。
  01 と 02 の提案はどちらも仕組みと文書の両方に触れているので、キーワードで拾うと誤検出と見逃しが両方出る、と述べていた（要約）。境界の判定である。

## 差が消えた assertion

- 6 行目は、この run で `without_skill` も満たした。1 run の結果なので、確定ではない。
- 1〜5 行目は差が残っている。`without_skill` は同梱の検査を見つけられず、自作のスクリプトで代わりに判定していた。

## 集計から外したもの

- 無し
