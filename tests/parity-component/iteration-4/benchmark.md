# Skill Benchmark: parity-component

**Model**: claude-code / opus
**Date**: 2026-09-14
**Evals**: 5・6 のみ（1 run each per configuration。変更確認スコープなので Delta の数値は語らない）

## 何を変えたか

Issue #354 で `catalog-unset` / `breaking-change-request` の採取物（`baseline/`・`axes.json`・`metadata.json` のツール版とプロパティ集合）を、
手書きから `scripts/generate-parity-component-fixtures.js` による実物のツールの出力へ作り直した。
fixture が変わったので、目的の分岐へ到達することを実走で確かめる（Issue の受け入れ条件）。

## Summary

| eval | with | without | 弁別した assertion 数 |
|---|---|---|---|
| 5 カタログ未宣言で停止 | **6/6** | 1/6 | **5** |
| 6 破壊的変更の判断を上げる | **5/5** | 2/5 | **3** |

`isolation.txt` は 4 run とも `sandboxed`、`without_skill` の `contamination.txt` は 2 run とも `clean`。

## 到達の確認

- **eval 5 は目的の分岐（カタログ未宣言）で停止した。** `with_skill` は前提検証として採取物 8 組の実在・`axis-diff.mjs --baseline` の再導出と記録済み `axes.json` の完全一致・
  `css_rules_version` 3 / `axis_diff_version` 2 とスクリプトの `VERSION` の一致を確かめたうえで、`references.component_catalog` と `catalog_url` の欠落を停止理由に挙げている。
  iteration-2 で問題になった `traits_property_set` の不一致・計算値と規則の食い違いは指摘されなかった。
  `without_skill` は停止せず Storybook を選んで実装まで進んだ（採取物は材料として読んだが、今回は不整合を挙げていない）
- **eval 6 は目的の分岐（破壊的変更の判断を上げる）へ到達した。** `with_skill` は影響範囲（生成し直した採取物の色を引用）・代替案（`type` を足して `variant` にフォールバック）・
  やらない場合に残るものの 3 点を示して指示を仰いだ。`without_skill` は `component-api.md` の引数を書き換え、判断を求めていない

## 注意点

- eval 5 の `with_skill` は、停止理由の補足として「`parity-suite` がインストールされておらず trait-capture の版を確かめられない」ことも挙げた。
  今回足した「`parity-suite` 同梱ツールの用意」はインストール済み `parity-suite` が無ければ停止する工程なので、**ハーネスが姉妹スキルを設置しない限り、
  この fixture はカタログのゲートより手前でも止まりうる**。今回はカタログの判定が先に来たため目的の分岐へ届いたが、手順の順序が変わると到達しなくなる。
  `build` の手順 1 はカタログの宣言を先に見る並びなので現状は成立している
- eval 6 の `with_skill` は、`components.md`（Storybook）と `docs/component-catalog.md`（自前ページ）の記述の食い違いを依頼外の不整合として挙げた。
  採取物ではなく参照ドキュメント側の fixture の不整合で、eval の判定には影響しない
