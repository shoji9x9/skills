# Skill Benchmark: golden-dataset

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-18
**Evals**: 4（`with_skill` を 1 run）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わったのは eval 6（fixture）、eval 7（assertion・fixture）、eval 8（fixture）、eval 13（fixture）である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 6 | fixture | 4/4 | - | 4/4（iteration-20） |
| 7 | assertion・fixture | 5/5 | - | 5/5（iteration-19） |
| 8 | fixture | 4/9 | - | 5/9（iteration-20） |
| 13 | fixture | 3/5 | - | 3/5（iteration-20） |

with_skill の平均 pass_rate は 0.76。

## with_skill で満たさなかった assertion

- eval 8: テスト環境かを確かめられないとして投入を保留した。#625 の変更とは関係しないので、別の Issue で扱う。
  - gaps.md の 2 件（ページ送り・空状態）を design.md へ追記し、投入ツール（seed/src/main.ts）を更新して再生成している
  - metadata.json の version を 1 から 2 へ上げている
  - metadata.json の changes に version 2 と、実際に変更した静的データ単位だけを affects として追記し、過去版の履歴を保持している
  - metadata.json の current.fingerprint を再計算して更新し、current.target と current.seeded_at は null のままにしている
  - version 2 の affects と各 slug の実効参照データを照合し、影響する parity-suite だけのベースライン再取得を案内している
- eval 13: 前回と同じ件数である。
  - current.origin: received-assets を踏まえ .replace/bootstrap/metadata.json の status: handed-off を確認してからフェーズ A に入っている
  - handoff.boot_requirements の起動要件（ADMIN / OPERATOR の app_users、customers 1 件以上）をフェーズ A のデータ設計に含めている（事前削除で暫定起動データが置き換わるため）

## 実行し直した run

- eval 6 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 6 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 7 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 7 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 8 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 8 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 13 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 13 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した

## 集計から外したもの

- 無し
