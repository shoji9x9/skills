# Skill Benchmark: issue-batch

**Model**: claude-code / opus（harness `run-skill-eval/4`・`run-skill-eval/5`）
**Date**: 2026-10-18
**Evals**: 16（`with_skill` を 1 run）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わった eval は次のとおりである。

- eval 1（fixture）
- eval 4（fixture）
- eval 6（fixture）
- eval 9（assertion）
- eval 14（assertion・fixture）
- eval 16（fixture）
- eval 17（assertion・fixture）
- eval 18（fixture）
- eval 19（fixture）
- eval 20（fixture）
- eval 21（fixture）
- eval 22（fixture）
- eval 23（fixture）
- eval 25（fixture）
- eval 26（fixture）
- eval 27（fixture）

without_skill を持つ eval と持たない eval で run の数が揃わないので、iteration-19 と iteration-20 に分けた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | fixture | 2/4 | - | 4/4（iteration-3） |
| 4 | fixture | 2/2 | - | 2/2（iteration-3） |
| 6 | fixture | 3/3 | - | 3/3（iteration-9） |
| 9 | assertion | 5/5 | - | 5/5（iteration-9） |
| 14 | assertion・fixture | 3/3 | - | 3/3（iteration-3） |
| 16 | fixture | 6/6 | - | 6/6（iteration-5） |
| 17 | assertion・fixture | 4/4 | - | 4/4（iteration-9） |
| 18 | fixture | 4/4 | - | 4/4（iteration-9） |
| 19 | fixture | 4/4 | - | 4/4（iteration-5） |
| 20 | fixture | 4/4 | - | 4/4（iteration-9） |
| 21 | fixture | 3/3 | - | 3/3（iteration-8） |
| 22 | fixture | 3/3 | - | 3/3（iteration-8） |
| 23 | fixture | 9/9 | - | 9/9（iteration-10） |
| 25 | fixture | 8/8 | - | 8/8（iteration-12） |
| 26 | fixture | 7/7 | - | 7/7（iteration-15） |
| 27 | fixture | 5/6 | - | 6/6（iteration-18） |

with_skill の平均 pass_rate は 0.96。

## with_skill で満たさなかった assertion

- eval 1: 前提スキルの git-worktree が eval の環境に無く（`requires_skills` の宣言が無い）、worktree の置き場所を「リポジトリの中」と答えた。#625 の変更とは関係しないので、別の Issue で扱う。
  - 変更前に repo 一致、OPEN、本文と全コメント、依存関係、既存 branch / PR / worktree、設定、権限を全件確認する
  - 呼び出し元を checkout せず /tmp の隔離 worktree と秘密値を含まない manifest を使う
- eval 27: #101 を〈要確認〉のまま残し、該当なしと書かなかった。#625 の変更とは関係しないので、別の Issue で扱う。
  - Issue の対象から外した形の欄を設け、該当が無いことを書いている

## 実行し直した run

- eval 1 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 14 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 16 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 17 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 19 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 20 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した

実行し直さなかった run は `run-skill-eval/4` で実行した。`/4` は `config-schemas/` をコピーしないが、これらの run は設定の読み取りを実行していない。

## 集計から外したもの

- 無し
