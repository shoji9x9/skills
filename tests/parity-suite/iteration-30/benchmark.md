# Skill Benchmark: parity-suite

**Model**: claude-code / claude-opus-5（CLI 2.1.270 (Claude Code)）
**Date**: 2026-09-14
**Evals**: 33 のみ（`with_skill` / `without_skill` 各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（PR #363 の Copilot レビュー 3 回目）

`popup_inventory` の行の排他（撮る行は `reason: null`、撮らない行は `captured: null` と空でない `reason`、両方を埋めた行は不整合）を eval 33 の assertion 3 に足した。assertion が変わったので eval 33 だけを取り直した（eval 32 は iteration-29 のまま）。

## Summary

| eval | with | without | 弁別した assertion |
|---|---|---|---|
| 33 器の棚卸し | **6/6** | 2/6（iteration-29: 1/6） | 4（3 経路に出ない説明・`popup_inventory` と排他・`gaps.md` の種別・開く関数との突き合わせ） |

2 run とも `isolation.txt` は `sandboxed`、`without_skill` の `contamination.txt` は `clean`。

## 読み取れたこと

- `without_skill` は今回、入れ子の器と指を乗せた状態まで挙げて assertion 2（再帰的に数える）を満たした。iteration-29 では満たさなかったので 1 run の揺れの範囲で、この項目は弁別が安定しない
- 排他の記録は独自マニフェスト（captured / delegated / excluded）で表しており、`popup_inventory` の `captured` / `reason` の排他や `gaps.md` の種別には到達しない
