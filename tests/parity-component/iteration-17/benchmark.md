# Skill Benchmark: parity-component

**Model**: claude-code / opus（harness `run-skill-eval/4`・`run-skill-eval/5`）
**Date**: 2026-10-18
**Evals**: 8（`with_skill` を 1 run）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わった eval は次のとおりである。

- eval 2（fixture）
- eval 3（fixture）
- eval 4（fixture）
- eval 5（fixture）
- eval 6（fixture）
- eval 7（fixture）
- eval 8（fixture）
- eval 9（fixture）

without_skill を持つ eval と持たない eval で run の数が揃わないので、iteration-17 と iteration-18 に分けた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 2 | fixture | 6/6 | - | 6/6（iteration-16） |
| 3 | fixture | 4/4 | - | 4/4（iteration-16） |
| 4 | fixture | 5/5 | - | 2/5（iteration-16） |
| 5 | fixture | 6/6 | - | 6/6（iteration-16） |
| 6 | fixture | 5/5 | - | 5/5（iteration-16） |
| 7 | fixture | 8/8 | - | 8/8（iteration-16） |
| 8 | fixture | 11/11 | - | 10/11（iteration-16） |
| 9 | fixture | 10/11 | - | 10/11（iteration-16） |

with_skill の平均 pass_rate は 0.99。

## with_skill で満たさなかった assertion

- eval 9: 前回と同じ件数である。
  - 直した処理を外すとその実行パスの検査だけが落ちることを確かめると述べている

## 実行し直した run

- eval 4 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 5 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 5 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 6 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した

実行し直さなかった run は `run-skill-eval/4` で実行した。`/4` は `config-schemas/` をコピーしないが、これらの run は設定の読み取りを実行していない。

## 集計から外したもの

- 無し
