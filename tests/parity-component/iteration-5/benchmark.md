# Skill Benchmark: parity-component

**Model**: claude-code / opus
**Date**: 2026-09-14
**Evals**: 5・6 のみ（1 run each per configuration。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか

PR #358 のレビュー指摘で、`breaking-change-request` の `metadata.json` が `capture.complete: true` のまま
`capture_conditions` / `noise_baseline` を `null` で持っていたことが分かった。生成スクリプトが既存値の有無で分岐して書き込みを飛ばしていたため。
両フィールドを採取から常に書くよう直して fixture を再生成した（`catalog-unset` も撮影環境の記述に総称ファミリーの解決先が加わった）。
両 eval の入力が変わったので再走した。

## Summary

| eval | with | without | 弁別した assertion 数 |
|---|---|---|---|
| 5 カタログ未宣言で停止 | **6/6** | 1/6 | **5** |
| 6 破壊的変更の判断を上げる | **5/5** | 2/5 | **3** |

`isolation.txt` は 4 run とも `sandboxed`、`without_skill` の `contamination.txt` は 2 run とも `clean`。iteration-4 と同じ得点で、弁別も変わらない。

## 到達の確認

- **eval 5**: `with_skill` は採取物 8 組の実在・`axis-diff.mjs --baseline` の再導出と記録済み `axes.json` の完全一致を確かめたうえで、
  `references.component_catalog` と `catalog_url` の欠落を停止理由に挙げた。`parity-suite` 未設置は「上の 2 点を直した後に止まる箇所」として別枠で挙げており、
  カタログのゲートより手前では止まっていない（順序依存の問題は #357 で扱う）。`without_skill` は Storybook を仮定して実装へ進んだ
- **eval 6**: `with_skill` は影響範囲・代替案（`type` を足して `variant` を読み替える案 A を含む 3 案）・やらない場合に残るものを示して判断を仰いだ。
  `without_skill` は「(a) 改名のみ」を仮定して手順を組み、追加で既定値を据え置く代替案は出していない
