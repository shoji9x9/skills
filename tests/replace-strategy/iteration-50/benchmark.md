# Skill Benchmark: replace-strategy

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-18
**Evals**: 21（`with_skill` を 1 run）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わった eval は次のとおりである。

- eval 6（assertion・fixture）
- eval 7（fixture）
- eval 8（fixture）
- eval 9（fixture）
- eval 10（fixture）
- eval 19（fixture）
- eval 20（fixture）
- eval 21（assertion・fixture）
- eval 22（fixture）
- eval 23（fixture）
- eval 25（fixture）
- eval 26（fixture）
- eval 29（fixture）
- eval 30（fixture）
- eval 31（fixture）
- eval 32（fixture）
- eval 33（fixture）
- eval 34（fixture）
- eval 35（fixture）
- eval 36（fixture）
- eval 38（assertion・fixture）

without_skill を持つ eval と持たない eval で run の数が揃わないので、iteration-50 と iteration-51 に分けた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 6 | assertion・fixture | 4/5 | - | 5/5（iteration-48） |
| 7 | fixture | 5/5 | - | 5/5（iteration-47） |
| 8 | fixture | 5/5 | - | 5/5（iteration-47） |
| 9 | fixture | 4/4 | - | 4/4（iteration-47） |
| 10 | fixture | 5/5 | - | 5/5（iteration-47） |
| 19 | fixture | 5/5 | - | 5/5（iteration-47） |
| 20 | fixture | 5/5 | - | 5/5（iteration-47） |
| 21 | assertion・fixture | 4/5 | - | 4/5（iteration-47） |
| 22 | fixture | 5/5 | - | 5/5（iteration-47） |
| 23 | fixture | 4/4 | - | 4/4（iteration-47） |
| 25 | fixture | 5/5 | - | 5/5（iteration-47） |
| 26 | fixture | 5/5 | - | 5/5（iteration-48） |
| 29 | fixture | 6/6 | - | 6/6（iteration-48） |
| 30 | fixture | 6/7 | - | 6/7（iteration-49） |
| 31 | fixture | 5/5 | - | 5/5（iteration-49） |
| 32 | fixture | 4/5 | - | 4/5（iteration-48） |
| 33 | fixture | 5/5 | - | 5/5（iteration-47） |
| 34 | fixture | 5/5 | - | 5/5（iteration-49） |
| 35 | fixture | 5/5 | - | 5/5（iteration-47） |
| 36 | fixture | 3/3 | - | 3/3（iteration-47） |
| 38 | assertion・fixture | 7/7 | - | 7/7（iteration-48） |

with_skill の平均 pass_rate は 0.96。

## with_skill で満たさなかった assertion

- eval 6: ループの状態を「1 回目」とだけ書いた。#625 の変更とは関係しないので、別の Issue で扱う。
  - 差し戻しループの状態（loop.iterations 1 / max_iterations 5）を報告に含めている
- eval 21: 前回と同じ件数である。
  - 設定に current.origin キーが無いことを「未確認」ではなく managed（既存の管理済みテスト環境）として扱い、setup の再実行や由来の作り直しを要求していない
- eval 30: 前回と同じ件数である。
  - 突き合わせの結果を features.md の「受け入れ条件」列へ書き分けている。notification-banner は 未対応（空欄＝未突き合わせと同じ表記にしていない）、report は引き受けた Issue 番号、order は番号に届いていない呼び出しの併記（呼び出し未達: user）を添えている
- eval 32: 前回と同じ件数である。
  - 残った未確定の口（PATCH と DELETE）を宿題として名指しで報告し、着手中に確定できなかった口を放置すると未検証領域の報告に残り続けることを示している（「反映した」だけで終えていない）

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
