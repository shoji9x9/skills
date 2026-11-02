# Skill Benchmark: agent-usage

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-02
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #856 の変更確認（入力を変えた eval を 1 run ずつ）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 3: prompt で禁じる対象を、collect・report の実行と、記録・設定のファイルの変更に絞り、スキルの文書とスクリプトを読むのはよいと書いた。
  assertion 5 も同じ範囲に直した。

## 原因と対応

- iteration-6 の with_skill は、スキルの `references/` と `scripts/` を `ls`・`grep`・`sed` で読み、assertion 5（読み取りの grep も実行していない）を満たさなかった。
  collect・report は実行しておらず、記録のファイルも変えていない。スキルの記述にコマンドの実行を促すものは無かった。
- 実行を禁じる prompt はスキルの読み取りまで止める（`.kaizen/2026-09-26-eval-prompt-no-exec-suppresses-skill-read.md`）。
  そこで、禁じる対象を副作用に絞り、スキルは直さなかった。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 3 | あり | 5/5 | 1/5 | 4/5（iteration-6） |

## 前回より下がったものと、その原因

- 無し。assertion 5 は文を変えたので、前回と比べない。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はスキルを読み、without_skill の汚染の判定は `clean` だった）
