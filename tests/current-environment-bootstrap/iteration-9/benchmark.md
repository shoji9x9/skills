# Skill Benchmark: current-environment-bootstrap

**Model**: claude-code / opus（harness `run-skill-eval/3`）
**Date**: 2026-10-09
**Evals**: 1（`with_skill` と `without_skill` を 1 run ずつ）

## 何を変えたか

Issue #564 で、eval 6 の fixture の `received/app/src/Orders.tsx` に引数の型（`{ rows }: { rows: OrderRow[] }`）を書いた。
fixture を型の検査（`tsconfig.fixtures.json`、strict）の対象にしたためで、assertion が見る市販グリッドの使用と版には触れていない。
この iteration の run は、スキル本文・prompt・assertion を変えずに実行した。assertion 1 は run の後に直した（下の「assertion 1 を直した」）。

## Summary

| eval | 入力の変更 | with_skill | without_skill | 前回の with_skill |
| --- | --- | --- | --- | --- |
| 6 | fixture | 3/4 | 1/4 | 4/4（iteration-8） |

スキルの有無の差は残っている。

## 前回より下がった assertion

- 1 行目（ベンダー資料の 3 種を個別に「不足」として分類）: `with_skill` は 3 種を不足資産一覧の 1 行の括弧の中にまとめ、個別には分類しなかった。
  iteration-8 は 3 種を別の行に分けていた。
- 旧版の fixture（origin/main）と新版で、`with_skill` を 3 run ずつ（新版はこの iteration の run-1 を含む）同じ条件で実行した。
  どちらの版かを伏せて、同じ採点者が同じ基準で採点した。

| fixture | 1 行目 | 2〜4 行目 |
| --- | --- | --- |
| 旧版 | 2/3 | 9/9 |
| 新版 | 0/3 | 9/9 |

- 1 行目の合否を分けたのは、不足資産一覧で 3 種を別の行にしたかである。どの run も、分類表では 3 種を 1 行の括弧の中にまとめていた。
- 3 run ずつでは、差が fixture の変更によるものかを判断できない。iteration-8（旧版）の 1 run を足しても、旧版 3/4、新版 0/3 である。
- 比較の run は集計（`benchmark.json`）に含めていない。

## assertion 1 を直した

1 行目の assertion は、スキルの取り決めより多くを求めていた。
スキルの `references/asset-inventory.md` はベンダー資料を 1 つのカテゴリとし、機能一覧・試験仕様書・公式サンプルの所在をその中身として挙げている。
成果物のテンプレートも、3 種を括弧の中に並べた 1 行である。3 種を別の行に分けることは求めていない。
テンプレートどおりに書いた run が不合格になり、別の行に分けたかという run ごとのばらつきで合否が決まっていた。

そこで、この iteration の後に `evals.json` の 1 行目を、3 種と対象版を名指しして「不足」に分類したかを見る形に直した。
この iteration の `grading.json` と `benchmark.json` は、run の時点の assertion（`eval_metadata.json`）で採点したまま残す。
直した assertion で、同じ run をどちらの版かを伏せて採点し直した結果は次のとおりである。

| run | 直した 1 行目 |
| --- | --- |
| `with_skill`・旧版の fixture | 3/3 |
| `with_skill`・新版の fixture（この iteration の run-1 を含む） | 3/3 |
| `without_skill`（iteration-8 と、この iteration） | 0/2 |

ベースラインは「ベンダー資料（Kendo の仕様・API ドキュメント）」のようにまとめて書き、3 種を名指ししないので、スキルの有無の差は残る。

## 集計から外したもの

- 無し
