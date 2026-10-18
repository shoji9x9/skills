# Skill Benchmark: git-worktree

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
| 9 | なし | 3/4 | - | 3/4（iteration-5） |

with_skill の平均 pass_rate は 0.75。

## with_skill で満たさなかった assertion

- eval 9: 前回と同じ件数である。
  - 散文の指示だけでは守られないとして、同梱の `scripts/git-worktree-branch-guard.sh` を PreToolUse に組み込む手順（`references/branch-guard-hook.md`）を示している

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
