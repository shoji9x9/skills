# Skill Benchmark: pr-review-handle

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-03
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #862 の変更確認である。指摘への返信の書き方・関係する指摘の保留・機能を足す指摘の確かめ方を `references/review-response.md` に足し、それを確かめる eval 12 を新しく足した。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。

## 入力の変更

- eval 12: 新しく足した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 12 | 新規 | 6/6 | 2/6 | なし |

with_skill の run は `references/review-response.md` を読んだ（raw/ の Read の呼び出しで確かめた）。

## 前回より下がったものと、その原因

- 無し（新しい eval なので、比べる記録は無い）

## 気付いたこと

- without_skill も、スレッド B を A の答えの後に直すことと、C を A と並行して進めることは自分で導いた。
  B に「承知しました」で始まる返信を先に投稿する点と、`exportCsv` の呼び出し元を探さない点で差が出た。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（without_skill の汚染の判定は `clean` だった）
