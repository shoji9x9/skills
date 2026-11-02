# Skill Benchmark: browser-test

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-30
**Evals**: 1（`with_skill` と `without_skill` を 3 run ずつ）

## 目的

Issue #705 の項目 2 の benchmark（前回より満たした件数が少なかった eval を 3 run で確かめる）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 5: 既存の設定ファイルを fixture に置き、非破壊の assertion を skill-config.mjs の append で書く方針を確かめる形にした。
- eval 5: 文が変わった・新しい assertion 1 件は、前回と比べていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 5 | あり | 4/4・4/4・3/4 | 2/4・2/4・2/4 | 3/4（iteration-6） |

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
