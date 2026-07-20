# parity-diff との往復ループ（終了条件・反復上限・再入手順）

新側 green のあと `parity-diff` が検出する差分に対する往復ループの止め方と、差し戻し時の再開を定める。

## 本スキル単体の完了とループ全体の終了は別

- **本スキル単体の完了**: パリティスイートが**新に対して green** ＋ 静的解析（設定 `static_analysis`）が通る。**`parity-diff` の差分ゼロは含めない**——含めると `parity-diff`（前提に本スキルの完了を要求する）と循環する
- **往復ループ全体の終了条件**: `parity-diff` が**未説明差分ゼロ かつ 未修正回帰ゼロ**（全差分が系統差／宣言済み例外に分類済み）。「許容」例外の確定には**ユーザー承認**が要る（`parity-diff` 側で扱う）

## 反復上限

- **上限は `--max-iterations`（既定 5）。** 余白を直すと別要素がズレる（カスケード）状況で修正が新たな差分を生み続けうるため、上限を置く
- 超えたら停止してユーザーに上げる（頭から作り直さない）
- 反復回数を `.replace/parity/<slug>/replace-metadata.json` の `loop.iterations` に記録する（`max_iterations` / `last_diff_report` も）

## 差し戻し時の再入手順

- 本スキルは差分レポート `.replace/parity/<slug>/diff.md`（`parity-diff` の出力）を入力として受け取る
- **該当ページのフェーズから再開する。頭から作り直さない。** diff.md が指す差分の分類を確認し、要対応のものだけを該当ページの実装・新側マッピング・テーマの各フェーズへ差し戻す
- 差分が「テーマで消せない構造差」に該当するなら `component_diffs` 宣言または `gaps.md` 追記で扱う（[`theming.md`](theming.md)）。仕様変更で差分を消さない

## strength ゲート再実行との関係

差し戻し対応でスイートの assertion を変えた場合は、`parity-suite` の強度ゲート再実行が必要（[`new-mapping.md`](new-mapping.md) の該当節）。assertion を変えていなければ不要。
