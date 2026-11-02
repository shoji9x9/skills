# Skill Benchmark: dependabot-merge

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-30
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #705 の変更確認（入力を変えた eval を 1 run ずつ）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 1: 取得できた PR の状態を prompt に書いた。
- eval 2: 取得できた PR の状態を prompt に書いた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | あり | 8/8 | 5/8 | 7/8（iteration-6） |
| 2 | あり | 6/6 | 3/6 | 4/6（iteration-6） |

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
