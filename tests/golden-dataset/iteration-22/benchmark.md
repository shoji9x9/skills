# Skill Benchmark: golden-dataset

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-30
**Evals**: 1（`with_skill` と `without_skill` を 3 run ずつ）

## 目的

Issue #705 の項目 2 の benchmark（前回より満たした件数が少なかった eval を 3 run で確かめる）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- 無し（入力を変えずに実行した）

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 8 | なし | 4/9・4/9・4/9 | 7/9・6/9・7/9 | 4/9（iteration-21） |

## 前回より下がったものと、その原因

- eval 8 の原因と対応: fixture の design.md に、後から足された predicate-coverage-check が求める「述語ごとの分岐網羅」の表が無く、チェックが exit 2 で止まる。この変更とは関係しない。fixture を直す作業を後の作業の Issue（#856）に回す。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
