# Skill Benchmark: parity-diff

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-18
**Evals**: 3（`with_skill` を 1 run）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わったのは eval 4（fixture）、eval 7（assertion）、eval 14（fixture）である。

without_skill を持つ eval と持たない eval で run の数が揃わないので、iteration-39 と iteration-40 に分けた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 4 | fixture | 4/4 | - | 4/4（iteration-34） |
| 7 | assertion | 5/6 | - | 4/6（iteration-35） |
| 14 | fixture | 5/6 | - | 6/6（iteration-34） |

with_skill の平均 pass_rate は 0.89。

## with_skill で満たさなかった assertion

- eval 7: 前回より増えた。
  - property: pixel の例外は diff-normalize.mjs では吸収されない（同スクリプトの入力は特性照合の Diff だけで画素候補は通らない）ため本スキルが画素候補へ適用すると説明し、取り違えると承認済みでも次の実行で同じ crop が unexplained として再浮上すると述べている
- eval 14: 止める条件を「すべて通過」とだけ書いた。#625 の変更とは関係しないので、別の Issue で扱う。
  - 対象撮影組の bbox 欠落・不正・画像外・所有領域の曖昧さを blocked_by や片側マスクで通さず parity-suite へ戻して停止すると示している

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
