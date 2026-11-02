# Skill Benchmark: dependabot-alert-issue

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-02
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #856 の変更確認（スキルの記述を変えた eval を 1 run ずつ）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 5: SKILL.md「セットアップ」に、設定の例はキーと値の説明であり、ファイル全体を書き直す雛形として使わないこと、既にある設定ファイルには `set` と `append` で足すことを書いた。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 5 | あり | 5/5 | 1/5 | 4/5・4/5・4/5（iteration-4） |

## 変更の効果

- with_skill は、同梱の `skill-config.mjs` の `append` を主な手順として示した。前回は 3 run とも、設定ファイル全体の jsonc を示していた。

## 前回より下がったものと、その原因

- 無し

## 実行し直した run

- 無し（SKILL.md の文は、run の後に参照の位置の書き方だけを直した。意味は変えていない）

## 集計から外したもの

- 無し（with_skill はスキルを読み、without_skill の汚染の判定は `clean` だった）
