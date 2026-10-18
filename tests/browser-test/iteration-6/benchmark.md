# Skill Benchmark: browser-test

**Model**: claude-code / opus（harness `run-skill-eval/4`・`run-skill-eval/5`）
**Date**: 2026-10-18
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わったのは eval 1（assertion）、eval 5（assertion）である。

without_skill を持つ eval と持たない eval で run の数が揃わないので、iteration-6 と iteration-7 に分けた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | assertion | 3/3 | 1/3 | 3/3（iteration-1） |
| 5 | assertion | 3/4 | 1/4 | 4/4（iteration-1） |

with_skill の平均 pass_rate は 0.88、without_skill は 0.29。

## with_skill で満たさなかった assertion

- eval 5: main（#625 の前）の版でも with_skill を 1 run 実行し、同じ assertion で落ちた（3/4）。回帰ではなく、#625 の変更とは関係しないので、別の Issue で扱う。
  - .config/skills/shoji9x9/browser-test.jsonc の environments だけを非破壊に書こうとしている（既存の他のキー・値・コメントを変更しない）

## 実行し直した run

- eval 1 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 1 の with_skill: 移行で消えた「作成と追記は非破壊」の文を戻して実行し直した
- eval 5 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 5 の with_skill: 移行で消えた「作成と追記は非破壊」の文を戻して実行し直した

実行し直さなかった run は `run-skill-eval/4` で実行した。`/4` は `config-schemas/` をコピーしないが、これらの run は設定の読み取りを実行していない。

## 集計から外したもの

- 無し
