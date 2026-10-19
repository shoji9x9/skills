# Skill Benchmark: issue-batch

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-18
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わったのは eval 24（prompt・fixture）である。

without_skill を持つ eval と持たない eval で run の数が揃わないので、iteration-19 と iteration-20 に分けた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 24 | prompt・fixture | 6/6 | 3/6 | 6/6（iteration-10） |

with_skill の平均 pass_rate は 1.00、without_skill は 0.50。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
