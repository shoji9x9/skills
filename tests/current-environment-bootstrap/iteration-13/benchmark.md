# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-30
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #705 の変更確認（入力を変えた eval を 1 run ずつ）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 2: requires_skills（replace-strategy）を宣言し、--target を渡した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 2 | あり | 5/6 | 0/6 | 4/6（iteration-11） |

## 前回より下がったものと、その原因

- eval 2: 前回は満たし、今回はどの run も満たさなかった assertion がある。
  - キャラクタセット・DB タイムゾーン・バージョン互換パラメータを受領した環境メモの記載を根拠に確定し、環境の既定値で警告なしに補完していない
- eval 2 の原因と対応: #1 と同じく、環境のメモに書かれた DB のタイムゾーンを「不足」にした。1 run どうしの比較なので、回帰かばらつきかは区別できない。#1 の 3 run でも同じ扱いが出ているので、後の作業の Issue で扱う。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
