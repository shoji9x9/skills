# Skill Benchmark: parity-component

**Model**: claude-code / opus（CLI 2.1.270 (Claude Code)）
**Date**: 2026-09-14
**Evals**: 5・6 のみ（各 configuration 1 run。変更確認スコープなので Delta の数値は語らない）＋ eval 5 の `parity-suite` 無し到達確認 1 run

## 何を変えたか（Issue #357）

- `breaking-change-request` の `docs/component-catalog.md` を `components.md`・`build-metadata.json` と同じ Storybook に揃えた
- `run-skill-eval.sh` に `requires_skills`（`with_skill` で姉妹スキルを併設）を足し、eval 5・6 で `parity-suite` を宣言した
- `SKILL.md` の `build` 手順 1 に「宣言と採取物の実体を先に全部調べ、欠けがあれば陳腐化へ進まない」順序を定めた
- `css-rules-capture.mjs` を 4 に上げて fixture を再生成した（出力は版の数値だけが変わった）

## Summary

| eval | with | without | 弁別した assertion 数 |
|---|---|---|---|
| 5 カタログ未宣言で停止 | **6/6** | 1/6 | **5** |
| 6 破壊的変更の判断を上げる | **5/5** | 2/5 | **3** |

`isolation.txt` は全 run `sandboxed`。`with_skill` の 2 run は使い捨てプロジェクトに `parity-component` と `parity-suite` が併設され（`required_skills: parity-suite`）、
`without_skill` の `contamination.txt` は 2 run とも `clean`（`parity-suite` の同梱物もマーカーに入っている）。得点は iteration-5 と同じ。

## 到達の確認

- **eval 5（`parity-suite` あり）**: `with_skill` は「1 段目（設定と採取物の実体）で欠けがあるので 2 段目（陳腐化）に進まない」と述べ、
  採取物 8 組の実在を確かめたうえで `references.component_catalog` と `catalog_url` / `catalog_url_command` の欠落で停止した。`without_skill` は Storybook を仮定して部品と見本を実装した
- **eval 5（`parity-suite` 無し。eval id を渡さず併設しない run、成果物は tests/ に置いていない）**: 同じく 1 段目で 2 件の欠落を挙げて停止し、
  `parity-suite` が要ることは「再実行の前に気になる点（まだ判定していない）」として別枠で挙げた。姉妹スキルの有無に依らずカタログ未宣言の分岐へ届いた
- **eval 6**: `with_skill` は影響範囲（2 インスタンス × 4 状態の見本 8 件）・代替案 A（`variant` を残して `type` を足す）・変えない場合に残るものを示して判断を仰いだ。
  カタログの実体の食い違い（iteration-4 で依頼外の不整合として挙げていた）は今回は挙げていない。`without_skill` は `component-api.md` の `variant` を `type` に書き換えた
