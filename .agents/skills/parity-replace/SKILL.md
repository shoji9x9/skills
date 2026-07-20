---
argument-hint: '[--feature <slug>] [--max-iterations <n>]'
description: 仕様を変えないアプリケーションリプレイスで、parity-suite が定義した論理名に対し新側を実装する replace-strategy の姉妹スキル。担うのは 3 つ——機能をページ単位のフェーズに分割し、新側ロケータマッピングの例外を充填し、実装役と分離した敵対的レビューを未コミット差分にかける。ブランチ作成・commit・PR は issue-start へ委譲。現行コードを一次情報源に読み、推測せず確信度を申告し、パリティスイートが新に対して green かつ静的解析が通れば完了（差分ゼロは parity-diff との往復の終了条件）。1 回で 1 機能。replace-strategy setup・golden-dataset・対象 slug の parity-suite 完了が前提で、未完了なら停止する。「新側を実装して」「parity-replace」や --feature / --max-iterations を伴う依頼で発動する。
license: MIT
name: parity-replace
---
# Parity Replace

`replace-strategy` の姉妹スキル。**意図的に薄い層**として、リプレイス固有の 3 つだけを担う。

1. **ページ単位への分割**（機能 Issue の中でのフェーズ分け）
2. **新側ロケータマッピングの充填**（`parity-suite` が定義した論理名に対して。**例外のみ**）
3. **敵対的レビュー**（実装役とレビュー役を分離し、未コミット差分に対して実施）

**実装フローそのもの（ブランチ作成・調査・commit・push・PR）は `issue-start` に委譲する。** 再実装しない。差分の検出は `parity-diff`、パリティスイートの構築は `parity-suite` の担当。

## 使い方

```text
parity-replace [--feature <slug>] [--max-iterations <n>]
```

- **1 回の実行につき 1 機能。** ページをまたいで並行に実装しない（調査・実装・比較が浅くなり差異を見落とす）
- `slug` は `.replace/features.md` が採番したもの。**自分で採番しない。** 省略時は features.md の未着手から対話選択する
- **モードは `.replace/parity/<slug>/metadata.json` の `mode`（feature / api-resource / batch）を正として引く**（フラグは無い。features.md の表位置から再導出しない）。`mode` は `parity-suite` が features.md の分類（下表の起点）から記録済み
- `--max-iterations <n>`（任意, 既定 5）: `parity-diff` との往復ループの反復上限。超えたら停止してユーザーに上げる

| モード | 起点 | 内容 |
|---|---|---|
| 機能（feature） | features.md の機能 | ページ単位にフェーズ分割。全工程（新側マッピング・視覚系）を使う |
| 横断 API（api-resource） | features.md の横断 API リソース | 画面を持たない API のみ。バックエンド diff レビュー ＋ API スイート green のみ（ページ分割・視覚・新側マッピング無し） |
| バッチ（batch） | features.md のバッチ | バッチ本体の diff レビュー ＋ 出力一致。画面系工程は動かさない |

- 自然文でも発動する:「新側を実装して」「リプレイスの実装を進めて」「この差分レポートから続きを直して」

## 前提

- **ツール**: `git`。ブランチ作成・commit・push・PR は `issue-start` が行う（本スキルは実装フローを再実装しない）
- **前提スキル**: `issue-start`（実装フローの委譲先）、`replace-strategy`（`setup` 完了）、`golden-dataset`（フェーズ A 完了）、対象 slug の `parity-suite`（完了）
- **MCP**: 不要
- **前提の判定（無ければ停止し、該当スキルの実行を促す。捏造しない）**:
  - `replace-strategy setup` 完了 = 設定 `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy` と `.replace/features.md` の存在
  - `golden-dataset` フェーズ A 完了 = `.replace/dataset/metadata.json` の存在（`version` は 1 始まりの整数）
  - 対象 slug の `parity-suite` 完了 = `.replace/parity/<slug>/metadata.json` の存在と `suite.current_green`
- **パスは推測せず `.replace/parity/<slug>/metadata.json` から引く**（スイート・現側マッピング・操作アダプタの実パス）。`slug` は `.replace/features.md` から引き、自分で採番しない

## 厳守の制約（禁止事項）

- **パリティスイートが無い状態で実装を始めない**（判定基準が無ければ何をもって完了とするか決められない）
- **推測で実装しない。** 判断できない箇所は `TODO` 等でコード上に未解決と明示しレビューへ回す。**間違ったコードより未解決の明示のほうがよい**
- **確信度の申告を迷ったときだけに限らない。** 実装単位ごとに**常に**高／中／低を `porting.md` へ申告する（「低」＝「おそらく間違っている。レビューで現行を読み直せ」）
- **モデルの「同じに見えます」を完了根拠にしない**
- **振る舞い保存と品質改善を同じフェーズで狙わない。** レガシーの奇妙な挙動も再現する
- **リントを off にして差異を回避しない**（ロケータマッピング層が現側の非セマンティックさを隔離しているため、新側を改善してもスイートは壊れない）
- **タブ順の厳密一致を目標にしない**（ARIA APG 準拠で新の方が正しくてもタブ停止数が変わりうる）
- **ページをまたいで並行に実装しない**
- **発見した差異を勝手に判断して進めない。** 意図的差異レジストリのどの分類にも当てはまらない差異は `intentional_diffs.pending` へ非破壊追記しユーザーに確認する
- **「型検査が通った」「テストが通った」を理由に敵対的レビューを省略しない**
- **シークレットの値をコード・コメント・ログ・成果物に残さない。** 環境変数名だけを扱い、値は復唱しない

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を**直接読む**（転記しない）。スキーマの正本は `replace-strategy` の `references/project-config.md`。本スキルが読む・書くキー:

| キー | 用途 |
|---|---|
| `static_analysis` | 敵対的レビュー前と完了判定で走らせる静的解析・動的解析の起動コマンド（**固有のツール名は設定側に置く**。スキル本体に書かない） |
| `intentional_diffs.{keep,may_change,pending}` | 意図的差異レジストリ。`keep` が旧新 diff レビューを可能にする。発見した差異は `pending` へ非破壊追記しユーザー確認 |
| `component_diffs` | テーマで消せない構造差の系統差レジストリ。本スキルがユーザー確認の上で宣言し、`parity-diff` が比較の正規化に使う |
| `references.ui_library` | 新 UI ライブラリ設定と旧→新 design token マッピングの reference パス（**特定のライブラリ名を固定しない**） |
| `new.{repo,url}` | 新側リポジトリ（実装対象）と baseURL（`new` プロジェクトの baseURL 設定に使う）。コミット SHA は設定ではなく `replace-metadata.json` に記録する |
| `secrets.wrapper` | シークレットが要るコマンドの前置ラッパー |

各キーの既定値・意味論の正本は上記スキーマ文書にある（ここへ転記しない）。設定・`.replace/features.md` が無ければ `replace-strategy setup` を促して停止する。

## 実行フロー

詳細は各 reference へ委譲する。番号順に進める。

1. **前提検証と早期失敗**: 前提（上記）を metadata.json の存在で判定し、欠ければ捏造せず停止して該当スキル（`replace-strategy setup` / `golden-dataset` / 対象 slug の `parity-suite`）の実行を促す。
   `slug` を features.md と突き合わせ、モードとパスは metadata.json から引く。着手時は slug に対応する features.md の **Issue 列の番号**で `issue-start <番号>` を実行してブランチを作る
   （`--commit` / `--pr` は付けない。ブランチ作成・checkout 後の調査・実装は issue-start に委ねず、本スキルの実行フローとして進める）。未起票なら停止して `replace-strategy issues` を促す
2. **ページ分割とフェーズ構成**: 機能をページ単位のフェーズに分ける。**1 ページを作り切って比較してから次へ**。フェーズ内は読み取り経路 → 書き込み経路の順。api-resource / batch モードはページ分割せず該当モードで動く。詳細: [`references/paging.md`](references/paging.md)
3. **実装（フェーズごと）**: 現行コードをフロント・バック**いずれもロジックの一次情報源として読む**。照合単位を振り分ける（バックエンド＝旧新を並べた diff、フロントエンド＝スイート green か `parity-diff` 差分ゼロ）。
   推測せず、確信度を実装単位ごとに `porting.md` へ**常に**申告し、判断できない箇所は `TODO` で未解決を明示する。詳細: [`references/implementation.md`](references/implementation.md)
4. **新側ロケータマッピングの充填**（feature モード）: **既定は「不要」**。role ＋アクセシブルネームで同じ論理名が解決する。**書くのは解決できない例外だけ。** Select / Autocomplete / Date picker / Modal / Menu は操作アダプタに実装ごとの分岐が必須。
   データ依存 assertion を green にするには新側 DB への投入が要る——新側スキーマが揃った時点で `golden-dataset --phase b --feature <slug>` を実行してから、`new` プロジェクトの baseURL を設定し新で green 化する。現側の脆弱マッピングが不要になったかを確認し `porting.md` へ記録。詳細: [`references/new-mapping.md`](references/new-mapping.md)
5. **見た目の系統差を源流で縮める**（feature モード）: `references.ui_library` で新側ライブラリを選ぶ（固定しない）。テーマ可能なら旧 design token を新側テーマへ寄せる。
   テーマで消せない構造差はクラス/トークン単位の系統差として `component_diffs` へユーザー確認の上で宣言し、宣言できない構造差は `gaps.md` へ追記する（比較の正規化であって仕様変更ではない）。詳細: [`references/theming.md`](references/theming.md)
6. **敵対的レビュー**: レビュー役の往復は高コストなため、先に静的解析（設定 `static_analysis`）を通して自明な破綻を安価に落とす（通ったことを**レビューを省略する理由にしない**）。
   そのうえで**ローカルの未コミット差分**に対し commit 前に実施する。実装役とレビュー役を分離し、レビュー役には**差分のみ**を渡し実装意図を知らせない。指摘 → 修正 → 再レビュー。記録は `review.md`（PR に置かない）。詳細: [`references/adversarial-review.md`](references/adversarial-review.md)
7. **完了判定（本スキル単体）**: パリティスイートが**新に対して green** ＋ 静的解析（設定 `static_analysis`）が通る（batch モードは実行可能スイートを持たないため**出力一致**＋静的解析。モード別の完了判定は [`references/paging.md`](references/paging.md)）。
   **`parity-diff` の差分ゼロは含めない**（循環回避。理由の正本: [`references/diff-loop.md`](references/diff-loop.md)）。実装フロー（commit / push / PR）は `issue-start` に委ねる
8. **`parity-diff` との往復ループ**: 差し戻し時は `.replace/parity/<slug>/diff.md` を入力に**該当ページのフェーズから再開**（頭から作り直さない）。反復回数を `replace-metadata.json` に記録。
   終了条件と反復上限（`--max-iterations` 既定 5）の正本: [`references/diff-loop.md`](references/diff-loop.md)

## 成果物

すべて対象プロジェクト側に置く。**本スキルが正本を定義するテンプレート**（[`assets/`](assets/)）と、他スキルが正本を持つ成果物への追記がある。

| 成果物 | 場所 | 正本テンプレート |
|---|---|---|
| 実装 | プロジェクトの構成に従う（新側のコード） | — |
| 新側ロケータマッピング | パリティスイートと同じ配置（例外のみ・操作差の分岐を含む） | — |
| 移植メモ | `.replace/parity/<slug>/porting.md` | [`assets/porting-template.md`](assets/porting-template.md) |
| レビュー記録 | `.replace/parity/<slug>/review.md` | [`assets/review-template.md`](assets/review-template.md) |
| メタデータ | `.replace/parity/<slug>/replace-metadata.json` | [`assets/metadata-template.json`](assets/metadata-template.json) |
| レジストリ追記 | `.config/skills/shoji9x9/skills.yml` の `intentional_diffs` / `component_diffs` | 正本: `replace-strategy` の `references/project-config.md` |
| 宣言できない構造差 | `.replace/parity/<slug>/gaps.md` の「宣言できない構造差」節へ**本スキルが追記** | 様式の正本: `parity-suite` の `assets/gaps-template.md` |

- テキスト成果物（`porting.md` / `review.md` / `replace-metadata.json`）は Git。敵対的レビューは PR レビュー機能上ではなく**ローカルの未コミット差分に対して実施**し、その記録が `review.md`（記録ファイル自体は Git 管理してよい）
- 本スキルは実行時に固有の決定論的ツールを同梱しない（差分器・視覚ベースラインは `parity-suite` 同梱・`parity-diff` 担当）

## 姉妹スキルとの連携

- **依存順**: `replace-strategy`（setup）→ `golden-dataset`（フェーズ A）→ 各機能で〔`parity-suite` → **`parity-replace`** → `golden-dataset`（フェーズ B）→ `parity-diff`（本スキルと往復）〕
- **`parity-suite` から引き継ぐもの**: 論理名の契約（現・新をまたぐ）、現側 green のスイート、Playwright `projects` の `current` / `new` という名前（`new` の baseURL 設定と green 化は本スキルの担当）、脆弱マッピングを記録したマッピング層コメント。
  **assertion を変えた場合（例外充填・穴埋め）は `parity-suite` の強度ゲート再実行が必要**（詳細: [`references/new-mapping.md`](references/new-mapping.md)）
- **`golden-dataset`（フェーズ B）**: 新側スキーマを作った後（実装フェーズで確定した時点）、`golden-dataset --phase b --feature <slug>` を実行して新側 DB へ投入する。**本スキルの完了後ではなく、新側スキーマ確定後・green 化（完了ゲート）前の工程**
- **`parity-diff` と往復**: 本スキルで新を green にした後 `parity-diff` が差分を検出し、差分があれば本スキルへ差し戻す。終了条件・上限・再入手順は上記「往復ループ」
- **`issue-start` へ委譲**: ブランチ作成は着手時に features.md の Issue 番号で `issue-start`（モード未指定）を 1 回。実装は本スキルが行うため **`--commit` / `--pr`（実装を内包する）は使わず**、commit は issue-start が解決した規約に従い**ページフェーズ単位**で行う（issue-start の実装ステップへ再入しない）
