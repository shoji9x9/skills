# Skill Benchmark: parity-component

**Model**: claude-code / opus
**Date**: 2026-09-13
**Evals**: 1–6（1 run each per configuration。変更確認スコープなので Delta の数値は語らない）

## Summary

| eval | with | without | 弁別した assertion 数 |
|---|---|---|---|
| 1 前提未整備で停止 | 5/5 | 3/5 | 2 |
| 2 インスタンス 1 件 | 6/6 | 3/6 | 3 |
| 3 被覆表を見た目の根拠にしない | 4/4 | 4/4 | **0** |
| 4 来歴を確認できないデータ | 5/5 | 4/5 | 1 |
| 5 カタログ未宣言で停止 | 6/6 | 1/6 | **5** |
| 6 破壊的変更の判断を上げる | 4/5 | 2/5 | 2 |

## 経緯

iteration-1 の eval 5・6 は、fixture が参照ドキュメントの実体・要素スクリーンショット・採取成果物を欠いており、
**目的の分岐へ到達する前のゲートで停止していた**。前段ゲートを解消してから測り直したのが本 iteration。
iteration-1 の数値とは入力が違うため比較しない。

## 読み取れたこと

読み取りの詳細と、`without_skill` が見つけた fixture の欠陥は
[`skills/parity-component/evals/README.md`](../../../skills/parity-component/evals/README.md)「実走の証拠の状態（iteration-2）」に記録した。要点は 3 つ。

- **eval 5 が最も強く弁別した**（5 本）。`with_skill` はカタログ未宣言で停止し、併せて `build` の前提検証
  （採取物 8 組の実在確認・`--baseline` での軸の再導出と一致確認・スクリプト版の突き合わせ）を実行した。
  `without_skill` は停止せず部品を実装して見本まで書いた
- **eval 3 は今回も弁別ゼロ**。後退検知専用という既存の結論を再確認した
- **否定形の assertion（「停止の判断と矛盾する結論を述べていない」）は弁別に寄与しない**。
  停止した run では自動的に満たされるため、eval 1・2・4 で両 config とも通った
