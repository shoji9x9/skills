# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-03
**Evals**: 5（`with_skill` だけを 1 run ずつ）

## 目的

Issue #868 の変更確認である。`SKILL.md` の「gh メカニクス」と「ポーリングと待機」の詳細を `references/` の 3 ファイルへ移した。
エージェントが必要な段階で移した先のファイルを開き、前と同じ判定をするかを、既存の eval で確かめる。
PR #874 のレビューの指摘を受けて、移した 3 ファイルのそれぞれの判定に当たる eval を 5 件選んだ。
入力は変えていないので、without_skill は実行していない。

## 入力の変更

- 無し（eval 9・12・16・18・23 の prompt・fixture・assertion は変えていない）

## Summary

| eval | 確かめるファイル | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 9 | `references/review-request.md` | 5/5 | 5/5（iteration-15） |
| 12 | `references/review-status.md` | 4/4 | 4/4（iteration-11） |
| 16 | `references/review-status.md` | 5/5 | 5/5（iteration-14） |
| 18 | `references/review-request.md` | 4/4 | 4/4（iteration-14） |
| 23 | `references/ci-checks.md` | 7/7 | 7/7（iteration-12） |

5 run とも、`ci-checks.md`・`review-status.md`・`review-request.md` を読んだ（raw/ の Read の呼び出しで確かめた）。

## 前回より下がったものと、その原因

- 無し

## 気付いたこと

- eval 12 の、本文の指摘をトップレベルのコメントで返す assertion は、対応の記録をトップレベルのコメントで残して突き合わせる、という書き方で満たした。前回と比べて具体的な書き方が少ない。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
