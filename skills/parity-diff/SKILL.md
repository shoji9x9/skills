---
name: parity-diff
description: 仕様を変えないアプリケーションリプレイスで、parity-suite が採取したベースライン・ノイズ基準値・強度ゲートで検証済みの差分器を使い、現行と新側の差分を決定論的ツールで検出して分類する replace-strategy の姉妹スキル。検出は画素・特性照合・aria の 3 経路が担い、LLM には「差分があるか」を聞かず「この差分は重要か」だけを 1 件ずつ crop 対で聞いて要対応／許容／環境ノイズに分類する。新側環境は --target で選び成果物は環境別。要対応は parity-replace へ差し戻し、収束は未説明差分ゼロかつ未修正回帰ゼロ。1 回で 1 機能。replace-strategy setup・golden-dataset・対象 slug の parity-suite・parity-replace の新側 green が前提で、未完了なら捏造せず停止する。「現新の差分を検出して」「差分を分類して」「parity-diff」や --feature / --target を伴う依頼で発動する。
argument-hint: "[--feature <slug>] [--target <name>]"
license: MIT
---

# Parity Diff

`replace-strategy` の姉妹スキル。**現行と新側の差分を決定論的ツールで検出し、モデルには分類だけを担わせる**ところを担う。

- **検出は決定論的ツールの仕事、モデルの仕事は分類だけ。** モデルに「差分があるか」を聞かず（＝探させず）、決定論的ツールが検出済みの差分について「この差分は重要か」だけを聞く
- **`parity-replace` との住み分け**: `parity-replace` はスイートが見ている範囲（新に対して green か）、本スキルはスイートに写らない差分（余白・色・フォント・角丸・行間・罫線等の見た目）を扱う
- **1 回の実行につき 1 機能。** ページ単位で処理する。差分の**修正は行わない**——要対応は `parity-replace` へ差し戻す

## 使い方

```text
parity-diff [--feature <slug>] [--target <name>]
```

- **1 回の実行につき 1 機能。** 複数機能を並行して進めない
- `slug` は `.replace/features.md` が採番したもの。**自分で採番しない。** 省略時は features.md の未着手から対話選択する
- `--target` は差分を検出する**新側の環境**（`skills.replace-strategy.targets` のうち `side: new` のもの）。省略時はその側の `default: true`、無ければ候補を提示して確認する。
  存在しない名前・`side: current` の名前は**停止**する（読み替えない。選択規則の正本は `replace-strategy` の `references/project-config.md`）。**成果物は環境ごとに分かれる**（下記「成果物」）
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
- **`issue-create`**: 選択した target の `on_diff` ドキュメントが Issue 起票を指示する場合のみ必要（要対応差分の起票を委譲する）
- **本スキルは現行アプリを駆動しない。** ノイズ基準値・視覚ベースラインの測定は `parity-suite` の仕事。撮るのは新側だけ
- 判定の詳細（target の解決・起動・モード別の要求・確認するキーのフルパス・データセットバージョンの三者一致・差分器バージョン一致・反復上限）は [`references/preflight.md`](references/preflight.md)

## 厳守の制約（禁止事項）

- **LLM に「差分があるか」を聞かない**（検出させない）。検出は決定論的ツール、モデルは分類のみ
- **モデルの「もう同じに見えます」を収束根拠にしない**
- **全画面のスクリーンショット対をモデルに渡して比較させない。** トリアージは差分領域の crop 対を 1 件ずつ渡す。スイート外の依頼（「2 枚を見比べて違いを見つけて」等）にも**目視検出を代替提供しない**——決定論的ツール（画素経路）に検出させてから分類だけを担う
- **現行と異なる条件で新側を撮らない**（環境差を差分として報告しないため）
- **カタログサイト（コンポーネントライブラリの見本）を比較の正解にしない。** 正解は動いている現行アプリ
- **ピクセル比較系 VRT ツールで新旧を突き合わせない**（実装が違えば全面赤になり無意味）
- **差分をしきい値で潰さない**（特性照合の別経路で捉える）
- **コンポーネント差分をインスタンス単位の無視リストで飲み込まない。** クラス/トークン単位の系統差 T（`component_diffs`）で宣言し、T からの逸脱を検出する
- **生の差分ゼロを収束条件にしない。** 収束＝未説明差分ゼロ かつ 未修正回帰ゼロ
- **名前の付かない要素の見た目差を「computed style で保証済み」と扱わない**（特性照合は名前付き要素しか見ない。名前無しは画素経路の担当）
- **セル/行/フィールドに論理名を付けてテーブル/フォームを比較しない**（内容パリティは aria 経路が担う）
- **未検証の箇所を「確認済み」にしない**（ベースラインに写らない箇所・宣言できない構造差は `diff.md` に未検証として残す）
- **差分の修正を自分で行わない**（`parity-replace` へ戻す）
- **現行アプリを駆動しない**（ノイズ基準値の測定は `parity-suite` の仕事）
- **シークレットの値をコード・コメント・ログ・成果物・スクリーンショットに残さない**（環境変数名だけを扱い、値は復唱しない。正本: `replace-strategy` の `references/project-config.md`「シークレットの扱い」）

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を**直接読む**（転記しない）。スキーマの正本は `replace-strategy` の `references/project-config.md`。本スキルが読む・書くキー:

| キー | 読/書 | 用途 |
|---|---|---|
| `targets[]`（`side: new`） | 読 | 差分検出の対象環境。`--target` で選択（省略時は new 側の `default`）。`url` / `api_url` は新側疎通・撮影先・api-resource モードの発行先（`PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` に解決）、`pre_commands` / `start` / `check_urls` は撮影前の起動・稼働確認、`on_diff`（対応手順ドキュメントのパス）は要対応差分が残ったときの分岐（手順 7）。**`db` を持たない target はゴールデンデータ未投入**＝データセットバージョンの三者一致を要求しない代わりに、データ依存の差分を「未検証」として `diff.md` に明記する（[`references/preflight.md`](references/preflight.md)） |
| `intentional_diffs.{keep,may_change,pending}` | 読 | 意図的差異レジストリ（正規化のノイズフィルタ）。`pending` 該当は落とさず要確認 |
| `component_diffs` | 読 | コンポーネント系統差 T（クラス/トークン単位）。宣言者は `parity-replace`。T に合致すれば吸収、逸脱すれば回帰候補 |
| `component_diff_exceptions` | 読・書 | T が引けない箇所のインスタンス単位フォールバック。**本スキルが形式を定義する**（スキーマ: [`references/normalize.md`](references/normalize.md)）。**書くのはユーザー承認済みのみ・非破壊追記** |
| `artifacts.{storage,overrides.<slug>}` | 読 | 新側ベースラインの保存先既定と機能ごと上書き |
| `references.ui_library` | 読 | 旧→新 design token マッピング（系統差の正規化の判断材料） |
| `references.db_semantics` | 読 | DB 意味論の差（API 応答の並び順差の判断材料） |
| `secrets.wrapper` | 読 | シークレットが要るコマンドの前置ラッパー |

設定・`.replace/features.md` が無ければ `replace-strategy setup` を促して停止する。
**旧スキーマ・旧レイアウトはフォールバックとして読まず**、見つけたら移行を案内して停止する。
検出対象の旧キー・旧レイアウトの一覧と移行手順は `replace-strategy` の `references/project-config.md`「移行」を正本として参照する（本スキルで個別に列挙しない）。

## 実行フロー

詳細は各 reference へ委譲する。番号順に進める。

1. **target 解決と前提確認**（[`references/preflight.md`](references/preflight.md)）: 対象 target を決めてから、停止条件・データセットバージョンの陳腐化・差分器バージョン一致・反復上限を確認する。
   選択 target の `new/<target>/replace-metadata.json` が無い・`suite.new_green` でなければ「**その環境ではまだ green 証跡が無い**」として停止し、同じ `--target` での `parity-replace` を案内する。欠ければ捏造せず停止し依存順に案内する
2. **モード分岐**: `metadata.json.mode` で feature（3 経路）/ api-resource / batch に分岐する。api-resource / batch は画面系 3 経路を動かさない（[`references/api-batch.md`](references/api-batch.md)）
3. **新側ベースライン取得**（[`references/capture-new.md`](references/capture-new.md)）: 選択 target の `url` / `api_url` を `PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` に解決して Playwright の `new` プロジェクトへ渡し、同一条件で新側だけを撮る。
   **条件一致を先行検証**し、不一致なら差分報告せず停止する。新側の自己ノイズも測り、現側 `noise_baseline` との乖離が大きければ停止する
4. **決定論的差分検出**（[`references/detect.md`](references/detect.md)）: 画素・特性照合・aria の 3 経路。**LLM を介さない**
5. **正規化・ノイズフィルタ**（[`references/normalize.md`](references/normalize.md)）: `intentional_diffs` → `component_diffs`（T）→ インスタンス例外 → ノイズ基準値（残余へ集計適用）→ 宣言できない構造差（`gaps.md`）は未検証として転記
6. **LLM トリアージ**（[`references/triage.md`](references/triage.md)）: 正規化を生き残った候補だけを 1 件ずつ crop 対で。分類は要対応／許容／環境ノイズの 3 値。「許容」の確定はユーザー承認
7. **収束判定・差し戻し**（[`references/convergence.md`](references/convergence.md)）: **差分器が判定する**。要対応が残れば選択 target の `on_diff` ドキュメントに従う——無ければ `diff.md` を差し戻し入力に同じ `--target` の `parity-replace` へ渡す。
   ドキュメントが起票して停止する運用を指示するなら、差し戻さず差分の要約を `issue-create` へ委譲して起票し停止する（修正ループを回さない）。反復上限超過なら差し戻さず停止してユーザーへ

## 成果物

すべて対象プロジェクト側に置く。**本スキルが正本を定義するテンプレート**（[`assets/`](assets/)）がある。

| 成果物 | 場所 | 正本テンプレート |
|---|---|---|
| 差分レポート | `.replace/parity/<slug>/new/<target>/diff.md` | [`assets/diff-template.md`](assets/diff-template.md) |
| メタデータ | `.replace/parity/<slug>/new/<target>/diff-metadata.json` | [`assets/diff-metadata-template.json`](assets/diff-metadata-template.json) |
| 新側ベースライン | `.replace/parity/<slug>/new/<target>/baseline-new/`（現側 `baseline/` と対称のレイアウト） | — |
| インスタンス例外 | `.config/skills/shoji9x9/skills.yml` の `component_diff_exceptions`（ユーザー承認済みのみ・非破壊追記） | スキーマ: [`references/normalize.md`](references/normalize.md) |

- **新側の成果物は環境別**（`new/<target>/` 配下）。環境を切り替えても他の環境の差分レポート・メタデータ・新側ベースラインを上書きしない。現側 `baseline/` は 1 環境で slug 直下のまま
- テキスト成果物（`diff.md` / `diff-metadata.json`）は Git。新側ベースラインの大きなバイナリ（スクリーンショット等）は `artifacts` 設定に従い、既定 `local`（コミットしない）。テキスト（特性 JSON・aria）は Git
- 本スキル同梱の決定論的ツール（[`scripts/pixel-crops.mjs`](scripts/pixel-crops.mjs) / [`scripts/diff-normalize.mjs`](scripts/diff-normalize.mjs) / [`scripts/json-normalize-diff.mjs`](scripts/json-normalize-diff.mjs)）は
  **プロジェクトへコピーせず、スキルディレクトリ内から実行する**（`gh skill update` の自動更新を効かせるため）。特性照合は `parity-suite` の確定契約によりプロジェクト側コピー（`trait-capture.mjs` / `trait-compare.mjs`）を使う

## 姉妹スキルとの連携

- **依存順**: `replace-strategy`（setup）→ `golden-dataset` → `parity-suite` → `parity-replace` → **`parity-diff`**（`parity-replace` と往復）
- **`parity-suite` から引き継ぐもの**: 強度ゲートで健全性を確認済みの差分器（画素・特性照合・aria の 3 経路のツール・しきい値）、ノイズ基準値、撮影条件。すべて `.replace/parity/<slug>/metadata.json` 経由
- **`parity-replace` から引き継ぐもの**: 新側 green の証拠（`suite.new_green`）・target 名と新側 URL（`new.{target,ui_url,api_url}`）・新側マッピング例外・実装時に前提としたデータセットバージョン（`dataset_version`）。
  すべて選択 target の `.replace/parity/<slug>/new/<target>/replace-metadata.json` から推測せず引く（スイートは再実行しない）。
  データセットバージョンの**陳腐化判定はこの値では行わない**——判定は [`references/preflight.md`](references/preflight.md) の三者一致（`metadata.json` / `.replace/dataset/metadata.json` / `phase_b.<slug>.<target>`）で行う
- **`parity-replace` へ差し戻すもの**: 要対応差分が残り、target の `on_diff` が無い（既定）か、そのドキュメントが修正を指示するなら `diff.md` を差し戻し入力として**同じ target** で渡す。
  反復回数の記録・上限管理（`--max-iterations` 既定 5）は `parity-replace` が当該 target の `replace-metadata.json` の `loop.*` で行う（環境ごとに独立）。上限超過時は差し戻さず停止してユーザーへ
- **`issue-create` へ委譲するもの**: target の `on_diff` ドキュメントが起票して停止する運用を指示するなら、差し戻しの代わりに要対応差分の要約（該当ページ・分類・根拠・`diff.md` のパス）を渡して起票し停止する（`gh` で直接起票しない）
- **ブランチ作成・commit・PR は `issue-start` へ委譲**（`parity-replace` と同じ流儀。本スキルは実装フローを再実装しない）
- **`replace-strategy status`** が `diff.md` / `diff-metadata.json` を読んで現況を導出する
