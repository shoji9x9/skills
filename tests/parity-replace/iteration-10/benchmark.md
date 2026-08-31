# Skill Benchmark: parity-replace

**Model**: claude-opus-5 (`--model opus`)
**Date**: 2026-08-31T11:45:06Z
**Evals**: 14, 15 (1 run each, `with_skill` only)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% (10/10) | 未実測 | — |
| Time | 94.3s / 110.8s | 未実測 | — |
| Tokens | 144880 / 200165 | 未実測 | — |

## 実施範囲

`verification_commands` の `full` / `diff` 2 列化（Issue #265）で**新設した eval 14・15 のみ**を対象にした。
レートリミット節約のため **`without_skill` は実行していない**——本イテレーションの目的は
新設した契約が skill 経由で成立するかの**確認**であり、Delta の測定ではない。
Delta 列が空なのはこのためで、後退検知としても比較対象を持たない。隔離は両 run とも `sandboxed`。

## アナリストパス（所見）

- **eval 15（本 Issue の中核）は 5/5。** pre-commit の差分限定が緑でも完了判定にならないこと、
  design token 削除で壊れる相手が変更集合の外にいること、手順 7 の `full` 前倒し、
  `diff_run.escalated_to_full` への記録、完了を名乗らないこと、すべてを自力で述べた。
  `full` の 2 本のうち `npm run typecheck` が pre-commit で一度も走っていない点まで指摘しており、
  「列の対応」を表面的になぞったのではなく設定を読んで判定している。
- **`.replace/strategy.md` 不在時のフォールバックが実際に効いた。** eval 15 は当該ファイルの不在を
  記録しつつ進行し、停止しなかった（コードレビューで追加した規定の実走確認）。
- **eval 14 は assertion 3 が到達不能と判明したため書き換えた。** 旧 assertion は
  「スクリプト側の引数の扱いまで読んで確かめる」を要求していたが、この知識は
  `replace-strategy` の `references/project-config.md`「走る範囲」にあり、
  `with_skill` は対象スキルだけを設置するため `parity-replace` 単独では原理的に読めない。
  `parity-replace` 自身が持つ契約（移行の正本を示して委ねる）を測る形へ差し替えた。
  altitude を保ったまま到達可能にする対処であり、契約を弱めてはいない。
- **eval 14 の assertion 4 は含意どまり。** 停止の正当化は述べたが「完了判定が成立しない」の明示は無い。
  pass としたが根拠は弱く、run 間で揺れうる。
