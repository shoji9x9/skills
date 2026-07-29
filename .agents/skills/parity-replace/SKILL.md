---
argument-hint: '[--feature <slug>] [--target <name>] [--max-iterations <n>]'
description: 仕様を変えないアプリケーションリプレイスで、parity-suite が定義した論理名に対し新側を実装する replace-strategy の姉妹スキル。担うのは 3 つ——機能をページ単位のフェーズに分割し、新側ロケータマッピングの例外を充填し、実装役と分離した敵対的レビューを未コミット差分にかける。ブランチ作成・commit・PR は issue-start へ委譲。現行コードを一次情報源に読み、推測せず確信度を申告し、パリティスイートが新に対して green かつ検証コマンドが通れば完了（差分ゼロは parity-diff との往復の終了条件）。対象環境は --target で選び、証跡は環境別に残す。1 回で 1 機能。replace-strategy setup・golden-dataset・対象 slug の parity-suite 完了が前提で、未完了なら停止する。「新側を実装して」「parity-replace」や --feature / --target / --max-iterations を伴う依頼で発動する。
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
parity-replace [--feature <slug>] [--target <name>] [--max-iterations <n>]
```

- **1 回の実行につき 1 機能。** ページをまたいで並行に実装しない（調査・実装・比較が浅くなり差異を見落とす）
- `slug` は `.replace/features.md` が採番したもの。**自分で採番しない。** 省略時は features.md の未着手から対話選択する
- **モードは `.replace/parity/<slug>/metadata.json` の `mode`（feature / api-resource / batch）を正として引く**（フラグは無い。features.md の表位置から再導出しない）。`mode` は `parity-suite` が features.md の分類（下表の起点）から記録済み
- `--target <name>`（任意）: 実装・検証を行う新側の実行対象環境。設定 `targets` のうち **`side: new`** のものだけを候補にする（本スキルが対象とする側の宣言はここが正本）。
  省略時の既定・候補提示・存在しない名前や側違いでの停止といった**選択規則は `replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う**（ここへ転記しない）
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
  - `golden-dataset` フェーズ B（**新側スキーマ確定後の実行のみ**。選択した target が**投入対象**の場合）= `.replace/dataset/metadata.json` の
    `phase_b.<slug>.<target>.dataset_version` が現在の `version` と一致すること。欠け／古ければ `golden-dataset --phase b --feature <slug> --target <target>` を先に回す。
    **投入対象**は設定の `dataset_mode` で決まる——`db`（既定）なら `db.seedable: true` の target のみ、`static` ならすべての target（契約の正本は `replace-strategy` の `references/project-config.md`）。
    投入対象でない target はフェーズ B の対象外（投入しないため不要。データ整合の未検証は `parity-diff` が扱う）
- **パスは推測せず `.replace/parity/<slug>/metadata.json` から引く**（スイート・現側マッピング・操作アダプタの実パス）。`slug` は `.replace/features.md` から引き、自分で採番しない

## 厳守の制約（禁止事項）

- **パリティスイートが無い状態で実装を始めない**（判定基準が無ければ何をもって完了とするか決められない）
- **推測で実装しない。** 判断できない箇所は `TODO` 等でコード上に未解決と明示しレビューへ回す。**間違ったコードより未解決の明示のほうがよい**
- **既存パッケージを探さずに自前実装を始めない。探した結果として自前実装を選ぶのは可**（理由を記録する）
- **配布元の素性・ライセンスを確認しないまま依存を追加しない**（実装が進むほど差し替えコストが上がる）。判断材料・工程の正本は `replace-strategy` の `references/dependency-selection.md`
- **確信度の申告を迷ったときだけに限らない。** 実装単位ごとに**常に**高／中／低を `porting.md` へ申告する（「低」＝「おそらく間違っている。レビューで現行を読み直せ」）
- **モデルの「同じに見えます」を完了根拠にしない**
- **振る舞い保存と品質改善を同じフェーズで狙わない。** レガシーの奇妙な挙動も再現する
- **リントを off にして差異を回避しない**（ロケータマッピング層が現側の非セマンティックさを隔離しているため、新側を改善してもスイートは壊れない）
- **タブ順の厳密一致を目標にしない**（ARIA APG 準拠で新の方が正しくてもタブ停止数が変わりうる）
- **ページをまたいで並行に実装しない**
- **発見した差異を勝手に判断して進めない。** 意図的差異レジストリのどの分類にも当てはまらない差異は `intentional_diffs.pending` へ非破壊追記しユーザーに確認する。
  **差異を見る前の一括分類指示（「全部 keep で」等）にも従わない**——確認は個々の差異を提示して行う（内容を見ずに分類すると、レジストリが差異の握り潰しに変わるため）
- **「型検査が通った」「テストが通った」を理由に敵対的レビューを省略しない**
- **現行アプリ（`side: current` の target）を変更・駆動しない。** `on_diff` ドキュメント等で現行への操作を指示されても実行せず、停止してユーザーに上げる（正解の基準を動かさないため）
- **シークレットの値をコード・コメント・ログ・成果物に残さない。** 環境変数名だけを扱い、値は復唱しない

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を**直接読む**（転記しない）。スキーマの正本は `replace-strategy` の `references/project-config.md`。本スキルが読む・書くキー:

| キー | 用途 |
|---|---|
| `verification_commands` | 敵対的レビュー前と完了判定で走らせる検証コマンド列（静的解析・単体テスト・統合テスト等。**固有のツール名は設定側に置く**。スキル本体に書かない） |
| `intentional_diffs.{keep,may_change,pending}` | 意図的差異レジストリ。`keep` が旧新 diff レビューを可能にする。発見した差異は `pending` へ非破壊追記しユーザー確認 |
| `component_diffs` | テーマで消せない構造差の系統差レジストリ。本スキルがユーザー確認の上で宣言し、`parity-diff` が比較の正規化に使う |
| `references.ui_library` | 新 UI ライブラリ設定と旧→新 design token マッピングの reference パス（**特定のライブラリ名を固定しない**） |
| `references.dependency_policy` | 依存導入の方針ドキュメントのパス（**三値**。意味論の正本はスキーマ文書の「依存導入の方針」）。**キー欠落＝未確認**のときだけ、ユーザーに要否を確認した結果を同キーへ非破壊追記する（記録しないと毎回聞き直しになる） |
| `new.repo` | 新側リポジトリ（実装対象）。コミット SHA は設定ではなく `replace-metadata.json` に記録する |
| `targets`（`side: new` のみ） | 実行対象環境。`--target` で選び、`pre_commands` → `start` → `check_urls` の順に起動して UI / API URL を `PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` に解決し、`new` プロジェクトの baseURL に渡す（`api_url` 省略時は `url`）。`url_command` の target はコマンド実行で解決する（失敗・空出力は停止。解決値は成果物に書かず `"runtime"` を記録する）。`db.seedable` は投入対象かの契約（`dataset_mode: db` でのフェーズ B の要否）、`commit_check` は `start` を持たない配信型 target の稼働中コミット確認（下記「軽量経路」） |
| `targets[].on_diff` | 選択した target で要対応差分が出たときの対応手順を書いた Markdown のパス（任意。省略時は修正 → 対象 target で再テスト）。本スキルでの解釈手順は [`references/diff-loop.md`](references/diff-loop.md) |
| `targets[].auth.roles` / `targets[].forbidden_actions` | 選択した target のロール別認証情報（`<ロール名>.{user_name_env,password_env}`。値は環境変数の**名前**。認証不要の環境では省略可）と、実施しない UI / API 操作（未定義時の扱いは正本に従う）。いずれも target ごとの定義のみで、側単位のフォールバックは持たない |
| `secrets.wrapper` | シークレットが要るコマンドの前置ラッパー |

各キーの既定値・意味論の正本は上記スキーマ文書にある（ここへ転記しない）。設定・`.replace/features.md` が無ければ `replace-strategy setup` を促して停止する。

- **旧キーはフォールバックとして読まない。** スキーマ正本の「移行」節に列挙された旧キーを見つけたら、同節の対応表を示して**停止する**（旧キーの値で暗黙に代替しない。検出対象の一覧をここへ転記しない）
- **`verification_commands` が設定に無ければ停止する。** 完了判定（新側 green ＋検証コマンド）が成立しないため、勝手にコマンドを推測せずユーザーに確認して設定へ記録してもらう

## 実行フロー

詳細は各 reference へ委譲する。番号順に進める。

1. **前提検証と早期失敗**: 前提（上記）を metadata.json の存在で判定し、欠ければ捏造せず停止して該当スキル（`replace-strategy setup` / `golden-dataset` / 対象 slug の `parity-suite`）の実行を促す。
   `slug` を features.md と突き合わせ、モードとパスは metadata.json から引く。着手時は slug に対応する features.md の **Issue 列の番号**で `issue-start <番号>` を実行してブランチを作る
   （`--commit` / `--pr` は付けない。ブランチ作成・checkout 後の調査・実装は issue-start に委ねず、本スキルの実行フローとして進める）。未起票なら停止して `replace-strategy issues` を促す。
   合わせて**新側 target を確定する**（`--target` の解決規則は上記「使い方」。旧キーを見つけたら移行手順を示して停止）
2. **ページ分割とフェーズ構成**: 機能をページ単位のフェーズに分ける。**1 ページを作り切って比較してから次へ**。フェーズ内は読み取り経路 → 書き込み経路の順。api-resource / batch モードはページ分割せず該当モードで動く。詳細: [`references/paging.md`](references/paging.md)
3. **部品の洗い出しと依存の決定**: このフェーズの実装に要る部品（UI 部品・データ処理・フォント等）を洗い出し、**自前で書くか／どのパッケージを使うか**を実装に入る前に決める。
   判断材料・決める順序（要件 → 素性・ライセンス → 詳細比較）・リポジトリ方針の扱いは `replace-strategy` の `references/dependency-selection.md` に従い、決定を `.replace/dependencies.md` へ**非破壊追記**する。
   `setup` で決定済みの共通部品はここで再決定しない。**実装中に必要と分かったものも、そのまま自前実装で進めず同じ基準で判断して同じファイルへ追記する**（`porting.md` の該当実装単位にも一行残す）
4. **実装（フェーズごと）**: 現行コードをフロント・バック**いずれもロジックの一次情報源として読む**。照合単位を振り分ける（バックエンド＝旧新を並べた diff、フロントエンド＝スイート green か `parity-diff` 差分ゼロ）。
   推測せず、確信度を実装単位ごとに `porting.md` へ**常に**申告し、判断できない箇所は `TODO` で未解決を明示する。詳細: [`references/implementation.md`](references/implementation.md)
5. **新側ロケータマッピングの充填**（feature モード）: **既定は「不要」**。role ＋アクセシブルネームで同じ論理名が解決する。**書くのは解決できない例外だけ。** Select / Autocomplete / Date picker / Modal / Menu は操作アダプタに実装ごとの分岐が必須。
   現側の脆弱マッピングが不要になったかを確認し `porting.md` へ記録。詳細: [`references/new-mapping.md`](references/new-mapping.md)。
   **この「既定は不要」は新側マッピングだけの話であり、フェーズ B は例外ゼロでも省略しない。** データ依存 assertion を green にするには新側 DB への投入が要るため、
   選択した target が投入対象なら新側スキーマが揃った時点で `golden-dataset --phase b --feature <slug> --target <選択中の new target>` を実行する（投入対象でない target では実行しない）。
   そのうえで選択した target を起動し（`pre_commands` → `start` → `check_urls` の順。失敗したら早期停止）、解決した URL を `new` プロジェクトの baseURL に渡す。
   **green 化そのものはフェーズの最後**（敵対的レビューの後）に行う——フェーズ順の正本は [`references/paging.md`](references/paging.md)
6. **見た目の系統差を源流で縮める**（feature モード）: `references.ui_library` で新側ライブラリを選ぶ（固定しない）。テーマ可能なら旧 design token を新側テーマへ寄せる。
   テーマで消せない構造差はクラス/トークン単位の系統差として `component_diffs` へユーザー確認の上で宣言し、宣言できない構造差は `gaps.md` へ追記する（比較の正規化であって仕様変更ではない）。詳細: [`references/theming.md`](references/theming.md)
7. **敵対的レビュー**: レビュー役の往復は高コストなため、先に検証コマンド（設定 `verification_commands`）を通して自明な破綻を安価に落とす（通ったことを**レビューを省略する理由にしない**）。
   そのうえで**ローカルの未コミット差分**に対し commit 前に実施する。実装役とレビュー役を分離し、レビュー役には**差分のみ**を渡し実装意図を知らせない。指摘 → 修正 → 再レビュー。記録は `review.md`（PR に置かない）。詳細: [`references/adversarial-review.md`](references/adversarial-review.md)
8. **完了判定（本スキル単体）**: 選択した target に対しパリティスイートが**新で green** ＋ 検証コマンド（設定 `verification_commands`）が通る（batch モードは実行可能スイートを持たないため**出力一致**＋検証コマンド。モード別の完了判定は [`references/paging.md`](references/paging.md)）。
   証跡は `.replace/parity/<slug>/new/<target>/replace-metadata.json` へ記録する（**環境別**。他の target の証跡を上書きしない）。
   **`parity-diff` の差分ゼロは含めない**（循環回避。理由の正本: [`references/diff-loop.md`](references/diff-loop.md)）。実装フロー（commit / push / PR）は `issue-start` に委ねる
9. **`parity-diff` との往復ループ**: 差し戻し時は `.replace/parity/<slug>/new/<target>/diff.md` を入力に**該当ページのフェーズから再開**（頭から作り直さない）。
   対象 target の `on_diff` ドキュメントがあればそれに従って修正・反映・再テストを進め（無ければ修正して対象 target で再テストする）、反復回数と**その反復で描画に効く変更を入れた範囲**（`loop.changed_scope`。`parity-diff` の自己ノイズ再測定判定に使う）を `new/<target>/replace-metadata.json` に記録する。
   `on_diff` の解釈手順・終了条件・反復上限（`--max-iterations` 既定 5）の正本: [`references/diff-loop.md`](references/diff-loop.md)

### 軽量経路（同一 commit で環境だけ違う場合）

**実装を変えずに、別の target で green 済みのコミットを他の環境（例: local-dev → develop）で確認するだけ**の実行では、実装フローを起動しない。

- **適用条件**: 既存の `.replace/parity/<slug>/new/<別の target>/replace-metadata.json` と現在の作業ツリーとで、**`new.dirty` が両方 `false`（clean）かつコミット SHA が一致する**こと。
  `none` はいかなる値とも一致しない（SHA を取れていない証跡・dirty な作業ツリーは「同一実装」を保証しないため）。満たさなければ通常フロー（手順 2 以降）で進める
- **稼働中コミットの確認**: `start` を持つ target は本スキルが起動するので、上記条件を満たせば自動で適用してよい。
  `start` の無い配信型 target（デプロイで更新される環境）は稼働中のコードが同じ commit とは限らないため、`commit_check` があればその標準出力の SHA と照合し、
  無ければ「対象環境に commit `<SHA>` がデプロイ済みか」をユーザーに確認してから適用する（確認が取れなければ適用しない）
- **飛ばす手順**: 2（ページ分割）・3（部品の洗い出しと依存の決定）・4（実装）・6（見た目の系統差）・7（敵対的レビュー）。手順 5 は**新側マッピングの充填を行わず、フェーズ B 確認・target の起動・green 化だけ**を行う
- **回す手順**: 1（前提検証・target 確定）→ **フェーズ B の確認**（対象 target が投入対象の場合のみ。`.replace/dataset/metadata.json` の `phase_b.<slug>.<target>.dataset_version` ＝ 現在の `version` を確認し、
  欠け／古ければ `golden-dataset --phase b --feature <slug> --target <target>` を先に実行）→ 対象 target の起動（`pre_commands` → `start` → `check_urls`）→
  スイートを新に対して green 化 → 検証コマンド（設定 `verification_commands`）→ 8（`new/<target>/replace-metadata.json` へ証跡を記録）
- **green にならなければ、まずデータを疑う**（フェーズ B 未実施・データセットバージョンの不一致）。次に環境差（URL・起動・外部依存・認証）を疑う。
  **実装を触るのは「同一実装が動いている」前提が崩れたと分かった場合だけ**——そのときは軽量経路を抜けて通常フロー（手順 4 以降）で修正する

## 成果物

すべて対象プロジェクト側に置く。**本スキルが正本を定義するテンプレート**（[`assets/`](assets/)）と、他スキルが正本を持つ成果物への追記がある。

| 成果物 | 場所 | 正本テンプレート |
|---|---|---|
| 実装 | プロジェクトの構成に従う（新側のコード） | — |
| 新側ロケータマッピング | パリティスイートと同じ配置（例外のみ・操作差の分岐を含む） | — |
| 移植メモ | `.replace/parity/<slug>/porting.md` | [`assets/porting-template.md`](assets/porting-template.md) |
| レビュー記録 | `.replace/parity/<slug>/review.md` | [`assets/review-template.md`](assets/review-template.md) |
| メタデータ（**環境別**） | `.replace/parity/<slug>/new/<target>/replace-metadata.json` | [`assets/metadata-template.json`](assets/metadata-template.json) |
| レジストリ追記 | `.config/skills/shoji9x9/skills.yml` の `intentional_diffs` / `component_diffs` / `references.dependency_policy`（未確認だった場合のユーザー確認結果） | 正本: `replace-strategy` の `references/project-config.md` |
| 依存の決定記録 | `.replace/dependencies.md` へ機能固有・実装中の追加を**非破壊追記**（無ければテンプレートから作成） | 様式の正本: `replace-strategy` の `assets/dependencies-template.md` |
| 宣言できない構造差 | `.replace/parity/<slug>/gaps.md` の「宣言できない構造差」節へ**本スキルが追記** | 様式の正本: `parity-suite` の `assets/gaps-template.md` |

- テキスト成果物（`porting.md` / `review.md` / `replace-metadata.json`）は Git。敵対的レビューは PR レビュー機能上ではなく**ローカルの未コミット差分に対して実施**し、その記録が `review.md`（記録ファイル自体は Git 管理してよい）
- **green 証跡だけが環境別**: `replace-metadata.json` は `new/<target>/` 配下に置き、環境を切り替えても他の target の証跡を上書きしない。`porting.md` / `review.md` は環境非依存のため slug 直下に置く
- 本スキルは実行時に固有の決定論的ツールを同梱しない（差分器・視覚ベースラインは `parity-suite` 同梱・`parity-diff` 担当）

## 姉妹スキルとの連携

- **依存順**: `replace-strategy`（setup）→ `golden-dataset`（フェーズ A）→ 各機能で〔`parity-suite` → **`parity-replace`** → `golden-dataset`（フェーズ B）→ `parity-diff`（本スキルと往復）〕
- **`parity-suite` から引き継ぐもの**: 論理名の契約（現・新をまたぐ）、現側 green のスイート、Playwright `projects` の `current` / `new` という名前（`new` の baseURL を選択した target から解決して渡すことと green 化は本スキルの担当。配線の正本は `parity-suite`）、脆弱マッピングを記録したマッピング層コメント。
  **assertion を変えた場合（例外充填・穴埋め）は `parity-suite` の強度ゲート再実行が必要**（詳細: [`references/new-mapping.md`](references/new-mapping.md)）
- **`golden-dataset`（フェーズ B）**: 新側スキーマを作った後（実装フェーズで確定した時点）、`golden-dataset --phase b --feature <slug> --target <選択中の new target>` を実行して新側 DB へ投入する。
  **本スキルの完了後ではなく、新側スキーマ確定後・green 化（完了ゲート）前の工程**。対象は投入対象の target のみ（対象外の target には投入しない）
- **`parity-diff` と往復**: 本スキルで**選択した target に対して**新を green にした後、`parity-diff` を**同じ target** で実行して差分を検出し、差分があれば本スキルへ差し戻す。
  引き渡しは環境別ディレクトリ `.replace/parity/<slug>/new/<target>/`（本スキルが `replace-metadata.json` を書き、`parity-diff` がそれを読んで `diff.md` を書く）。終了条件・上限・再入手順は上記「往復ループ」
- **`issue-start` へ委譲**: ブランチ作成は着手時に features.md の Issue 番号で `issue-start`（モード未指定）を 1 回。実装は本スキルが行うため **`--commit` / `--pr`（実装を内包する）は使わず**、commit は issue-start が解決した規約に従い**ページフェーズ単位**で行う（issue-start の実装ステップへ再入しない）
