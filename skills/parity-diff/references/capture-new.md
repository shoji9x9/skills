# 新側ベースラインの同一条件取得

**撮るのは新側だけ。** 現行は `parity-suite` が採ったベースライン（`.replace/parity/<slug>/baseline/`）を使う。本スキルは現行アプリを駆動しない。

## 条件一致の先行検証（差分検出より前）

環境差を差分として報告しないため、撮影前に条件一致を検証する。**不一致を検出したら差分報告をせず停止する。**

- `metadata.json.capture_conditions` の `environment` / `viewports` / `animations: "disabled"` / `masks` / `states` を新側で再現できるか確認する
- ビューポート寸法・アニメーション無効化・マスク適用が現行と一致していることを撮影前に検証する
- 検証結果は `diff-metadata.json.capture_conditions_verified` に記録する（未検証・不一致のまま差分検出へ進まない）

## 論理名の解決

- 現側マッピングは `metadata.json.suite.locator_map`、新側例外は `replace-metadata.json.suite.locator_map_new`（`none` なら現側のみで解決）
- 状態遷移（hover / focus / active / disabled / selected / error 等）は `metadata.json.suite.interactions` の操作アダプタを再利用する（`capture_conditions.states` と同一の状態へ遷移させる）

## 特性採取

- 採取ツールは**プロジェクト側コピー** `metadata.json.suite.tools` の `trait-capture.mjs` を使う（スキル間参照ではなくプロジェクト側コピー。インストール独立性のため。正本は `parity-suite` 同梱）
- 採る対象・プロパティ集合・状態は現行と同一にする（`metadata.json.traits.property_set` / `traits.elements` / `capture_conditions.states`）
- 相対幾何は `getBoundingClientRect()` から要素対の関係を導出して比較する（絶対座標は比較しない。導出は `trait-compare.mjs` 側）

## aria スナップショット

同一ページ・同一状態で新側の aria スナップショットを採取する（[`detect.md`](detect.md) の aria 経路で現行の参考スナップショットと構造比較する）。

## 保存

- 保存先は `.replace/parity/<slug>/baseline-new/`。`parity-suite` の `baseline/` と**対称のレイアウト**にする（同じページ・状態・ビューポートの対応が取れるように）
- **書き込み可否を撮影前に検証**し、不可なら早期に失敗する（全部撮ってから保存できないと分かるのを避ける）
- テキスト（特性 JSON・aria）は Git。スクリーンショット等の大きなバイナリは `artifacts` 設定（`overrides.<slug>` を考慮）に従い、既定 `local`（コミットしない）
- **実際の保存先を `diff-metadata.json.paths.baseline_new` に記録する**（スクリーンショットは足場であり、切替後に残っている必要はない）
