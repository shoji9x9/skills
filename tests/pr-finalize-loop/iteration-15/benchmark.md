# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-02
**Evals**: 3（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #705 の変更確認である。iteration-14 で、with_skill の run が prompt の「gh や git のコマンドは実行せず」に従い、同梱の `resolve-review-tool.sh` も実行せずに fixture の設定を読まなかった。
実行しないよう求めるコマンドを GitHub に接続するものに絞り、手元のファイルの読み取りと同梱のスクリプトの実行は許す文に直して、実行し直した。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。

## 入力の変更

- eval 9・10・17: prompt の上の文を直した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 9 | あり | 5/5 | 3/5 | 3/5（iteration-14） |
| 10 | あり | 4/4 | 4/4 | 1/4（iteration-14） |
| 17 | あり | 4/4 | 2/4 | 4/4（iteration-14） |

with_skill の 3 run は、どれも `resolve-review-tool.sh` を実行し、fixture の設定と同じ値を得た（eval 9 は `codex`、eval 10 は `none`、eval 17 は `codex`。raw/ の `value=` の行で確かめた）。

## 前回より下がったものと、その原因

- 無し

## 気付いたこと

- eval 10 は、without_skill も 4/4 だった。without_skill の run は fixture の設定ファイルを `cat` で読み、`none` から再レビューを依頼しない方針を自分で導いた。1 run なので、スキルの有無で差が無くなったかは区別できない。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
