# Skill Benchmark: dependabot-alert-issue

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-30
**Evals**: 1（`with_skill` と `without_skill` を 3 run ずつ）

## 目的

Issue #705 の項目 2 の benchmark（前回より満たした件数が少なかった eval を 3 run で確かめる）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 5: 既存の設定ファイルを fixture に置き、非破壊の assertion を append で書く方針を確かめる形にした。prompt で手順も尋ねた。
- eval 5: 文が変わった・新しい assertion 1 件は、前回と比べていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 5 | あり | 4/5・4/5・4/5 | 2/5・2/5・2/5 | 3/5（iteration-3） |

## 前回より下がったものと、その原因

- eval 5 の原因と対応: 3 run とも、SKILL.md の設定ファイル全体の例に沿ってファイル全体を示し、append を主な手順にしなかった。この変更とは関係しない。SKILL.md の例の示し方を後の作業の Issue（#856） で直す。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
