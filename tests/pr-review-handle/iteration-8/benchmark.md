# Skill Benchmark: pr-review-handle

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-30
**Evals**: 3（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #705 の変更確認（入力を変えた eval を 1 run ずつ）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 7: prompt から設定の値を外して fixture に置き、取得できた PR の状態を prompt に書いた。
- eval 8: prompt から設定の値を外して fixture に置き、取得できた PR の状態を prompt に書いた。
- eval 10: prompt から設定の値を外し、設定ファイルを fixture に置いた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 7 | あり | 4/5 | 3/5 | 2/5（iteration-7） |
| 8 | あり | 2/3 | 3/3 | 3/3（iteration-6） |
| 10 | あり | 4/4 | 1/4 | 4/4（iteration-7） |

## 前回より下がったものと、その原因

- eval 7: 前回は満たし、今回はどの run も満たさなかった assertion がある。
  - common の review_tool の設定（codex）を参照して依頼先ツールを決めている
- eval 7 の原因と対応: pr-finalize-loop#9 と同じ原因である。同じ文に直し、実行し直す。
- eval 8: 前回は満たし、今回はどの run も満たさなかった assertion がある。
  - common の review_tool の設定（none）を参照している
- eval 8 の原因と対応: pr-finalize-loop#9 と同じ原因である。同じ文に直し、実行し直す。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
