# Skill Benchmark: browser-test

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-18
**Evals**: 1（`with_skill` を 1 run）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わったのは eval 7（fixture）である。

without_skill を持つ eval と持たない eval で run の数が揃わないので、iteration-6 と iteration-7 に分けた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 7 | fixture | 4/4 | - | 4/4（iteration-3） |

with_skill の平均 pass_rate は 1.00。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- eval 7 の with_skill: 移行で消えた「作成と追記は非破壊」の文を戻して実行し直した

## 集計から外したもの

- 無し
