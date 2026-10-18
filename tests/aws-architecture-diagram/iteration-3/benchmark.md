# Skill Benchmark: aws-architecture-diagram

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-18
**Evals**: 1（`with_skill` を 1 run）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

eval の入力は変えていない。それ以外の eval は、スキル本文が変わったので with_skill だけを実行した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 3 | なし | 1/4 | - | 記録なし |

with_skill の平均 pass_rate は 0.25。

## with_skill で満たさなかった assertion

- eval 3: fixture に spec も Terraform も無く、作図まで進まなかった。#625 の変更とは関係しないので、別の Issue で扱う。
  - SQS ノード/エッジを spec に追加し、conventions.md の作図ルール（進入位置のずらし等）を維持している
  - icon-manifest.json に SQS があることを確認し、無ければ fetch-aws-icons.mjs で aws-icons/ に取得する
  - render → PNG 目視確認のループで仕上げている

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
