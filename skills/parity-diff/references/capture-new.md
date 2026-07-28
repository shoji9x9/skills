# 新側ベースラインの同一条件取得

**撮るのは新側だけ。** 現行は `parity-suite` が採ったベースライン（`.replace/parity/<slug>/baseline/`。現側は 1 環境なので slug 直下）を使う。本スキルは現行アプリを駆動しない。

## URL の配線（撮影より先）

撮影も api-resource モードの発行も、選択 target の URL が Playwright に渡っていないと成立しない。**撮影の前に配線する。**

- 選択 target の `url` / `api_url`（省略時は `url`）を環境変数 `PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` に解決し、Playwright の **`new` プロジェクト**の baseURL と `request` フィクスチャへ渡す
  （`url_command` を持つ target は、本スキル実行の target 解決時に 1 回だけコマンドを実行して得た URL を使う。失敗・空出力は停止する。
  以降の工程では解決済みの値を再利用し、工程ごとに再実行しない——解決規則の正本は `replace-strategy` の `references/project-config.md`「URL の引き渡し」）
- 解決値は `new/<target>/replace-metadata.json` の `new.ui_url` / `new.api_url` と一致することを確認する（別環境の URL で撮らない）。
  記録が `"runtime"` のフィールドは解決値を持たないため、照合は **target 名の一致**で代替する（固定値で記録されたフィールド〈例: `url_command` の target の固定 `api_url`〉は従来どおり照合する）。
  `url_command` の target に `commit_check` があれば、その出力が記録の `new.commit` と一致することも確認する（不一致は green 証跡と別デプロイのため停止する）
- **配線の正本は `parity-suite` の `references/locator-mapping.md`**（`current` / `new` プロジェクトの baseURL を環境変数で参照する形。URL を config に直書きしない）

## 条件一致の先行検証（差分検出より前）

環境差を差分として報告しないため、撮影前に条件一致を検証する。**不一致を検出したら差分報告をせず停止する。**

- `metadata.json.capture_conditions` の `environment` / `viewports` / `animations: "disabled"` / `masks` / `states` を新側で再現できるか確認する
- ビューポート寸法・アニメーション無効化・マスク適用が現行と一致していることを撮影前に検証する

### `capture_conditions_verified` は項目ごとに記録する

**「検証した」を 1 つの真偽値にまとめない**（照合できた項目と照合できなかった項目が混ざり、未検証が「検証済み」に化けるため）。
`diff-metadata.json.capture_conditions_verified` は次の 5 キーのオブジェクトで記録する。

| キー | 記録する内容 |
|---|---|
| `viewports` | 現側の `viewports` と新側の実寸が一致したか（不一致は停止） |
| `animations` | `animations: "disabled"` を新側でも適用できたか（不一致は停止） |
| `masks` | 現側の `masks` のロケータを新側でも解決してマスクできたか（解決できないマスクは値に理由を残す） |
| `states` | 現側の `states` の各状態へ操作アダプタ（`metadata.json.suite.interactions`。下記「論理名の解決」）で新側でも遷移できたか（遷移できない状態は停止） |
| `environment` | 現側の `environment`（自由記述）と照合できたか |

- **`environment` は自由記述であり機械照合できない。** 原則 `"unverified: <理由>"`（例: `"unverified: 現側は記述のみで新側と機械照合できない"`）を記録し、
  同じ内容を `diff.md` の未検証領域へ転記する。照合できた場合に限り、照合した根拠（比較したブラウザ・OS・フォント等）を値に書く
- `viewports` / `animations` が不一致、`masks` が解決できない、または `states` の状態へ遷移できない場合は**差分報告せず停止する**（未検証・不一致のまま差分検出へ進まない。別状態のスクリーンショット同士を比較して偽の回帰を報告しないため）

## 論理名の解決

- 現側マッピングは `metadata.json.suite.locator_map`、新側例外は選択 target の `new/<target>/replace-metadata.json` の `suite.locator_map_new`（`none` なら現側のみで解決）
- 状態遷移（hover / focus / active / disabled / selected / error 等）は `metadata.json.suite.interactions` の操作アダプタを再利用する（`capture_conditions.states` と同一の状態へ遷移させる）

## 特性採取

- 採取ツールは**プロジェクト側コピー** `metadata.json.suite.tools` の `trait-capture.mjs` を使う（スキル間参照ではなくプロジェクト側コピー。インストール独立性のため。正本は `parity-suite` 同梱）
- 採る対象・プロパティ集合・状態は現行と同一にする（`metadata.json.traits.property_set` / `traits.elements` / `capture_conditions.states`）
- 相対幾何は `getBoundingClientRect()` から要素対の関係を導出して比較する（絶対座標は比較しない。導出は `trait-compare.mjs` 側）

## aria スナップショット

同一ページ・同一状態で新側の aria スナップショットを採取する（[`detect.md`](detect.md) の aria 経路で現行の参考スナップショットと構造比較する）。

## 保存

- 保存先は選択 target の `.replace/parity/<slug>/new/<target>/baseline-new/`（**環境別**。他の環境の新側ベースラインを上書きしない）。`parity-suite` の `baseline/` と**対称のレイアウト**にする（同じページ・状態・ビューポートの対応が取れるように）
- **書き込み可否を撮影前に検証**し、不可なら早期に失敗する（全部撮ってから保存できないと分かるのを避ける）
- テキスト（特性 JSON・aria）は Git。スクリーンショット等の大きなバイナリは `artifacts` 設定（`overrides.<slug>` を考慮）に従い、既定 `local`（コミットしない）
- **実際の保存先を `diff-metadata.json.paths.baseline_new` に記録する**（スクリーンショットは足場であり、切替後に残っている必要はない）

## 新側の自己ノイズ測定（差分検出へ進む前のゲート）

ノイズ基準値（`metadata.json.noise_baseline`）は**現側 1 環境の測定値**であり、新側の target にそのまま流用できるとは限らない（CDN・フォント読み込み等で環境ノイズは変わる）。

- **同一条件で 2 回撮り**、新側だけの撮り直し差分（page × state × viewport ごとの `pixel_diff` / `trait_diffs`）を測る
- 測定結果を `diff-metadata.json.noise_baseline_new` に記録する（現側 `noise_baseline` と同じ形・同じ組）
- **現側 `noise_baseline` との乖離が大きい場合は差分報告せず停止し、ユーザーへ上げる**——新側のノイズが現側より大きいまま比較すると、
  ノイズ基準値による吸収（[`normalize.md`](normalize.md) の残余への集計適用）が実回帰を黙って飲み込む。
  乖離の要因（フォント未読み込み・アニメーション残り・遅延描画等）を潰してから撮り直す
- **判定は page × state × viewport の組ごと**に行い、`noise_baseline_new` の `pixel_diff` / `trait_diffs` が現側の同一組の値を超えた組があれば停止する（超えた組を挙げて報告する）
- **現側の基準値を新側の実測値で上書きしない**（`metadata.json` は書き換えない。ノイズ基準値の測定は現行アプリを駆動する `parity-suite` の仕事）
