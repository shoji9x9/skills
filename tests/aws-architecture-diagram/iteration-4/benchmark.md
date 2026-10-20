# Skill Benchmark: aws-architecture-diagram

**Model**: claude-code / opus（harness `run-skill-eval/4`）
**Date**: 2026-10-20
**Evals**: 4（`with_skill` を 1 run ずつ）

## 何を変えたか

Issue #653 で、スキルから実行するスクリプト（`render-diagram.mjs`・`preview-diagram.mjs`・`fetch-aws-icons.mjs`・`diagram-engine.mjs`・`diagram-config.mjs`）を `assets/engine/` から `scripts/` に移し、SKILL.md・references・assets の中のパスの記述を直した。

eval の入力は変えていない。スキル本文が変わったので、すべての eval を with_skill だけで実行した。
結果は、PR #728 の最終版の SKILL.md（`scripts/` のファイルの一覧に `diagram-config.mjs` と `skill-config/` を足した版）で実行したものである。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 1 | なし | 5/5 | - | 5/5（iteration-2） |
| 2 | なし | 5/5 | - | 記録なし |
| 3 | なし | 1/4 | - | 1/4（iteration-3） |
| 4 | なし | 4/6 | - | 4/6（iteration-2） |

前回の記録がある eval 1・3・4 は、どれも前回から下がっていない。eval 2 は前回の記録が無い。

## with_skill で満たさなかった assertion

- eval 3: fixture に spec も Terraform も無く、作図まで進まなかった。iteration-3 と同じで、#653 の変更とは関係しない。
  - SQS ノード/エッジを spec に追加し、conventions.md の作図ルール（進入位置のずらし等）を維持している
  - icon-manifest.json に SQS があることを確認し、無ければ fetch-aws-icons.mjs で aws-icons/ に取得する
  - render → PNG 目視確認のループで仕上げている
- eval 4: 直す対象の図が無く、run は starter のコピーで症状を再現して、エンジンに自動配置と警告を足す方向に進んだ。waypoints と labelAt を使う直し方は示さなかった。
  - waypoints で直交化し、lp（ノードのラベル位置）を線の出ていない辺へ移す方針を示している
  - エッジラベルは屈曲点を避けて自動配置されるため waypoints でラベルを動かす必要が無く、位置を明示するときは labelAt を使うと示している

## 実行し直した run

- 4 件すべて。最初の実行の後に SKILL.md を変えたので、最終版で実行し直した（PR #728 の Copilot のレビューの指摘）。最初の実行の結果は、eval 1: 5/5、eval 2: 5/5、eval 3: 1/4、eval 4: 5/6 だった。

## 集計から外したもの

- 無し
