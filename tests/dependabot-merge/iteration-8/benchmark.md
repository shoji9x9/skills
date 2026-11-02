# Skill Benchmark: dependabot-merge

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-02
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #705 の変更確認である。GitHub を使う eval の prompt の「gh や git のコマンドは実行せず」を、GitHub に接続するコマンドだけを実行しないよう求め、手元のファイルの読み取りと同梱のスクリプトの実行は許す文に直したので、実行し直した。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。

## 入力の変更

- eval 1・2: prompt の上の文を直した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | あり | 8/8 | 5/8 | 8/8（iteration-7） |
| 2 | あり | 6/6 | 3/6 | 6/6（iteration-7） |

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
