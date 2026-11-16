# Skill Benchmark: issue-start

**Model**: claude-code / claude-opus-5-5 / high（harness `run-skill-eval`）
**Date**: 2026-11-16
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #338 で `--progress` と `references/progress.md` を足し、新しい eval 26 の変更確認として実行した。
eval 26 は新しく足した eval なので、比べる前の iteration の記録は無い。

## Summary

| eval | with_skill | without_skill |
| --- | --- | --- |
| 26 | 6/6 | 1/6 |

## 前回より下がったものと、その原因

- 無し（新しい eval）

## 気付いたこと

- with_skill は、最後の手順でも `--label` が空にできないので「完了」のような名前を入れることになる、と文書に無い推測を添えた。
- without_skill は、スキルの文書が見つからないとして、見積もり・更新の手順・statusLine の扱いを説明しなかった。満たしたのは「説明に留めている」の 1 件だけだった。
- without_skill の汚染の判定は clean だった。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
