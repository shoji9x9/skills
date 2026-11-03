# Skill Benchmark: pr-finalize-loop

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-11-03
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #862 と #868 の変更確認である。
Issue #862 では、判断待ちと関係する指摘の扱いと返信の書き方を足し、それを確かめる eval 24 を新しく足した。
Issue #868 では、`SKILL.md` の「gh メカニクス」と「ポーリングと待機」の詳細を `references/` の 3 ファイルへ移した。本文は変えず、参照先だけを直した。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。

## 入力の変更

- eval 24: 新しく足した。
- 既存の eval の入力（prompt・fixture・assertion）は変えていない。#868 は文書の置き場所を変えただけで、規則に合わせた書き換えではないので、既存の eval は実行していない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 24 | 新規 | 6/6 | 4/6 | なし |

with_skill の run は `references/review-response.md` を読んだ（raw/ の Read の呼び出しで確かめた）。

## 前回より下がったものと、その原因

- 無し（新しい eval なので、比べる記録は無い）

## 気付いたこと

- without_skill も、スレッド B を A に合わせて保留し、C を直して解決することは自分で導いた。
  B の返信に A の URL と判断待ちの印を書かない点と、すべての返信をお礼で始める点で差が出た。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（without_skill の汚染の判定は `clean` だった）
