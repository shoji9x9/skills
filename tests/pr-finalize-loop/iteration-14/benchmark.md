# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-30
**Evals**: 7（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #705 の変更確認（入力を変えた eval を 1 run ずつ）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 9: prompt から設定の値を外して fixture に置き、取得できた PR の状態を prompt に書いた。
- eval 10: prompt から設定の値を外して fixture に置き、取得できた PR の状態を prompt に書いた。
- eval 15: prompt から設定の値を外し、設定ファイルを fixture に置いた。
- eval 16: prompt から設定の値を外し、設定ファイルを fixture に置いた。
- eval 17: prompt から設定の値を外して fixture（common.jsonc と common.local.jsonc）に置き、取得できた PR の状態を prompt に書いた。
- eval 18: prompt から設定の値を外し、設定ファイルを fixture に置いた。
- eval 21: prompt から設定の値を外し、設定ファイルを fixture に置いた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 9 | あり | 3/5 | 3/5 | 5/5（iteration-11） |
| 10 | あり | 1/4 | 3/4 | 2/4（iteration-8） |
| 15 | あり | 6/6 | 2/6 | 6/6（iteration-11） |
| 16 | あり | 5/5 | 4/5 | 記録なし |
| 17 | あり | 4/4 | 2/4 | 3/4（iteration-8） |
| 18 | あり | 4/4 | 1/4 | 4/4（iteration-11） |
| 21 | あり | 7/7 | 5/7 | 7/7（iteration-10） |

## 前回より下がったものと、その原因

- eval 9: 前回は満たし、今回はどの run も満たさなかった assertion がある。
  - common の review_tool の設定（codex）を参照して依頼先ツールを決めている
  - Copilot 専用の login（copilot-pull-request-reviewer[bot]）や review_requested タイムラインに依存しない方針である
- eval 9 の原因と対応: prompt の「gh や git のコマンドは実行せず」に従い、resolve-review-tool.sh も実行せず、fixture の設定を読まずに copilot を前提にした。この変更が原因である。禁止の範囲を GitHub に接続するコマンドに絞り、スクリプトの実行は許す文に直した。直した prompt で実行し直す。
- eval 10: 前回は満たし、今回はどの run も満たさなかった assertion がある。
  - common の review_tool の設定（none）を参照している
  - AI レビュアーへの再レビュー依頼を一切行わない方針である
- eval 10 の原因と対応: #9 と同じ原因である。同じ文に直し、実行し直す。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
