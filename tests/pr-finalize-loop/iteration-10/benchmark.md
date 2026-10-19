# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus
**Date**: 2026-10-19
**Evals**: 2（`with_skill` を 1 run ずつ）

## 何を変えたか

Issue #697 の PR #715 のレビューを受けて、`--defer-decisions` の判断待ちの基準と「直さない根拠」を直した（iteration-9 の後の変更）。
eval 20 と 21 の入力は変えていないが、判断待ちの基準と直さない根拠を読む eval なので、後退が無いかを with_skill で確かめた。
without_skill は入力が変わらないので実行していない。

## Summary

| eval | 入力の変更 | with_skill | 前回の with_skill |
| --- | --- | --- | --- |
| 20 | 無し | 8/8 | iteration-8 以前 |
| 21 | 無し | 7/7 | iteration-8 以前 |

eval 20 の with_skill は、設計の判断が絡むスレッド B を「影響が大きいか」「後で覆せるか」で評価し、判断待ちにした。

## with_skill で満たさなかった assertion

- 無し

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
