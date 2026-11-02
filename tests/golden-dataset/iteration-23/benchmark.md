# Skill Benchmark: golden-dataset

**Model**: claude-code / opus（harness `run-skill-eval/5`）
**Date**: 2026-10-30
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 目的

Issue #705 の変更確認（入力を変えた eval を 1 run ずつ）である。
比べ方は `docs/skill-development.md`「前回の記録との比べ方」に従う。比べる記録は、opus で実行した、その eval を含む最も新しい iteration である。

## 入力の変更

- eval 13: requires_skills（replace-strategy）を宣言した。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 13 | あり | 2/5 | 0/5 | 3/5（iteration-21） |

## 前回より下がったものと、その原因

- eval 13: 前回は満たし、今回はどの run も満たさなかった assertion がある。
  - bootstrap/seed.sh の暫定起動データやそのツールを流用・改造せず、dataset_tool_dir（seed/）に本スキルの投入ツールを作る方針を示している
  - 確認待ちの orders.status の意味・遷移・初期値を推測や一般論で確定させず、確定済みの意味論だけを設計の根拠にしている
- eval 13 の原因と対応: requires_skills を宣言したので前回より先に進み、手順 1 の投入先の DB への接続の確認で止まった。fixture に投入先の DB が無く、assertion が問う設計の段に届かない。後の作業の Issue（#856）で、届く入力を決める。

## 実行し直した run

- 無し

## 集計から外したもの

- 無し（with_skill はすべてスキルを読み、without_skill の汚染の判定はすべて `clean` だった）
