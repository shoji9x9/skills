# Skill Benchmark: replace-strategy

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-18
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わったのは eval 15（prompt・assertion）、eval 16（prompt）である。

without_skill を持つ eval と持たない eval で run の数が揃わないので、iteration-50 と iteration-51 に分けた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 15 | prompt・assertion | 5/5 | 0/5 | 4/5（iteration-48） |
| 16 | prompt | 4/5 | 0/5 | 記録なし |

with_skill の平均 pass_rate は 0.90、without_skill は 0.00。

## with_skill で満たさなかった assertion

- eval 16: prompt は書く場所だけを尋ねていて、応答も止まるかに触れなかった。#625 の変更とは関係しないので、別の Issue で扱う。
  - 未整備のときの挙動が両者で違うこと（architecture は parity-replace が部品の採否・実装工程に入らず停止する／coding_conventions は停止しない）を示している

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
