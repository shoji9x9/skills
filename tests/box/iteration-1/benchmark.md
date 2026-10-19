# Skill Benchmark: box

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-18
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わったのは eval 1（assertion）である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | assertion | 2/5 | 0/5 | 記録なし |

with_skill の平均 pass_rate は 0.40、without_skill は 0.00。

## with_skill で満たさなかった assertion

- eval 1: Box の認証情報が無く、`box-token.sh` が exit 1 になった。#625 の変更とは関係しないので、別の Issue で扱う。
  - `https://api.box.com/2.0/folders/<id>/items` を curl で叩いている
  - Authorization: Bearer ヘッダを付けている
  - marker ベース（usemarker=true / next_marker）で全ページを辿ることに触れている

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
