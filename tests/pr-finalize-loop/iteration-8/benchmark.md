# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-18
**Evals**: 4（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わったのは eval 9（prompt・assertion）、eval 10（assertion）、eval 13（prompt）、eval 17（prompt・assertion）である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 9 | prompt・assertion | 5/5 | 0/5 | 記録なし |
| 10 | assertion | 2/4 | 2/4 | 記録なし |
| 13 | prompt | 4/5 | 3/5 | 5/5（iteration-1） |
| 17 | prompt・assertion | 3/4 | 1/4 | 記録なし |

with_skill の平均 pass_rate は 0.76、without_skill は 0.34。

## with_skill で満たさなかった assertion

- eval 10: fixture が無く git リポジトリでないので、PR を特定できずに止まった。#625 の変更とは関係しないので、別の Issue で扱う。
  - 収束・完了判定から「HEAD がレビュー済み」条件を外し、CI 全成功かつ未解決スレッド無しで完了とする方針である
  - 未解決スレッドの返信・解決は通常どおり行う方針である
- eval 13: 自分のトップレベルコメントを唯一の証跡にすることに触れなかった。#625 の変更とは関係しないので、別の Issue で扱う。
  - トップレベルコメントの指摘には返信先スレッドが無く resolve もできないため、自分のトップレベルコメントを唯一の証跡として判断と根拠を残す方針である
- eval 17: prompt が述べる設定ファイルが fixture に無い。#625 の変更とは関係しないので、別の Issue で扱う。
  - 今回の CLI 指定が common.local.jsonc より優先し、次回は common.local.jsonc が共有の common.jsonc より優先すると説明している

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
