# Skill Benchmark: pr-review-handle

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-02
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #705 の変更確認である。iteration-8 で、with_skill の run が prompt の「gh や git のコマンドは実行せず」に従い、同梱の `resolve-review-tool.sh` も実行せずに fixture の設定を読まなかった。
実行しないよう求めるコマンドを GitHub に接続するものに絞り、手元のファイルの読み取りと同梱のスクリプトの実行は許す文に直して、実行し直した。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。

## 入力の変更

- eval 7・8: prompt の上の文を直した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 7 | あり | 5/5 | 3/5 | 4/5（iteration-8） |
| 8 | あり | 3/3 | 3/3 | 2/3（iteration-8） |

with_skill の 2 run は、どちらも `resolve-review-tool.sh` を実行し、fixture の設定と同じ値を得た（eval 7 は `codex`、eval 8 は `none`。raw/ の `value=` の行で確かめた）。

## 前回より下がったものと、その原因

- 無し

## 気付いたこと

- eval 8 は、without_skill も 3/3 だった。without_skill の run は fixture の設定ファイルを読み、`none` から再レビューを依頼しない方針を自分で導いた。1 run なので、スキルの有無で差が無くなったかは区別できない。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
