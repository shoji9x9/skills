# Skill Benchmark: golden-dataset

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-02
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

PR #863 のレビュー（反復 1）の指摘で、eval 8 の prompt と網羅の検査を直した後の変更確認である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 8: prompt から投入先のパス（`content/works`）を外し、「投入先がテスト用のデータであることは確認済みで、書き換えてよい」にした。
  パスを書くと、assertion 2（投入先を `dataset_static_paths` の下と判定する）の答えを渡すことになるためである。
- 網羅の検査（`predicate-coverage-check.mjs`）が `/` と `／` で区切らないのを、features.md の「テーブル」「参照テーブル」の列だけにした。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 8 | あり | 9/9 | 6/9 | 8/9（iteration-24） |

## 変更の効果

- with_skill は、同梱の `skill-config.mjs` で `dataset_mode` と `dataset_static_paths` を読み、投入先を設定から決めた。
- without_skill は、既存の投入ツールにある出力先をそのまま使い、設定から投入先を決めなかった（assertion 2 を満たさない）。prompt からパスを外しても、差が残ることを確かめた。

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はスキルを読み、without_skill の汚染の判定は `clean` だった）
