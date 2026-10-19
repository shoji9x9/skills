# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-18
**Evals**: 6（`with_skill` を 1 run）

## 何を変えたか

Issue #625 で、スキルの設定を `.config/skills/shoji9x9/skills.yml` の 1 ファイルから、スキルごとの JSONC ファイル（`.config/skills/shoji9x9/<スキル名>.jsonc` と、層ごとの置き場所）に移した。
スキルに読み取りのスクリプト（`scripts/skill-config/skill-config.mjs`）とスキーマ（`config-schemas/`）を同梱し、SKILL.md と references の設定の記述を書き換えた。

入力が変わった eval は次のとおりである。

- eval 1（fixture）
- eval 2（fixture）
- eval 3（fixture）
- eval 4（fixture）
- eval 5（fixture）
- eval 6（fixture）

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | fixture | 2/5 | - | 4/5（iteration-8） |
| 2 | fixture | 4/6 | - | 4/6（iteration-8） |
| 3 | fixture | 7/8 | - | 8/8（iteration-10） |
| 4 | fixture | 10/10 | - | 10/10（iteration-10） |
| 5 | fixture | 3/5 | - | 3/5（iteration-8） |
| 6 | fixture | 4/4 | - | 3/4（iteration-9） |

with_skill の平均 pass_rate は 0.76。

## with_skill で満たさなかった assertion

- eval 1: 姉妹スキルの replace-strategy が eval の環境に無く（`requires_skills` の宣言が無い）、工程 2 で止まった。#625 の変更とは関係しないので、別の Issue で扱う。
  - DB エンジン版・文字コード・照合順序・タイムゾーン・sql_mode を受領スキーマの記載を根拠に復元し、環境の既定値で補完していない
  - orders.status の値と正常系遷移をデータ辞書の記載を根拠に「確定済み」として扱い、推測扱いにも確認待ちにもしていない
  - 暫定起動データは起動・ログイン・主要画面到達のための最小限であり、ゴールデンデータセットは golden-dataset が別途構築すると区別している（暫定データを比較の正解として扱っていない）
- eval 2: 前回と同じ件数である。
  - DDL そのものが受領されていないことを停止理由にせず、マイグレーションから決定論的に完全復元できるかを検証する方針を示し、空の DB へ実際に全マイグレーションを適用して最終スキーマを得る手順を示している（机上判定で済ませていない）
  - 受領資産だけでは工程 7（起動・認証・主要画面到達）を実測できないため handed-off を名乗らず、metadata.json に status: blocked と停止理由・未確認項目（handoff.unconfirmed）・フェーズ A へ引き継ぐ起動要件（handoff.boot_requirements）を記録し、下流（golden-dataset / parity-suite）が引き継げる形にしている
- eval 3: 照合順序とタイムゾーンを、ドライバの版に依存するとして「不足」にした。#625 の変更とは関係しないので、別の Issue で扱う。
  - スキーマと DB 設定（文字コード・照合順序・タイムゾーン。接続時の設定を含む）は受領資産に値と根拠があるものとして扱い、データ意味論（orders.status の意味と遷移など）は確定できないものとして、別々の項目で判定している（両者をまとめて「復元できた」と書いていない）
- eval 5: 前回と同じ件数である。
  - 回答が確定した範囲で最小の暫定起動データを作る一方、確認待ちが残る機能（受注一覧・得意先一覧）のデータを推測で埋めていない
  - 投入前に設定によるチェック（対象 target の db.seedable: true）と本番でないことを確かめるチェックの両方を通す方針を示している

## 実行し直した run

- eval 1 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 1 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 2 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 2 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 3 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 3 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 4 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 4 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 5 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 5 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した
- eval 6 の with_skill: ランナーが `config-schemas/` と `checks.json` をコピーしていなかったので、ハーネスを `run-skill-eval/5` に直して実行し直した
- eval 6 の with_skill: `skill-config.mjs get` が入れ子のキーのパスを読めなかったので、直して実行し直した

## 集計から外したもの

- 無し
