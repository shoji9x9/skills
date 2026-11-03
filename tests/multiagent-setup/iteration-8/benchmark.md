# Skill Benchmark: multiagent-setup

**Model**: claude-code / opus（harness `run-skill-eval`）
**Date**: 2026-11-03
**Evals**: 2（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

PR #866 の 2 回目のレビューを受けて、スキル作成手順を直した。
利用者に確かめられない実行では、期待する振る舞いの候補を示して止まる。実行のたびに新しいコピーを使い、使い終わったら外す。4 も全項目が起きたら 3 回まで実行する。
eval 1 の prompt に期待する振る舞いを書き、比べてから作る流れを確かめる形にした。
依頼に期待する振る舞いが無いときに候補を示して止まる分岐を、eval 9 として足した（prompt は元の eval 1 と同じ）。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | prompt と assertion の書き換え・スキル本文 | 4/4 | 1/4 | 比べない（prompt と assertion の文を変えたので） |
| 9 | 新規 | 3/3 | 1/3 | - |

eval 1 の with_skill は、スキル無しの 3 回で期待する振る舞いがすべて起きたので、スキルを書かずに結果を示して作るかを確かめた。
この run は SKILL.md を作らなかったので、作成の場所とリンクを確かめる 2 本の assertion は条件により満たしただけで、作成の流れは確かめていない。
eval 9 の「比べる実行に進んでいない」は、without_skill もスキルの有無を比べないので満たし、区別に寄与しない。

## 前回より下がった eval の切り分け

- 無し（文を変えたので、前回と比べない）

## 集計から外したもの

- 無し
