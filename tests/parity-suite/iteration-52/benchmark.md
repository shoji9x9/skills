# Skill Benchmark: parity-suite

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-18
**Evals**: 4（`with_skill` を 1 run）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わったのは eval 6（fixture）、eval 7（fixture）、eval 18（assertion・fixture）、eval 19（assertion・fixture）である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 6 | fixture | 4/4 | - | 4/4（iteration-47） |
| 7 | fixture | 4/4 | - | 4/4（iteration-50） |
| 18 | assertion・fixture | 5/5 | - | 5/5（iteration-50） |
| 19 | assertion・fixture | 5/5 | - | 5/5（iteration-50） |

with_skill の平均 pass_rate は 1.00。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- eval 6 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 6 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 7 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 7 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 18 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 18 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 19 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した

## 集計から外したもの

- 無し
