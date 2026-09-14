# Skill Benchmark: parity-component

**Model**: claude-code / opus（CLI 2.1.270 (Claude Code)）
**Date**: 2026-09-14
**Evals**: 5・6 の `without_skill` のみ（各 1 run。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか（PR #362 の Codex レビュー指摘）

iteration-6 は `requires_skills` の姉妹スキル（`parity-suite`）を `with_skill` にだけ設置していたため、
比較が「対象スキル＋姉妹スキル」対「スキル無し」になり、姉妹スキルの効果が対象スキルの Delta に混ざっていた。
`run-skill-eval.sh` を、姉妹スキルを両 configuration に設置し対象スキルだけを `with_skill` に足す形に直した。
`with_skill` の環境は変わらないので iteration-6 の `with_skill` をそのまま使い、入力が変わった `without_skill` だけを取り直した。

## Summary

| eval | with（iteration-6） | without（iteration-7） | 弁別した assertion 数 |
|---|---|---|---|
| 5 カタログ未宣言で停止 | **6/6** | 3/6（iteration-6: 1/6） | **3** |
| 6 破壊的変更の判断を上げる | **5/5** | 3/5（iteration-6: 2/5） | **2** |

2 run とも `isolation.txt` は `sandboxed`、使い捨てプロジェクトに `parity-suite` だけが設置され、`contamination.txt` は `clean`
（マーカーは `parity-component` の同梱物 11 件。`parity-suite` にも同じパスがある `assets/metadata-template.json` は除外された）。

## 読み取れたこと

- **姉妹スキルを baseline にも入れると baseline の点が上がった。** iteration-6 の Delta の一部は `parity-suite` の有無によるものだった（指摘どおり）
- **eval 5**: `without_skill` は `parity-suite` の SKILL.md から `parity-component` の存在を知り、「スキルが未導入なので build しない」と停止した（iteration-6 は実装まで進んだ）。
  停止・Storybook を決め打ちしない・採取物の実体確認は満たすが、設定の `references.component_catalog` / `catalog_url` の欠落は検出せず、
  「build の材料は揃っているように見える」と前提が揃っているかのように述べた（assertion 1・4・6 が落ちる）
- **eval 6**: `without_skill` は実装が無いことを理由に何も変更せず、`type` と HTML 属性の衝突について判断を求め、呼び出し側・見本・再照合 8 件を影響範囲に挙げた。
  破壊的変更という判断と「引数を足して既定値を据え置く」代替案は出していない（assertion 1・4 が落ちる）
