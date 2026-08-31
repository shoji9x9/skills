# 新側ベースラインの同一条件取得

**撮るのは新側だけ。** 現行は `parity-suite` が採ったベースライン（`.replace/parity/<slug>/baseline/`。現側は 1 環境なので slug 直下）を使う。本スキルは現行アプリを駆動しない。

## 採取スペックは雛形から起こす

**新側の採取スペックを現側スペックを読んで手で書き起こさない。** 条件の一致が差分報告の前提である以上、書き写しは不一致の混入源になる。
同梱の雛形 [`../assets/capture-new.spec.template.ts`](../assets/capture-new.spec.template.ts) をプロジェクトへコピーして埋める（雛形は撮影条件を `metadata.json.capture_conditions` から読む形で書いてある。手で書き写す箇所を残さない）。

- **コピー先は `metadata.json` の `suite.new_only`**（`parity-suite` が記録した新側専用スペックの置き場所。既定 `<parity_suite_dir>/parity/<slug>/new-only/`）。パスを推測せず引く
- **`current` / `new` の両プロジェクトから除外されていることを撮影前に確認する**（同 `suite.new_only` の `testIgnore` パターン）。
  `current` から除外が無いまま現側の実行（ベースライン再取得・強度ゲート）に混ざると、**現行アプリの画面が新側ベースラインとして書き出され差分ゼロに化ける**。
  `new` から除外が無いと、採取専用の環境変数を持たない `parity-replace` の green 検証が**テスト収集の時点で落ちる**（往復ループが進まなくなる）。
  記録が無い・除外が設定されていなければ撮影せず停止し、`parity-suite` へ設定を戻す（対称の規則である現側専用スペックの除外は `parity-suite` の `references/locator-mapping.md` が正本）
- **撮影は `suite.new_only` に記録された採取専用プロジェクト（既定 `new-capture`）で実行する**（`--project new` では走らない）。プロジェクト名が記録に無ければ撮影せず停止し `parity-suite` へ戻す
- 雛形が読む撮影条件は `metadata.json.capture_conditions` の `viewports` / `states` / `pages` / `masks` / `full_page`。**`pages[].name` は `noise_baseline[].page` と同じ語彙**であることを確認する
  （語彙がずれると `PARITY_NOISE_PAIRS` による再利用の絞り込みが 1 組も一致せず、自己ノイズ測定が空振りする）。`masks[].name` はロケータマッピングで解決できる論理名であることを確認する
- `capture_conditions.cofeature_masks` は撮影条件へそのまま足さない。下記「共同居住機能の実行時マスク」で同 target の実装状態から有効集合を導出し、現側・新側の正本を保持した作業コピーへ対称に適用する
- 雛形は 1 回目（`baseline-new/`）と 2 回目（`noise-pass2/`）を同じスペックの別パスとして撮る。差分量（`pixel_diff` / `trait_diffs`）を測るのは記録済みの差分器の仕事で、スペックは撮るだけ
- 既にプロジェクトに新側採取スペックがある場合はそれを優先し、上書きしない（雛形の要件を満たしているかだけ確認する）

## URL の配線（撮影より先）

撮影も api-resource モードの発行も、選択 target の URL が Playwright に渡っていないと成立しない。**撮影の前に配線する。**

- 選択 target の `url` / `api_url`（省略時は `url`）を環境変数 `PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` に解決し、Playwright の**採取用プロジェクト**
  （`metadata.json.suite.new_only` に記録された名前。既定 `new-capture`。`new` と同じ baseURL 配線を使う）の baseURL と `request` フィクスチャへ渡す
  （`url_command` を持つ target は、本スキル実行の target 解決時に 1 回だけコマンドを実行して得た URL を使う。失敗・空出力は停止する。
  以降の工程では解決済みの値を再利用し、工程ごとに再実行しない——解決規則の正本は `replace-strategy` の `references/project-config.md`「URL の引き渡し」）
- 解決値は `new/<target>/replace-metadata.json` の `new.ui_url` / `new.api_url` と一致することを確認する（別環境の URL で撮らない）。
  記録が `"runtime"` のフィールドは解決値を持たないため、照合は **target 名の一致**で代替する（固定値で記録されたフィールド〈例: `url_command` の target の固定 `api_url`〉は従来どおり照合する）。
  `url_command` の target に `commit_check` があれば、その出力が記録の `new.commit` と一致することも確認する（不一致は green 証跡と別デプロイのため停止する）
- **配線の正本は `parity-suite` の `references/locator-mapping.md`**（`current` / `new` / `new-capture` プロジェクトの baseURL を環境変数で参照する形。URL を config に直書きしない）

## 条件一致の先行検証（差分検出より前）

環境差を差分として報告しないため、撮影前に条件一致を検証する。**不一致を検出したら差分報告をせず停止する。**

- `metadata.json.capture_conditions` の `environment` / `viewports` / `full_page` / `animations: "disabled"` / `masks` / `states` を新側で再現できるか確認する
- ビューポート寸法・アニメーション無効化・マスク適用が現行と一致していることを撮影前に検証する

### `capture_conditions_verified` は項目ごとに記録する

**「検証した」を 1 つの真偽値にまとめない**（照合できた項目と照合できなかった項目が混ざり、未検証が「検証済み」に化けるため）。
`diff-metadata.json.capture_conditions_verified` は次の 5 キーのオブジェクトで記録する。

| キー | 記録する内容 |
|---|---|
| `viewports` | 現側の `viewports` と新側の実寸、および `full_page`（全画面かビューポート内か）が一致したか（不一致は停止。画像サイズが違えば全ページが全面差分になる） |
| `animations` | `animations: "disabled"` を新側でも適用できたか（不一致は停止） |
| `masks` | 現側の `masks` のロケータを新側でも解決してマスクできたか（解決できないマスクは値に理由を残す） |
| `states` | 現側の `states` の各状態へ操作アダプタ（`metadata.json.suite.interactions`。下記「論理名の解決」）で新側でも遷移できたか（遷移できない状態は停止） |
| `environment` | 現側の `environment`（自由記述）と照合できたか |

- **`environment` は自由記述であり機械照合できない。** 原則 `"unverified: <理由>"`（例: `"unverified: 現側は記述のみで新側と機械照合できない"`）を記録し、
  同じ内容を `diff.md` の未検証領域へ転記する。照合できた場合に限り、照合した根拠（比較したブラウザ・OS・フォント等）を値に書く
- **現側 `capture_conditions.viewer_environment` が「乖離」「未確認」なら、その内容を `diff.md` の未検証領域へ転記する。** 現・新を同一条件で撮る統制は、
  **採取環境でだけ成立する一致**（総称ファミリーのフォントフォールバック先・システム UI 由来の既定値）を現・新の両側に等しく効かせるため、利用者環境でだけ壊れる差を差分ゼロとして通す。
  同一条件の検証をもって「利用者環境でも一致」と読み替えない（正本: `parity-suite` の `references/baseline.md`「採取環境と利用者環境の乖離」）
- `viewports` / `animations` が不一致、`masks` が解決できない、または `states` の状態へ遷移できない場合は**差分報告せず停止する**（未検証・不一致のまま差分検出へ進まない。別状態のスクリーンショット同士を比較して偽の回帰を報告しないため）

## 共同居住機能の実行時マスク

`capture_conditions.cofeature_masks` の候補から、実行ごとの有効集合を機械的に導出する。前回の集合や `blocked_by` は引き継がない。

1. 対象ページについて `.replace/features.md` のページ一覧を読み、対象 slug と同じページに乗る別 slug を列挙する
2. 別 slug ごとに、選択した同じ target の `.replace/parity/<slug>/new/<target>/replace-metadata.json` を読む。ファイルが無い、または `suite.new_green` が false の slug だけを未実装とする
3. 未実装 slug とページが一致する `cofeature_masks` の `regions[]` を有効集合にする。green の slug、別 target の証跡、ページ一覧に無い slug は含めない
4. 現側で記録済みの page × state × viewport ごとの `bbox` を使う。対象撮影組の矩形が無い、画像外にはみ出す、幅・高さが正でない、または所有領域が曖昧なら差分検出へ進まず `parity-suite` へ戻す
5. 新側 root の解決は必須にしない。未実装なら新側 DOM に root が無いのが正常なので、現側由来の同じ `bbox` を現側・新側の作業画像へ適用する。新側 root が解決できた場合だけ、その矩形が記録済み `bbox` 内に収まることを確認し、外なら「別領域を隠す恐れ」として停止する
6. 恒久 `masks` を適用済みの正本は上書きしない。画素は両作業画像の同じ座標へ同じマスク色を適用する。特性照合と aria は現側の `name` 配下を比較入力から外し、新側に対応 root が存在する場合だけその配下も外す。新側 root の欠落自体をエラーや aria 差分にしない

`diff.md` と `diff-metadata.json.capture_conditions_verified.cofeature_masks[]` には、ページ・状態・ビューポートごとに有効にした `slug → name + bbox`、読んだ green 証跡のパスと値、新側 root の有無を記録する。
恒久 `capture_conditions.masks` の検証結果は既存の `capture_conditions_verified.masks` にだけ記録し、共同居住マスクを混ぜない。用途を分離しないと、恒久マスクの解決成功と実行時に増減する候補集合を同じ値から判定できなくなる。
依存先が green になれば次回は集合から外れ、最終の 1 回はその領域を含む全面比較になる。共同居住マスクの外に残った未実装由来の差分だけが `blocked_by` の候補であり、マスク済み領域を差分件数や `blocked_by` に数えない。

実行結果の報告には、正常系だけでなく次の境界も含める。ここを省くと、新側 root 欠落を許す変更が別の異常まで成功扱いするように読める。

- 対象撮影組の `bbox` が欠落・非正寸法・画像外、または所有領域が曖昧なら、`blocked_by` や片側マスクへ倒さず `parity-suite` へ戻して停止する
- 新側 root は欠落してよい。存在する場合だけ対応配下を除外し、その実測矩形が現側由来 `bbox` 内に収まることを確認する。外なら別領域を隠す恐れがあるため停止する
- 同 target で green になった slug の解除、最後の解除後の全面比較、マスク済み領域を差分件数と `blocked_by` へ数えないことを示す

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

- **同一条件で 2 回撮り**、新側だけの撮り直し差分（page × state × viewport ごとの `pixel_diff` / `trait_diffs`）を測る（測る組の決め方は下記「測定値の再利用」）
- 測定結果を `diff-metadata.json.noise_baseline_new` に記録する（現側 `noise_baseline` と**同じ組**。項目は現側の値に `source` / `measured_at` を加えた形。再利用した組も含めて全組を書く）
- **現側 `noise_baseline` との乖離が大きい場合は差分報告せず停止し、ユーザーへ上げる**——新側のノイズが現側より大きいまま比較すると、
  ノイズ基準値による吸収（[`normalize.md`](normalize.md) の残余への集計適用）が実回帰を黙って飲み込む。
  乖離の要因（フォント未読み込み・アニメーション残り・遅延描画等）を潰してから撮り直す
- **判定は page × state × viewport の組ごと**に行い、`noise_baseline_new` の `pixel_diff` / `trait_diffs` が現側の同一組の値を超えた組があれば停止する（超えた組を挙げて報告する）
- **現側の基準値を新側の実測値で上書きしない**（`metadata.json` は書き換えない。ノイズ基準値の測定は現行アプリを駆動する `parity-suite` の仕事）

### 測定値の再利用（往復ループで毎反復撮り直さない）

ノイズの源泉は環境特性（フォント読み込み・アニメーションのタイミング・CDN 等）であり、`parity-replace` との往復ループの反復間ではほぼ変わらない。
**同じ target の直前実行の測定値を組（page × state × viewport）単位で再利用してよい**（既定）。再利用した組は 2 回目の撮影を省く（1 回目＝新側ベースラインの撮影は毎回行う）。

- **再利用元は同じ target の `new/<target>/diff-metadata.json`** の `noise_baseline_new` と `noise_measurement`（前回実行の記録）。
  **この実行で同ファイルを書き出す前に読む**（この実行の成果物で上書きすると前回の記録は復元できない）。**他の target の測定値は使わない**（環境が違えばノイズも違う）
- **ゲート判定（現側 `noise_baseline` との対比）は再利用した組でも毎回行う。** 省くのは撮影であって判定ではない
- 再利用の可否は下記「失効条件」で判定する。**判断材料が無い・読めない・判定が付かない場合は再利用しない**（安全側＝その組を測り直す）
- 測った組と再利用した組の別を `diff-metadata.json.noise_measurement` と `diff.md` の前提確認表に記録する（どの値がいつの測定か追えるようにする）

#### 失効条件（成立したら再測定を強制する）

**「全組」の条件がひとつでも成立すれば全組を再測定する。**成立しなければ組単位の条件だけで判定する。

| 条件 | 失効範囲 | 判定材料 |
|---|---|---|
| `--remeasure-noise` が指定された | 全組 | 実行時フラグ |
| 前回の測定記録（`noise_measurement`）が無い・壊れている・`noise_baseline_new` と組が対応しない | 全組 | `new/<target>/diff-metadata.json` |
| 撮影条件が変わった（`capture_conditions` の `viewports` / `full_page` / `states` / `masks` / `animations`） | 全組 | `noise_measurement.fingerprint.capture_conditions` と `metadata.json` の不一致 |
| 差分器のツール・しきい値が変わった（`differ.{pixel_tool,pixel_threshold,align_tolerance,aria_compare,trait_compare}` / `traits.tool`） | 全組 | 同 `fingerprint.differ` の不一致 |
| データセットバージョンが上がった | 全組 | 同 `fingerprint.dataset_version` の不一致 |
| 反復が飛んでいる（`loop.iterations` − `noise_measurement.loop_iteration` が 0 でも 1 でもない） | 全組 | `new/<target>/replace-metadata.json` の `loop.iterations`（間の反復の変更範囲を辿れない） |
| 反復が進んでいない（差が 0）のに `new.commit` が `noise_measurement.measured_at_commit` と違う | 全組 | 同 `new.commit`（ループ外で新側を触っており変更範囲を辿れない） |
| `loop.changed_scope` が無い、または `null`（範囲が未確定・未記録の `parity-replace` の証跡） | 全組 | 同上（`null` は「範囲不明」であり、`pages: []`＝「描画に効く変更なし」の申告とは別物） |
| 前反復で共有資産（テーマ・design token・共通コンポーネント・グローバル CSS・フォント読み込み等）に触れた | 全組 | `loop.changed_scope.global` が真 |
| `loop.changed_scope.pages` に現側 `noise_baseline[].page` のどれとも一致しない値がある | 全組 | 同 `pages` と `metadata.json.noise_baseline[].page`（語彙が噛み合わず範囲を突き合わせられない） |
| 前反復で変更したページ | 該当ページの組 | `loop.changed_scope.pages` |
| 組の `measured_at` から 24 時間を超えている | 該当組 | `noise_baseline_new[].measured_at` と現在時刻（別セッションの測定値を当て込まない。他の組を測り直しても古い組は失効させる） |
| 前回測っていない組がある（ページ・状態・ビューポートが増えた） | 増えた組 | `fingerprint.pairs` に無い組 |

- **新側のコミット SHA（`new.commit`）の変化を単独の失効条件にしない。** 往復ループでは毎反復変わるため単独条件にすると再利用が成立しない。
  反復が進んだ（差が 1）ときの SHA 変化は `loop.changed_scope` で範囲を判定し、**反復が進んでいないのに変わった場合だけ**（ループ外の変更で範囲を辿れない）上表のとおり全組を再測定する。
  SHA は `noise_measurement.measured_at_commit` に記録する（`changed_scope` の記録契約は `parity-replace` の `references/diff-loop.md` が正本）
- **現側 `noise_baseline` の更新は失効条件にしない**（新側の実測値は有効なまま）。新しい基準値でゲート判定だけをやり直す
- 再測定した組は測定値と**その組の** `measured_at` を更新し、再利用した組は `measured_at` を含む前回値をそのまま引き継ぐ（`noise_baseline_new[].source` で区別する）
