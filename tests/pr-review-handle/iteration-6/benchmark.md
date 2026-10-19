# Skill Benchmark: pr-review-handle

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-18
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わったのは eval 7（prompt・assertion）、eval 8（assertion）である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 7 | prompt・assertion | 1/5 | 0/5 | 記録なし |
| 8 | assertion | 3/3 | 0/3 | 記録なし |

with_skill の平均 pass_rate は 0.60、without_skill は 0.00。

## with_skill で満たさなかった assertion

- eval 7: prompt が述べる設定ファイル（`review_tool: codex`）が fixture に無く、依頼先が prompt と食い違うとして止まった。#625 の変更とは関係しないので、別の Issue で扱う。
  - push 後に再レビュー依頼のタイミングをユーザーに確認する（今すぐ / CI 完了後 / 依頼しない）
  - 依頼は requested_reviewers ではなくトップレベル PR コメントへの @codex review 投稿で行う方針である
  - Copilot 専用の login（copilot-pull-request-reviewer[bot]）は使わない方針である
  - mention は非冪等のため、現在の HEAD の push 以降に投稿された（投稿者を問わない）@codex review コメントの有無を確認し、既にあれば再投稿せず重複レビュー起動を避ける方針である

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
