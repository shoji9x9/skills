---
name: parity-diff
description: 仕様を変えないアプリケーションリプレイスで、parity-suite が採取したベースライン・ノイズ基準値・強度ゲートで検証済みの差分器を使い、現行と新側の差分を決定論的ツールで検出して分類する replace-strategy の姉妹スキル。検出は画素・特性照合・aria の 3 経路が担い、LLM には「差分があるか」を聞かず「この差分は重要か」だけを 1 件ずつ crop 対で聞いて要対応／許容／環境ノイズに分類する。新側環境は --target で選び成果物は環境別。要対応は parity-replace へ差し戻し、収束は未説明差分ゼロかつ未修正回帰ゼロ。1 回で 1 機能。replace-strategy setup・golden-dataset・対象 slug の parity-suite・parity-replace の新側 green が前提で、未完了なら捏造せず停止する。「現新の差分を検出して」「差分を分類して」「parity-diff」や --feature / --target を伴う依頼で発動する。
argument-hint: "[--feature <slug>] [--target <name>] [--remeasure-noise]"
license: MIT
---

# Parity Diff

`replace-strategy` の姉妹スキル。**現行と新側の差分を決定論的ツールで検出し、モデルには分類だけを担わせる**ところを担う。

- **検出は決定論的ツールの仕事、モデルの仕事は分類だけ。** モデルに「差分があるか」を聞かず（＝探させず）、決定論的ツールが検出済みの差分について「この差分は重要か」だけを聞く
- **`parity-replace` との住み分け**: `parity-replace` はスイートが見ている範囲（新に対して green か）、本スキルはスイートに写らない差分（余白・色・フォント・角丸・行間・罫線等の見た目）を扱う
- **1 回の実行につき 1 機能。** ページ単位で処理する。差分の**修正は行わない**——要対応は `parity-replace` へ差し戻す

## 使い方

```text
parity-diff [--feature <slug>] [--target <name>] [--remeasure-noise]
```

- **1 回の実行につき 1 機能。** 複数機能を並行して進めない
- `slug` は `.replace/features.md` が採番したもの。**自分で採番しない。** 省略時は features.md の未着手から対話選択する
- `--target` は差分を検出する**新側の環境**（`skills.replace-strategy.targets` のうち `side: new` のもの。本スキルが対象とする側の宣言はここが正本）。
  省略時の既定・候補提示・存在しない名前や側違いでの停止といった**選択規則は `replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う**（ここへ転記しない）。
  **成果物は環境ごとに分かれる**（下記「成果物」）
- `--remeasure-noise` は新側の自己ノイズを**全組で測り直す**（既定は前回実行の測定値を組単位で再利用する。再利用の可否・失効条件は [`references/capture-new.md`](references/capture-new.md)「測定値の再利用」が正本）
- **モードは `.replace/parity/<slug>/metadata.json` の `mode`（feature / api-resource / batch）を正として引く**（フラグは無い。features.md の表位置から再導出しない）
- 自然文でも発動する:「現新の差分を検出して」「差分を分類して」「この画面の差を見て」

| モード | 内容 |
|---|---|
| 機能（feature） | 画素・特性照合・aria の 3 経路で検出し、正規化 → トリアージ → 収束判定 |
| 横断 API（api-resource） | 画面系 3 経路は動かさない。現行応答（record/replay）を正に新側応答を構造比較（[`references/api-batch.md`](references/api-batch.md)） |
| バッチ（batch） | 視覚経路は使わない。現行ベースライン（DB 状態・生成ファイル）と新側出力を決定論的に構造・バイト比較（[`references/api-batch.md`](references/api-batch.md)） |

## 前提

前提が欠けたら**捏造せず停止**し、該当スキルを依存順に案内する（検出・成果物・ベースラインを作り出さない）。判定は指定パスの Read で行う。

- **ツール**: `git`、Node.js。画素経路は記録済み画素差分ツールの出力（差分画像）を読むため `pngjs` を要する（[`references/detect.md`](references/detect.md)）
- **前提スキル（依存順）**: `replace-strategy`（`setup` 完了）→ `golden-dataset`（フェーズ A・B）→ 対象 slug の `parity-suite`（完了）→ `parity-replace`（**選択した target で**新側 green）
- **前提スキルが未インストールの場合**: `gh skill install shoji9x9/skills <name>` で導入してから実行する。
  本スキルは設定スキーマ・成果物様式の**正本を `replace-strategy` / `parity-suite` の `references/` / `assets/` に持つ**ため、単体では成立しない（同時に導入されている前提）
- **`issue-create`**: 選択した target の `on_diff` ドキュメントが Issue 起票を指示する場合のみ必要（要対応差分の起票を委譲する）
- **本スキルは現行アプリを駆動しない。** ノイズ基準値・視覚ベースラインの測定は `parity-suite` の仕事。撮るのは新側だけ
- 判定の詳細（target の解決・起動・モード別の要求・確認するキーのフルパス・データセットバージョンの三者一致・差分器バージョン一致・反復上限）は [`references/preflight.md`](references/preflight.md)

## 厳守の制約（禁止事項）

- **差分調査は十分な証拠が得られる最小コストの経路から始める。** 選択した target から採取され、前提ゲートで対象版・採取時点・条件の一致を確認した差分成果物／観測記録 → 現行／新側ソースコード → API の実動作 → UI の実動作の順に原因を切り分け、
  下位の証拠だけでは分類できない場合に限って次へ上げる。これは調査コストが差分成果物／観測記録 < ソースコード < API 操作 < UI 操作の順に高くなるためで、必要な証拠が得られた時点で止め、API／UI 操作は不足する場合だけ行う。
  設計書・仕様書・受領ログを含む受領資料は調査候補の抽出に使ってよいが、現行挙動の確定根拠にはしない。画面差の観測条件確認は UI で行う

- **LLM に「差分があるか」を聞かない**（検出させない）。検出は決定論的ツール、モデルは分類のみ
- **モデルの「もう同じに見えます」を収束根拠にしない**
- **全画面のスクリーンショット対をモデルに渡して比較させない。** トリアージは差分領域の crop 対を 1 件ずつ渡す。スイート外の依頼（「2 枚を見比べて違いを見つけて」等）にも**目視検出を代替提供しない**——決定論的ツール（画素経路）に検出させてから分類だけを担う。
  **拒否するときは正しい進め方（決定論的ツールに検出させ、差分領域の crop 対を 1 件ずつ提示して要対応／許容／環境ノイズの 3 値に分類する）を必ず添える**
- **現行と異なる条件で新側を撮らない**（環境差を差分として報告しないため）
- **失効条件を確かめずに自己ノイズ測定値を再利用しない。** 判断材料が欠ければ再利用せず測り直す（安全側）。再利用してもゲート判定は毎回行う
- **カタログサイト（コンポーネントライブラリの見本）を比較の正解にしない。** 正解は動いている現行アプリ
- **ピクセル比較系 VRT ツールで新旧を突き合わせない**（実装が違えば全面赤になり無意味）
- **差分をしきい値で潰さない**（特性照合の別経路で捉える）
- **xlsx・PDF をバイト一致で比較しない**（揮発項目が入るため一致しない）。xlsx はシート × セル値と構造、PDF は抽出テキストと構造で比較する。
  **解析ツールは `metadata.json.differ.file_extract` の記録値を使い、自分で選び直さない**（現側と抽出ツールが変われば差分がツール差か実装差か切り分けられない。正本: `replace-strategy` の `references/file-io.md`）
- **テキストの幅・字形の差を切り分けずに分類しない。** 「同じフォント名だから」で環境ノイズ・許容にしない——版（`head.fontRevision`）とヒンティング命令の有無で決まるため、[`references/font-diff.md`](references/font-diff.md) の手順で切り分けてから分類する
- **コンポーネント差分をインスタンス単位の無視リストで飲み込まない。** クラス/トークン単位の系統差 T（`component_diffs`）で宣言し、T からの逸脱を検出する。
  ただし**画素経路でしか出ない差**（computed style は一致し描画だけ違う）は T の照合キーが無く `component_diffs` では吸収されないため、インスタンス例外（`property: pixel`）が唯一の置き場所（レジストリごとに効く経路の正本は [`references/normalize.md`](references/normalize.md)）
- **インスタンス例外を設定ファイル（`.config/skills/shoji9x9/skills.yml`）へ書かない。** slug スコープの台帳なので `.replace/parity/<slug>/component-diff-exceptions.json` に書く（旧キーが残っていたら移行を案内して停止する）
- **同一原因の複数インスタンスに同じ `reason` を複製しない。** 原因は `component_diff_exception_causes[]` に 1 回定義して `cause` で参照する（インスタンスに `reason` フィールドを持たせない）
- **例外のインスタンス件数を畳まない。** `page` / `element` / `bbox` にワイルドカードを置いて 1 エントリで N 箇所を吸収させない——**例外の件数は検証の弱さのシグナル**であり、行数削減のために隠さない
- **承認済み例外の根拠を `gaps.md` に書かない。** `gaps.md` は未検証領域の台帳で、そこに置くと承認済み（説明済み・許容）と未検証が混ざる。宛先は `component-diff-exceptions.md`
- **承認前の分類を成果物に「許容」と書かない。** 承認前は `許容候補（要確認）` と書き、収束判定では未説明として数える（分類がレポートに載った時点で後続の判断の入力になるため）
- **観測条件を列挙せずに仮説を検証しない。** 差分が出た条件（要素・サイズ・ウェイト・状態）で測る——手近な代表値 1 点の結果を全体に一般化しない。
  比較の相手は常に**現行**であり、新側の実験変種どうしの一致を結論にしない。結論を成果物に書くときは測定条件を併記する（書けない結論は未説明のまま残す）
- **他機能の未実装に由来して解消できない差分を、`converged: true` で押し通さない／`parity-replace` へ差し戻さない。** `blocked_by` に帰属させて停止し、依存先の実装後に再実行する（[`references/convergence.md`](references/convergence.md)）
- **共同居住機能の未実装領域を、実行時マスクより先に `blocked_by` へ分類しない。** 新側 root の欠落は通常状態なので、現側ベースラインで測定済みの target 非依存 `bbox` を両作業画像へ適用し、特性・aria の同領域も除外してから差分検出する。`blocked_by` はマスク外へ残った差分だけに使う
- **生の差分ゼロを収束条件にしない。** 収束＝未説明差分ゼロ かつ 未修正回帰ゼロ
- **名前の付かない要素の見た目差を「computed style で保証済み」と扱わない**（特性照合は名前付き要素しか見ない。名前無しは画素経路の担当）
- **セル/行/フィールドに論理名を付けてテーブル/フォームを比較しない**（内容パリティは aria 経路が担う）
- **未検証の箇所を「確認済み」にしない**（ベースラインに写らない箇所・宣言できない構造差は `diff.md` に未検証として残す）
- **差分の修正を自分で行わない**（`parity-replace` へ戻す）
- **現行アプリを駆動しない**（ノイズ基準値の測定は `parity-suite` の仕事）
- **差分器・トリアージ補助に依存を追加するとき、配布元の素性・ライセンス・メンテナンス状況を確認せずに導入しない**（既存パッケージを探さずに自前実装を始めるのも同様）。判断材料・工程の正本は `replace-strategy` の `references/dependency-selection.md`、記録先は `.replace/dependencies.md`
- **シークレットの値をコード・コメント・ログ・成果物・スクリーンショットに残さない**（環境変数名だけを扱い、値は復唱しない。正本: `replace-strategy` の `references/project-config.md`「シークレットの扱い」）

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を**直接読む**（転記しない）。スキーマの正本は `replace-strategy` の `references/project-config.md`。本スキルが読む・書くキー:

| キー | 読/書 | 用途 |
|---|---|---|
| `targets[]`（`side: new`） | 読 | 差分検出の対象環境。`--target` で選択（選択規則は上記「使い方」の正本参照。ここへ転記しない）。`url` / `api_url` は新側疎通・撮影先・api-resource モードの発行先（`PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` に解決。`url_command` の target はコマンド実行で解決し、失敗・空出力は停止）、`pre_commands` / `start` / `check_urls` は撮影前の起動・稼働確認、`on_diff`（対応手順ドキュメントのパス）は要対応差分が残ったときの分岐（手順 7）。**投入対象でない target**（`dataset_mode: db` で `db` 未定義、または `db.env_vars` はあるが `seedable` の無い読み取り専用）**はゴールデンデータ未投入**＝データセットバージョンの三者一致を要求しない代わりに、データ依存の差分を「未検証」として `diff.md` に明記する（[`references/preflight.md`](references/preflight.md)） |
| `intentional_diffs.{keep,may_change,pending}` | 読 | 意図的差異レジストリ（正規化のノイズフィルタ）。`pending` 該当は落とさず要確認 |
| `uses_storage` / `targets[].storage` | 読 | ファイルストレージの利用と、選択した新側 target の接続（`env_vars`）・アップロード経路（`upload_route`）。**現側と `upload_route` が違う場合、保存 path の命名規則差は宣言が無ければ「許容」にせず未説明として残す**（`intentional_diffs` の対象）。ストレージ実体への投入は v1 スコープ外のため、事前配置に依存する差分は「未検証」として `diff.md` に明記する |
| `component_diffs` | 読 | コンポーネント系統差 T（クラス/トークン単位）。宣言者は `parity-replace`。T に合致すれば吸収、逸脱すれば回帰候補。**設定側に残るのは `component` × `property` で slug 横断に効くため**（1 回の宣言が全インスタンスに効く）。T が引けないインスタンス例外は設定に置かず slug 成果物（下記「成果物」） |
| `artifacts.{storage,overrides.<slug>}` | 読 | 新側ベースラインの保存先既定と機能ごと上書き |
| `references.ui_library` | 読 | 旧→新 design token マッピング（系統差の正規化の判断材料） |
| `references.db_semantics` | 読 | DB 意味論の差（API 応答の並び順差の判断材料） |
| （上記 2 キーが**未整備**のとき） | — | キー欠落・空値・解決できないパスはいずれも未整備。**停止はしない**が、判断材料が無いまま「許容」へ寄せず、該当候補は未説明のまま残して `diff.md` に理由を記録する |
| `references.dependency_policy` | 読・書 | 差分器・トリアージ補助に依存を足すときの方針（**三値**。意味論の正本はスキーマ文書の「依存導入の方針」）。**書くのはキー欠落＝未確認のときだけ**（ユーザーに要否を確認した結果を非破壊追記） |
| `secrets.wrapper` | 読 | シークレットが要るコマンドの前置ラッパー |

設定・`.replace/features.md` が無ければ `replace-strategy setup` を促して停止する。
**旧スキーマ・旧レイアウトはフォールバックとして読まず**、見つけたら移行を案内して停止する。
検出対象の旧キー・旧レイアウトの一覧と移行手順は `replace-strategy` の `references/project-config.md`「移行」を正本として参照する（本スキルで個別に列挙しない）。

## 実行フロー

詳細は各 reference へ委譲する。番号順に進める。

1. **target 解決と前提確認**（[`references/preflight.md`](references/preflight.md)）: 対象 target を決めてから、停止条件・データセットバージョンの陳腐化・差分器バージョン一致・反復上限を確認する。
   選択 target の `new/<target>/replace-metadata.json` が無い・`suite.new_green` でなければ「**その環境ではまだ green 証跡が無い**」として停止し、同じ `--target` での `parity-replace` を案内する。欠ければ捏造せず停止し依存順に案内する
2. **モード分岐**: `metadata.json.mode` で feature（3 経路）/ api-resource / batch に分岐する。api-resource / batch は画面系 3 経路を動かさない（[`references/api-batch.md`](references/api-batch.md)）
3. **新側ベースライン取得**（[`references/capture-new.md`](references/capture-new.md)）: 選択 target の `url` / `api_url` を `PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` に解決して
   Playwright の**採取用プロジェクト**（`metadata.json.suite.new_only` に記録された名前。既定 `new-capture`）へ渡し、同一条件で新側だけを撮る。
   採取スペックは**現側スペックから手で書き起こさず**同梱雛形（[`assets/capture-new.spec.template.ts`](assets/capture-new.spec.template.ts)）を `metadata.json.suite.new_only` の場所へコピーして埋め、
   `current` / `new` からの `testIgnore` 除外と採取用プロジェクト（既定 `new-capture`）を撮影前に確認する。
   `url_command` の target は手順 1 の target 解決時に解決した URL を再利用する（工程ごとに再実行しない）。
   **条件一致を先行検証**し、不一致なら差分報告せず停止する。新側の自己ノイズも測り（往復ループでは前回実行の測定値を組単位で再利用してよい。失効条件は同 reference）、現側 `noise_baseline` との乖離が大きければ停止する。
   既存の新側ベースラインから再開する場合も、差分検出の前に同 reference「共同居住機能の実行時マスク」を必ず通す。ページ一覧と同 target の green 証跡から有効集合を再導出し、現側由来の `bbox` を両画像へ適用する。新側 root が無いことを停止理由や `blocked_by` の根拠にしない
4. **決定論的差分検出**（[`references/detect.md`](references/detect.md)）: 画素・特性照合・aria の 3 経路。**LLM を介さない**
5. **正規化・ノイズフィルタ**（[`references/normalize.md`](references/normalize.md)）: `intentional_diffs` → `component_diffs`（T）→ インスタンス例外 → ノイズ基準値（残余へ集計適用）→ 宣言できない構造差（`gaps.md`）は未検証として転記
6. **LLM トリアージ**（[`references/triage.md`](references/triage.md)）: 正規化を生き残った候補だけを 1 件ずつ crop 対で。分類は要対応／許容／環境ノイズの 3 値。「許容」の確定はユーザー承認。
   テキストの幅・字形の差は分類の前に**フォント差を切り分ける**（版差かヒンティング差か。[`references/font-diff.md`](references/font-diff.md)）
7. **収束判定・差し戻し**（[`references/convergence.md`](references/convergence.md)）: **差分器が判定する**。状態は 3 つ（収束／**他機能待ち**／未収束）。
   他機能の新側未実装に由来する差分は `blocked_by` に帰属させ、差し戻さず停止してユーザーへ報告する（`converged` は false のまま）。要対応が残れば選択 target の `on_diff` ドキュメントに従う——無ければ `diff.md` を差し戻し入力に同じ `--target` の `parity-replace` へ渡す。
   ドキュメントが起票して停止する運用を指示するなら、差し戻さず差分の要約を `issue-create` へ委譲して起票し停止する（修正ループを回さない）。反復上限超過なら差し戻さず停止してユーザーへ

## 成果物

すべて対象プロジェクト側に置く。**本スキルが正本を定義するテンプレート**（[`assets/`](assets/)）がある。

| 成果物 | 場所 | 正本テンプレート |
|---|---|---|
| 差分レポート | `.replace/parity/<slug>/new/<target>/diff.md` | [`assets/diff-template.md`](assets/diff-template.md) |
| メタデータ | `.replace/parity/<slug>/new/<target>/diff-metadata.json` | [`assets/diff-metadata-template.json`](assets/diff-metadata-template.json) |
| 新側ベースライン | `.replace/parity/<slug>/new/<target>/baseline-new/`（現側 `baseline/` と対称のレイアウト） | — |
| 新側採取スペック | `metadata.json.suite.new_only` の場所（既定 `<parity_suite_dir>/parity/<slug>/new-only/`。既にあれば上書きしない） | [`assets/capture-new.spec.template.ts`](assets/capture-new.spec.template.ts) |
| インスタンス例外レジストリ | `.replace/parity/<slug>/component-diff-exceptions.json` へ**非破壊追記**（無ければテンプレートから作成）。ユーザー承認済みのみ・**設定ファイルには置かない** | [`assets/component-diff-exceptions-template.json`](assets/component-diff-exceptions-template.json)（スキーマ: [`references/normalize.md`](references/normalize.md)） |
| 承認済み例外の根拠 | `.replace/parity/<slug>/component-diff-exceptions.md` へ**非破壊追記**（無ければテンプレートから作成）。`component_diff_exception_causes[].evidence` の宛先で、**`gaps.md` に書かない** | [`assets/component-diff-exceptions-template.md`](assets/component-diff-exceptions-template.md) |
| 依存の決定記録（差分器・トリアージ補助に依存を足したときのみ） | `.replace/dependencies.md` へ**非破壊追記**（無ければテンプレートから作成） | 様式の正本: `replace-strategy` の `assets/dependencies-template.md` |

- **新側の成果物は環境別**（`new/<target>/` 配下）。環境を切り替えても他の環境の差分レポート・メタデータ・新側ベースラインを上書きしない。現側 `baseline/` は 1 環境で slug 直下のまま
- **インスタンス例外レジストリとその根拠は環境非依存**なので slug 直下に置く（`gaps.md` / `porting.md` と同じ扱い）。特定の target でだけ出る差は例外ではなく環境差であり、ノイズ基準値と新側の自己ノイズで扱う
- テキスト成果物（`diff.md` / `diff-metadata.json` / 例外レジストリとその根拠）は Git。
  新側ベースラインの大きなバイナリ（スクリーンショット等）は `artifacts` 設定に従い、既定 `local`（コミットしない）。テキスト（特性 JSON・aria）は Git
- 本スキル同梱の決定論的ツール（[`scripts/pixel-crops.mjs`](scripts/pixel-crops.mjs) / [`scripts/diff-normalize.mjs`](scripts/diff-normalize.mjs) / [`scripts/json-normalize-diff.mjs`](scripts/json-normalize-diff.mjs)）は
  **プロジェクトへコピーせず、スキルディレクトリ内から実行する**（`gh skill update` の自動更新を効かせるため）。特性照合は `parity-suite` の確定契約によりプロジェクト側コピー（`trait-capture.mjs` / `trait-compare.mjs`）を使う

## 姉妹スキルとの連携

- **依存順**: `replace-strategy`（setup）→ `golden-dataset` → `parity-suite` → `parity-replace` → **`parity-diff`**（`parity-replace` と往復）
- **`parity-suite` から引き継ぐもの**: 強度ゲートで健全性を確認済みの差分器（画素・特性照合・aria の 3 経路のツール・しきい値）、ノイズ基準値、撮影条件（ページ一覧・マスクの論理名を含む）、
  新側専用スペックの置き場所・`current` / `new` からの `testIgnore` 除外・採取用の `new-capture` プロジェクト（`suite.new_only`）。すべて `.replace/parity/<slug>/metadata.json` 経由
- **`parity-replace` から引き継ぐもの**: 新側 green の証拠（`suite.new_green`）・target 名と新側 URL（`new.{target,ui_url,api_url}`。`url_command` の target は `"runtime"` が記録されるため target 設定から再解決する）・新側マッピング例外・実装時に前提としたデータセットバージョン（`dataset_version`）。
  すべて選択 target の `.replace/parity/<slug>/new/<target>/replace-metadata.json` から推測せず引く（スイートは再実行しない）。
  データセットバージョンの**陳腐化判定はこの値では行わない**——判定は [`references/preflight.md`](references/preflight.md) の三者一致（`metadata.json` / `.replace/dataset/metadata.json` / `phase_b.<slug>.<target>`）で行う
- **`parity-replace` へ差し戻すもの**: 要対応差分が残り、target の `on_diff` が無い（既定）か、そのドキュメントが修正を指示するなら `diff.md` を差し戻し入力として**同じ target** で渡す。
  反復回数の記録・上限管理（`--max-iterations` 既定 5）は `parity-replace` が当該 target の `replace-metadata.json` の `loop.*` で行う（環境ごとに独立）。上限超過時は差し戻さず停止してユーザーへ。
  同 `loop.changed_scope`（直近の反復で描画に効く変更を入れた範囲）は自己ノイズ測定値を再利用してよい組の判定に使う（[`references/capture-new.md`](references/capture-new.md)「測定値の再利用」）
- **`issue-create` へ委譲するもの**: target の `on_diff` ドキュメントが起票して停止する運用を指示するなら、差し戻しの代わりに要対応差分の要約（該当ページ・分類・根拠・`diff.md` のパス）を渡して起票し停止する（`gh` で直接起票しない）
- **ブランチ作成・commit・PR は `issue-start` へ委譲**（`parity-replace` と同じ流儀。本スキルは実装フローを再実装しない）
- **`replace-strategy status`** が `diff.md` / `diff-metadata.json` を読んで現況を導出する。
  **他機能待ち（`blocked_by`）の解除検出もそちらが持つ**——依存先が同 target で新側 green になった slug を挙げ、本スキルの再実行が必要だと列挙する（本スキルは再実行時に前回の `blocked_by` を検証し直す）
