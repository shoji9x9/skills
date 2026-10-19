# Skill Benchmark: parity-replace

**Model**: claude-code / opus（harness `run-skill-eval/4`・`run-skill-eval/5`）
**Date**: 2026-10-18
**Evals**: 5（`with_skill` を 1 run）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わった eval は次のとおりである。

- eval 6（fixture）
- eval 14（fixture）
- eval 15（fixture）
- eval 20（fixture）
- eval 22（fixture）

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 6 | fixture | 4/4 | - | 4/4（iteration-32） |
| 14 | fixture | 3/5 | - | 3/5（iteration-32） |
| 15 | fixture | 4/5 | - | 4/5（iteration-32） |
| 20 | fixture | 4/5 | - | 4/5（iteration-32） |
| 22 | fixture | 5/5 | - | 5/5（iteration-30） |

with_skill の平均 pass_rate は 0.84。

## with_skill で満たさなかった assertion

- eval 14: 前回と同じ件数である。
  - リストの中身を自分で full / diff へ振り分けず、移行の原本（replace-strategy の references/project-config.md）を示してユーザーに委ねている
  - 完了判定（新側 green ＋検証コマンド）が verification_commands.full で行われるため、full が確定しないと完了判定が成立しないことを理由に挙げている
- eval 15: 前回と同じ件数である。
  - 実行した列（full / diff）を replace-metadata.json の証跡に記録すると述べている
- eval 20: 前回と同じ件数である。
  - 別パッケージのテストが緑であることを前倒し不要の根拠にせず、スタブに足りないプロパティが undefined になって古い形の assertion が通りうると述べている

## 実行し直した run

- eval 6 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 14 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 14 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 15 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した

実行し直さなかった run は `run-skill-eval/4` で実行した。`/4` は `config-schemas/` をコピーしないが、これらの run は設定の読み取りを実行していない。

## 集計から外したもの

- 無し
