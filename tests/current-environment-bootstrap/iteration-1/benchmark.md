# Skill Benchmark: current-environment-bootstrap

**Model**: claude-opus-5 (`--model opus`)
**Date**: 2026-08-26T03:03:59Z
**Evals**: 1, 2, 3, 4, 5 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 93% ± 15% | 45% ± 30% | +0.49 |
| Time | 403.0s ± 167.7s | 332.2s ± 135.5s | +70.8s |
| Tokens | 888824 ± 358597 | 662219 ± 355676 | +226605 |

## 実施範囲

**ヘッダの「3 runs each per configuration」は集計スクリプトの定型文であり実態ではない。** 各 configuration **1 run**。
eval 1〜5 の全 5 件を実施（3 度の実行に分かれた。2 度はセッション上限で中断し、上限リセット後に完走）。
全 run が `sandboxed (scripts/eval-sandbox.sh)`、`without_skill` の汚染判定は 5 件とも `verdict: clean`。
`±` は eval 間のばらつきで、run 間の分散は取っていない。

| eval | with | without | 弁別の要点 |
|---|---|---|---|
| 1 `assets-complete`（**陽性コントロール**） | 5/5 | 3/5 | 揃っている資産を確定として受理できるか |
| 2 `assets-migrations-only`（別スタック） | 6/6 | 3/6 | baseline は机上導出＋バージョンの推測仮置き |
| 3 `assets-schema-unknown-semantics` | 6/6 | 2/6 | baseline は権限区分の既定値を決め打ちして投入経路に埋め込んだ |
| 4 `unknown-provenance-dump` | **4/6** | 0/6 | baseline は来歴不明 dump の構築物を作った。**with 側にも欠陥**（下記。修正後の再測定は iteration-2） |
| 5 `resume-after-answers` | 5/5 | 4/5 | baseline は投入ゲートに触れずに seed を作った |

## アナリストパス（所見）

- **eval 1（陽性コントロール）で過剰拒否は起きていない。** データ辞書に明記された項目——
  `orders.status` の値・初期状態・正常系遷移に加え**禁止遷移（2→9 は行わない）**まで——を確定として受理し、
  確定 9 件・確認待ち 8 件に分かれた。禁止事項を 10 本持つスキルが「全部止めるだけの実装」に退化していないことの証拠になる。
  一方 baseline はスキーマ構築物を作れたが、照合順序の階層別確定を欠き、暫定データとゴールデンデータの区別も持たなかった。
- **eval 4 の with_skill に実装欠陥を検出した（4/6）。** 応答は `.replace/bootstrap/` の 3 ファイルを「作成した」と
  具体的なパス・件数付きで述べたが、**実際には 1 つも書いていない**（`project-tree.txt` に `.replace` が無く、
  `project-files-skipped.txt` は 0 行＝フィルタ落ちではない）。「到達していない工程の成果物を空テンプレートで置かない」
  という規律を、モデルが「何も書かない」まで拡張した結果、停止状態が永続化されず `--resume` の再開材料が残らない。
  `SKILL.md`「停止と再開」に停止時の永続化規定を追記して修正し、**iteration-2 で 6/6 に回復**した。
- **この欠陥は応答ではなく `project-files/` を突き合わせて初めて見つかった。**
  採点の一次資料は生成物でありモデルの完了報告ではない（[.kaizen/2026-08-26-grade-from-artifacts-not-self-report.md](../../../.kaizen/2026-08-26-grade-from-artifacts-not-self-report.md)、
  `docs/skill-development.md`「採点（一次資料は成果物、応答は補助）」へ適用済み）。
- **eval 5 は弁別が弱い（5/5 対 4/5）。** fixture が既存の台帳・質問票を持つため、baseline がその様式を読んで
  3 状態（未確認／聞いたが確定できない／確定）を模倣できた。差が出たのは投入ゲート 1 本のみ。
  **`--resume` の再開位置と 3 状態の保持は、fixture に様式がある限り弁別しない**——後退検知として扱う。
- **eval 2 の assertion 2（セッション／接続レベルの照合順序）も弁別しない。** baseline も自力で同じ結論に達した。
  同じく後退検知として残す。
- **eval 1 と 5 は assertion が 5 本で、2 / 3 / 4 の 6 本目（引き継ぎ契約）を持たない。**
  6 本目は eval 2 の出力を見た後に追加したもので、1 と 5 には遡及していない。
  事前に書いた assertion より保証が弱いことを含め、次の iteration で揃えるかを判断する。
