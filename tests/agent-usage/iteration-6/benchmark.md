# Skill Benchmark: agent-usage

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-30
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #705 の変更確認（入力を変えた eval を 1 run ずつ）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 2: 複数の主張を 1 本にまとめた assertion を分けた。
- eval 2: 文が変わった・新しい assertion 2 件は、前回と比べていない。
- eval 3: 指示どおりコマンドを実行していないことを確かめる assertion を足した。
- eval 3: 文が変わった・新しい assertion 1 件は、前回と比べていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 2 | あり | 6/6 | 0/6 | 4/5・5/5・4/5（iteration-4） |
| 3 | あり | 4/5 | 2/5 | 4/4・4/4・4/4（iteration-4） |

## 前回より下がったものと、その原因

- eval 3 の原因と対応: with_skill の run が、「コマンドの実行はせず」の指示に反して grep でスクリプトを読んだ。足した assertion がこれを検出した。この変更とは関係しない。後の作業の Issue（#856） で扱う。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
