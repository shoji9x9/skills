# Skill Benchmark: multiagent-setup

**Model**: claude-code / opus（harness `run-skill-eval`）
**Date**: 2026-11-03
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #866 の 5 回目のレビューを受けて、スキル作成手順 2 のコピーの条件から git worktree への言及を外した。
前提に `.gitignore` の対象のうち依頼に要るものと、祖先のディレクトリの指示の文書を足した。
利用者のレベルに同じ振る舞いのスキルがあり、利用者が残すと決めたときは「スキルは要らない」と判断しないことを書いた。
手順 2 を通る eval 1 を実行し直した。eval の入力は変えていない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | スキル本文 | 4/4 | 1/4 | 4/4（iteration-9） |

with_skill は、作業ディレクトリとは別の場所に毎回同じ状態から作ったコピーで、スキル無しとスキル有りを 3 回ずつ比べてから SKILL.md とリンクを作った。

## 前回より下がった eval の切り分け

- 無し

## 集計から外したもの

- 無し
