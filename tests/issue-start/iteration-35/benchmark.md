# Skill Benchmark: issue-start

**Model**: claude-code / claude-opus-5-5 / high（harness `run-skill-eval`）
**Date**: 2026-11-19
**Evals**: 4（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #1063 で、eval 7・8・12・13 の prompt の「まだ何も実行しないで」を、副作用（GitHub への書き込み・ファイルの変更）で禁じ、スキルの文書の読み取りを許す形に直した。その変更確認として実行した。

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 7 | 7/7 | 1/7 |
| 8 | 6/6 | 2/6 |
| 12 | 6/6 | 1/6 |
| 13 | 7/7 | 2/7 |

## 前回より下がったものと、その原因

- 無し。eval 7 は iteration-5、eval 13 は iteration-19 の記録と、assertion ごとに同じ合否だった。
- eval 8・12 は比べる記録が無い。1 run なので、ばらつきとは区別できない。

## 気付いたこと

- with_skill の 4 run は、すべてスキルの文書を読んだ（`skill_usage.read` が true）。
- without_skill は、eval 12 でスキルの文書が見つからないとして手順の説明を控え、満たしたのは「実行せず手順の提示に留めている」の 1 件だけだった。
- without_skill の 4 run の汚染の判定は、すべて clean だった。

## 実行し直した run

- 無し
