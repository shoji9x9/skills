# Skill Benchmark: dependabot-merge

**Model**: claude-code / opus（harness `run-skill-eval/4`・`run-skill-eval/5`）
**Date**: 2026-10-18
**Evals**: 3（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わったのは eval 1（assertion）、eval 2（assertion）、eval 10（assertion）である。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | assertion | 7/8 | 4/8 | 8/8（iteration-3） |
| 2 | assertion | 4/6 | 2/6 | 6/6（iteration-3） |
| 10 | assertion | 10/10 | 7/10 | 10/10（iteration-5） |

with_skill の平均 pass_rate は 0.85、without_skill は 0.51。

## with_skill で満たさなかった assertion

- eval 1: サンドボックスの中で GitHub につながらず、PR を取得できずに止まった。#625 の変更とは関係しないので、別の Issue で扱う。
  - 安全と判断した場合に gh pr merge でマージしようとしている
- eval 2: サンドボックスの中で GitHub につながらず、PR を取得できずに止まった。#625 の変更とは関係しないので、別の Issue で扱う。
  - リスクあり/判断不能ならマージせず、課題と解決策をコメントに残して停止する方針である
  - マージ方式を、リポジトリ規約からの推測ではなく設定 .config/skills/shoji9x9/dependabot-merge.jsonc の merge_method（無ければ squash 既定）から決める方針を示している

## 実行し直した run

- eval 1 の with_skill: dependabot-merge の SKILL.md に設定ファイルのパスを戻して実行し直した
- eval 2 の with_skill: dependabot-merge の SKILL.md に設定ファイルのパスを戻して実行し直した
- eval 10 の with_skill: dependabot-merge の SKILL.md に設定ファイルのパスを戻して実行し直した

実行し直さなかった run は `run-skill-eval/4` で実行した。`/4` は `config-schemas/` をコピーしないが、これらの run は設定の読み取りを実行していない。

## 集計から外したもの

- 無し
