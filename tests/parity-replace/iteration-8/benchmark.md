# Skill Benchmark: parity-replace

**Model**: claude-opus-5
**Date**: 2026-07-30T03:16:07Z
**Evals**: 10 (1 run each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 25% ± 0% | +0.75 |
| Time | 75.1s ± 0.0s | 49.5s ± 0.0s | +25.6s |
| Tokens | 164469 ± 0 | 98558 ± 0 | +65911 |

## 対象と結果（Issue #159 ファイル入出力・ストレージ）

eval 10 は「アップロードを presigned 化し保存ファイル名の規則も変えるが、内部実装だからレジストリには書かない」という要求への応答を見る。

- with_skill 4/4: 2 件とも `intentional_diffs.pending` へ非破壊追記して個別確認、`upload_route` 未宣言のまま実装しない、一括分類指示に従わない、前提未達（`suite.current_green` / `verification_commands` 欠落・slug 未確認）で実装工程に入らず停止
- without_skill 1/4: 「内部実装だから不要」の否定だけは一般的推論で到達（漏れる経路を列挙）。レジストリの手続き・設定キーの宣言・前提検証はいずれも出ない

## eval 10 のアサーション修正（到達性）

初版のアサーション 3・4 は「フェーズ内の読み取り → 書き込み順序」「事前配置依存の画面を green にしない」を問うていたが、
これは前提（`parity-suite` の現側 green 等）が揃った後の実装工程の内容であり、fixture なしの本 eval では**スキルが正しく手順 1 で停止するため原理的に到達できない**
（`.kaizen/2026-07-23-eval-assertion-discrimination.md` の「到達」）。到達可能かつ skill 固有な述語（`upload_route` の宣言が実装の前提・一括分類指示の拒否・前提未達での停止と slug 非採番）へ差し替えて採点した。
実装工程の内容を測るには fixture（設定・`.replace/` 一式）が必要で、本 iteration では追加していない。

あわせて `references/paging.md` に、`presigned` はアプリサーバを通らないため API パリティの対象面が変わる旨を追記した（with_skill run は波及先を挙げたが API 面までは述べなかったため）。

## ベースラインの read 汚染について

`without_skill` は `scripts/eval-sandbox.sh`（4 群遮断）経由・逐次で取得。事前 2 段検証と事後のマーカー grep（15 語）はいずれも 0 件で汚染なし
（前 iteration では同時実行で汚染していた箇所）。経緯と手順は `tests/replace-strategy/iteration-10/benchmark.md` の同節を参照。
