# Skill Benchmark: issue-start

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
| 1 | なし | 3/7 | - | 3/7（iteration-3） |

with_skill の平均 pass_rate は 0.43。

## with_skill で満たさなかった assertion

- eval 1: fixture が git リポジトリでないので、repo の一致を確かめる段階で止まった。前回の 3 run の最小値と同じである。#625 の変更とは関係しないので、別の Issue で扱う。
  - gh issue view で Issue 内容を確認しようとしている
  - feature/12-&lt;英語の短い説明> 形式のブランチ名を決めている
  - 同番号ブランチの重複を local/remote で確認している
  - gh issue develop --base &lt;規約から解決したベースブランチ> --checkout でブランチを作成しようとしている（ベースブランチを main に固定せず、リポジトリの規約から解決した値を使っている）

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
