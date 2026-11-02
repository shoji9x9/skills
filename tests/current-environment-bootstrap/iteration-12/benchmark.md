# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-30
**Evals**: 2（`with_skill` と `without_skill` を 3 run ずつ）

## 目的

Issue #705 の項目 2 の benchmark（前回より満たした件数が少なかった eval を 3 run で確かめる）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 1: requires_skills（replace-strategy）を宣言し、--target を渡した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | あり | 2/5・3/5・1/5 | 0/5・0/5・0/5 | 2/5（iteration-11） |
| 3 | なし | 8/8・8/8・8/8 | 3/8・2/8・3/8 | 7/8（iteration-11） |

## 前回より下がったものと、その原因

- eval 1 の原因と対応: スキーマのヘッダに書かれたタイムゾーンを、どの層の値か分からないとして「不足」にした。スキルは階層ごとの確認を文字コードと照合順序に求めているが、run がタイムゾーンにも広げた。この変更とは関係しない。スキルの記述を直すかを、後の作業の Issue（#856）で決める。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
