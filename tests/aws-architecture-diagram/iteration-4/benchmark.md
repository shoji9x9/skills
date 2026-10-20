# Skill Benchmark: aws-architecture-diagram

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-20
**Evals**: 4（`with_skill` を 1 run ずつ）

## 何を変えたか

Issue #653 で、スキルから実行するスクリプト（`render-diagram.mjs`・`preview-diagram.mjs`・`fetch-aws-icons.mjs`・`diagram-engine.mjs`・`diagram-config.mjs`）を `assets/engine/` から `scripts/` に移し、SKILL.md・references・assets の中のパスの記述を直した。

eval の入力は変えていない。スキル本文が変わったので、すべての eval を with_skill だけで実行した。
実行の後、ローカルレビューの指摘で SKILL.md の `scripts/` のファイルの一覧に `diagram-config.mjs` と `skill-config/` を足し、starter のコメントの言い回しを直した。どちらも eval の手順に関わらないので、実行し直していない。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | なし | 5/5 | - | 5/5（iteration-2） |
| 2 | なし | 5/5 | - | 記録なし |
| 3 | なし | 1/4 | - | 1/4（iteration-3） |
| 4 | なし | 5/6 | - | 4/6（iteration-2） |

前回の記録がある eval 1・3・4 は、どれも前回から下がっていない。eval 2 は前回の記録が無い。

## with_skill で満たさなかった assertion

- eval 3: fixture に spec も Terraform も無く、作図まで進まなかった。iteration-3 と同じで、#653 の変更とは関係しない。
  - SQS ノード/エッジを spec に追加し、conventions.md の作図ルール（進入位置のずらし等）を維持している
  - icon-manifest.json に SQS があることを確認し、無ければ fetch-aws-icons.mjs で aws-icons/ に取得する
  - render → PNG 目視確認のループで仕上げている
- eval 4: 直す対象の図が無く、PNG を実際に確認していない。
  - 推測で断定せず PNG を実際に確認して判断している

## 実行し直した run

- 無し

## 集計から外したもの

- 無し
