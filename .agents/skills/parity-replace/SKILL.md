---
argument-hint: '[--feature <slug>] [--target <name>] [--max-iterations <n>] [--autonomous]'
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
parity-replace [--feature <slug>] [--target <name>] [--max-iterations <n>] [--autonomous]
```

- **1 回の実行につき 1 機能。** ページをまたいで並行に実装しない（調査・実装・比較が浅くなり差異を見落とす）
- `slug` は `.replace/features.md` が採番したもの。**自分で採番しない。** 省略時は features.md の未着手から対話選択する
- **モードは `.replace/parity/<slug>/metadata.json` の `mode`（feature / api-resource / batch）を正として引く**（フラグは無い。features.md の表位置から再導出しない）。`mode` は `parity-suite` が features.md の分類（下表の起点）から記録済み
- `--target <name>`（任意）: 実装・検証を行う新側の実行対象環境。設定 `targets` のうち **`side: new`** のものだけを候補にする（本スキルが対象とする側の宣言はここが正本）。
  省略時の既定・候補提示・存在しない名前や側違いでの停止といった**選択規則は `replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う**（ここへ転記しない）
- `--max-iterations <n>`（任意, 既定 5）: `parity-diff` との往復ループの反復上限。超えたら停止してユーザーに上げる
- `--autonomous` はその実行だけを自律で進める宣言（下記「自律実行」）。省略時は従来どおり判断のたびに確認する

| モード | 起点 | 内容 |
|---|---|---|
| 機能（feature） | features.md の機能 | ページ単位にフェーズ分割。全工程（新側マッピング・視覚系）を使う |
| 横断 API（api-resource） | features.md の横断 API リソース | 画面を持たない API のみ。バックエンド diff レビュー ＋ API スイート green のみ（ページ分割・視覚・新側マッピング無し） |
| バッチ（batch） | features.md のバッチ | バッチ本体の diff レビュー ＋ 出力一致。画面系工程は動かさない |

- 自然文でも発動する:「新側を実装して」「リプレイスの実装を進めて」「この差分レポートから続きを直して」

## 前提

- **ツール**: `git`。ブランチ作成・commit・push・PR は `issue-start` が行う（本スキルは実装フローを再実装しない）
- **前提スキル**: `issue-start`（実装フローの委譲先）、`replace-strategy`（`setup` 完了）、`golden-dataset`（フェーズ A 完了）、対象 slug の `parity-suite`（完了）
- **前提スキルが未インストールの場合**: `gh skill install shoji9x9/skills <name>` で導入してから実行する。
  本スキルは設定スキーマ・成果物様式の**正本を `replace-strategy` / `parity-suite` の `references/` / `assets/` に持つ**ため、単体では成立しない（同時に導入されている前提）
- **MCP**: 不要
- **新側アーキテクチャは事前定義**: 骨格（フレームワーク・レイヤ／ディレクトリ構成・API 設計方針・ホスティング構成）の選定はスキル群の対象外で、
  **新側リポジトリは骨格がスキャフォールド済み**である前提に立つ。本スキルは決定記録（`references.architecture`）を読んで従うだけで、決めない
  （正本: `replace-strategy` の `references/project-config.md`「新側アーキテクチャ」）
- **実行環境の能力**: 敵対的レビュー（手順 7）は**必須工程**であり、**実装役とは別のサブエージェント（Agent ツール等）をレビュー役として起動する**ことを要求する。
  起動できない・実行のたびにユーザー承認が要る実行環境では、**着手前に**可否を確認する（工程 7 で初めて判明する事態を避ける）。
  起動できない場合の代替は、**差分だけを人間のレビュアーへ渡してレビューを受け、記録を `review.md` に残す**こと（レビュー役が人間であった旨を明記する）。**代替が取れなくても省略はしない**（手順: [`references/adversarial-review.md`](references/adversarial-review.md)）
- **前提の判定（無ければ停止し、該当スキルの実行を促す。捏造しない）**:
  - `replace-strategy setup` 完了 = 設定 `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy` と `.replace/features.md` の存在
  - `golden-dataset` フェーズ A 完了 = `.replace/dataset/metadata.json` の存在（`version` は 1 始まりの整数）
  - 対象 slug の `parity-suite` 完了 = `.replace/parity/<slug>/metadata.json` の存在と `suite.current_green`
  - 上の setup・フェーズ A・`parity-suite` と下のフェーズ B（slug × target）は、未解決の保留があれば証拠があっても未完了として扱う（見る保留の範囲の正本: `replace-strategy` の `references/autonomy.md`「下流の前提判定」）
  - `golden-dataset` フェーズ B（**新側スキーマ確定後の実行のみ**。選択した target が**投入対象**の場合）= `.replace/dataset/metadata.json` の
    `phase_b.<slug>.<target>.dataset_version` が存在し、その版より後の `changes[].affects` が slug の実効参照テーブルと交差しないこと。
    影響変更があれば `golden-dataset --phase b --feature <slug> --target <target>` を先に回す。数値が古いだけなら再投入しない。
    判定契約は `golden-dataset` の `references/versioning.md` を参照する。
    **投入対象**は設定の `dataset_mode` で決まる——`db`（既定）なら `db.seedable: true` の target のみ、`static` ならすべての target（契約の正本は `replace-strategy` の `references/project-config.md`）。
    投入対象でない target はフェーズ B の対象外（投入しないため不要。データ整合の未検証は `parity-diff` が扱う）
- **パスは推測せず `.replace/parity/<slug>/metadata.json` から引く**（スイート・現側マッピング・操作アダプタの実パス）。`slug` は `.replace/features.md` から引き、自分で採番しない

## 厳守の制約（禁止事項）

- **仕様確認は十分な証拠が得られる最小コストの経路から始める。** 選択した target から採取され、前提ゲートで対象版・採取時点・条件の一致を確認したパリティ成果物／観測記録 → 現行ソースコード → API の実動作 → UI の実動作の順に調べ、
  下位の証拠だけでは実装判断を確定できない場合に限って次へ上げる。これは調査コストがパリティ成果物／観測記録 < ソースコード < API 操作 < UI 操作の順に高くなるためで、必要な証拠が得られた時点で止め、API／UI 操作は不足する場合だけ行う。
  設計書・仕様書・受領ログを含む受領資料は調査候補の抽出に使ってよいが、現行挙動の確定根拠にはしない。UI 固有の表示・操作は UI で確定する

- **パリティスイートが無い状態で実装を始めない**（判定基準が無ければ何をもって完了とするか決められない）
- **推測で実装しない。** 判断できない箇所は `TODO` 等でコード上に未解決と明示しレビューへ回す。**間違ったコードより未解決の明示のほうがよい**
- **DB の方言差を点検せずにクエリ・データアクセスを書かない。** `references.db_semantics` の点検表（未整備ならスキーマ文書「DB 意味論」の点検項目そのもの）を**書く前**に読み、
  該当・非該当と対応を `porting.md` へ記録する。**「型検査もテストも通った」を点検の代替にしない**——絞り込みが全件に化ける類の差はデータ件数が少ないとスイートが green のまま残り、
  実装後の敵対的レビューで拾うと手戻りが最も高くつく
- **新側アーキテクチャ（骨格）を自分で決めない。** 未整備なら実装工程に入らず停止し、事前定義を促す
  （既存実装から読み取った内容を下書きとして提示するのは可。確定は必ずユーザーが行う）
- **IaC（CDK / Terraform 等）は実装に付随する差分だけを触る。** テーブル追加・ルート追加など新側実装に必要な差分は書いてよいが、**パイプライン・基盤の新規構築はしない**
  （事前条件。区分の正本は `replace-strategy` の `references/scope.md`「スキルが行う作業の範囲」）。付随の範囲を超えると判断したら停止してユーザーに上げる。
  **書いた付随差分は敵対的レビューと `verification_commands.full`（`cdk synth` / `terraform validate` 等）を通す**——パリティスイートは IaC を検証しないため、この 2 つだけが担保になる。
  `verification_commands` は**環境に依存しないコード検証**に限る規約なので、認証情報・リモート state・実環境への問い合わせを要するコマンド（`terraform plan` 等）はここに入れない
- **既に作られた共通部品を、他の利用箇所への影響を測らずに直さない。** 目の前の画面を直す変更が別の画面の見た目を静かに変え、**その画面のスイートができるまで誰も赤くしない**。
  切り分け・直し方・破壊的変更の判断の正本は `parity-component` の `references/amend.md`（同スキルを使っていないプロジェクトでは共通部品も機能ごとに作られるため、この規律は掛からない）
- **既存パッケージを探さずに自前実装を始めない。探した結果として自前実装を選ぶのは可**（理由を記録する）
- **移行元の静的資産（画像・アイコン・favicon・ロゴ・図・書体）を写すかを機能の中で決めない。** `.replace/assets.md` の同じ種類で状態が `有効` の行に従い（`取り消し済み` の行は履歴なので従わない）、台帳に無ければ方針空欄の行を追記し、3 択（実体を写す／同等物を作る／写さない）とそれぞれの再配布の可否・残る差を添えてユーザーに確認し、
  決まるまでその資産に依存する実装単位を進めない（`porting.md` に判断を書いて進まず、台帳の行を指す 1 行だけを残す）。
  **`display: none` の `img` を「出ないから描かない」と決めない**——同じ場所を疑似要素のグリフが描いていることがある。棚卸し・判断・宣言の正本は `replace-strategy` の `references/static-assets.md`
- **配布元の素性・ライセンスを確認しないまま依存を追加しない**（実装が進むほど差し替えコストが上がる）。判断材料・工程の正本は `replace-strategy` の `references/dependency-selection.md`
- **確信度の申告を迷ったときだけに限らない。** 実装単位ごとに**常に**高／中／低を `porting.md` へ申告する（「低」＝「おそらく間違っている。レビューで現行を読み直せ」）
- **モデルの「同じに見えます」を完了根拠にしない**
- **本スキルの完了（新側 green）を「現行と一致」と報告しない。** スイートが見るのは値・ラベル・役割で、余白・幅・罫線・背景・色・寸法・配置は `parity-diff` の担当。
  現行との比較が収束した（見た目も含めて比べ終えた）と報告できるのは、同じ target の `parity-diff` が `.replace/parity/<slug>/new/<target>/diff-metadata.json` を `converged: true` にしてから。
  そのときも無条件の「一致」とは書かず、収束したことと、承認済みの例外・意図的差異・未検証領域を並べて報告する（収束は生の差分ゼロを求めない。正本は `parity-diff` の `references/convergence.md`「収束の定義」）。
  収束前に `parity-diff` が止まった（要対応・他機能待ち・判断待ち・反復上限）ときは、その差分と止まった理由をそのまま報告してよい——禁じるのは一致・収束の主張だけ。
  報告の書き方は手順 8「完了の報告」
- **撮影したビューポートで測った px を並べて版組を作らない。** 3 経路はその点でしか比べないため、1 点の px を並べた版組は全経路で緑のまま別の窓で崩れる。
  位置・寸法は `parity-suite` が読んだ式（`metadata.json` の `capture_conditions.dimension_model.fits`）で写し、完了判定で `dimension-fit.mjs check` を通す（手順 8）
- **振る舞い保存と品質改善を同じフェーズで狙わない。** レガシーの奇妙な挙動も再現する
- **リントを off にして差異を回避しない**（ロケータマッピング層が現側の非セマンティックさを隔離しているため、新側を改善してもスイートは壊れない）
- **タブ順の厳密一致を目標にしない**（ARIA APG 準拠で新の方が正しくてもタブ停止数が変わりうる）
- **ページをまたいで並行に実装しない**
- **発見した差異を勝手に判断して進めない。** 意図的差異レジストリのどの分類にも当てはまらない差異は `intentional_diffs.pending` へ非破壊追記しユーザーに確認する。
  **差異を見る前の一括分類指示（「全部 keep で」等）にも従わない**——確認は個々の差異を提示して行う（内容を見ずに分類すると、レジストリが差異の握り潰しに変わるため）
- **「型検査が通った」「テストが通った」を理由に敵対的レビューを省略しない。** **サブエージェントを起動できないことも省略の理由にしない**（差分だけを人間のレビュアーへ渡す代替を取る）
- **現行アプリ（`side: current` の target）を変更・駆動しない。** `on_diff` ドキュメント等で現行への操作を指示されても実行せず、停止してユーザーに上げる（正解の基準を動かさないため）
- **シークレットの値をコード・コメント・ログ・成果物に残さない。** 環境変数名だけを扱い、値は復唱しない

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を**直接読む**（転記しない）。スキーマの正本は `replace-strategy` の `references/project-config.md`。本スキルが読む・書くキー:

| キー | 用途 |
|---|---|
| `verification_commands` | 検証コマンド。**走る範囲で 2 列に分かれる**——`full`（全体走査）は**完了判定（手順 8）で常に走らせる**列、`diff`（変更ファイルだけ。`{changed_files}` を本スキルが展開する）は敵対的レビュー前の早期検出（手順 7）専用で完了判定には使わない。**固有のツール名は設定側に置く**（スキル本体に書かない）。意味論の正本はスキーマ文書の「検証コマンド」 |
| `intentional_diffs.{keep,may_change,pending}` | 意図的差異レジストリ。`keep` が旧新 diff レビューを可能にする。発見した差異は `pending` へ**追記元が分かる形で**非破壊追記しユーザー確認（**`pending` は設定ファイル上で唯一「スキルが書く作業中記録」**。`keep` / `may_change` へ移すのは人間。書き手区分の正本はスキーマ文書の「キーの書き手とライフサイクル」）。**例外は静的資産で「同等物を作る」を選んだときの宣言**で、ユーザー承認後に `may_change` へ非破壊追記する（`pending` を経由しない。正本は `replace-strategy` の `references/static-assets.md`）。差異の文言は **`item`**（照合キー）、`slug` は対象 slug、`added_by: parity-replace`、`added_at` に追記日の 4 キー（`item` を別のキー名で書くと完了判定は通り、数工程あとの `parity-diff` の棚卸しで「`item` が空」として現れる。要素の形の正本はスキーマ文書の「`pending` 要素の形」）。確定させる時期は `parity-diff` の収束判定が要求する棚卸し（同文書「`pending` の棚卸し」） |
| `component_diffs` | テーマで消せない構造差の系統差レジストリ。本スキルがユーザー確認の上で宣言し、`parity-diff` が比較の正規化に使う。**T が引けないインスタンス例外は設定に置かない**（`parity-diff` の slug 成果物 `.replace/parity/<slug>/component-diff-exceptions.json`。本スキルは書かない。[`references/theming.md`](references/theming.md)） |
| `references.architecture` | 新側アプリの骨格（レイヤ／ディレクトリ構成・API 設計方針・ホスティング構成）の決定記録のパス。**骨格は事前定義であり本スキルは決めない。** 未整備（キー欠落・空値・解決できないパス）なら**部品の採否・実装（手順 3 以降）に入らず停止する**（新側リポジトリに骨格が既に実装されていれば、実態から読み取った内容を下書きとして提示し、ユーザーが確定させてから進める。**確定した決定記録のパスは同キーへ書く**）。意味論の正本はスキーマ文書の「新側アーキテクチャ」 |
| `new.stack` | 新側スタックの列挙。依存の候補が新側スタック（フレームワーク・ORM 等）と両立するかの判断に使う。空・欠落なら推測せずユーザーに確認し、**確認結果を同キーへ非破壊追記する**（記録しないと機能ごとに聞き直しになる）。骨格の未整備ゲートは `references.architecture` が担うため、これ単独では停止しない |
| `references.coding_conventions` | 新側リポジトリのコーディング規約（命名・エラー処理・型の扱い・テストの書き方・レビュー観点）。**実装（手順 4）と敵対的レビュー（手順 7）で読む**。**未整備でも停止しないが、推測で自分の流儀を持ち込まない**——新側リポジトリの基底ドキュメント・リント設定・既存コードから読み取り、解決できたパスは同キーへ非破壊追記する（意味論の正本はスキーマ文書の「コーディング規約」） |
| `references.db_semantics` | 現行 DB → 新 DB の型マッピング・意味論差と、**移植時に踏む方言差の点検表**。**実装（手順 4）でクエリ・データアクセスを書く前に読む**。**未整備（キー欠落・空値・解決できないパス）でも停止しないが、方言差を推測で埋めない**——スキーマ文書「DB 意味論」の点検項目を現行 DB／新 DB の一次ドキュメントで確認し、確認結果と未確定を `porting.md` へ記録して整備を促す。差を吸収しないと決めたら `intentional_diffs.pending` へ非破壊追記しユーザー確認へ回す（意味論の正本はスキーマ文書の「DB 意味論」） |
| `references.ui_library` | 新 UI ライブラリ設定と旧→新 design token マッピングの reference パス（**特定のライブラリ名を固定しない**）。**未整備（キー欠落・空値・解決できないパス）なら手順 6 に入る前に整備を促す**（源流で系統差を縮められず、宣言と未検証が膨らむため。ライブラリを勝手に決めない） |
| `references.dependency_policy` | 依存導入の方針ドキュメントのパス（**三値**。意味論の正本はスキーマ文書の「依存導入の方針」）。**キー欠落＝未確認**のときだけ、ユーザーに要否を確認した結果を同キーへ非破壊追記する（記録しないと毎回聞き直しになる） |
| `new.repo` | 新側リポジトリ（実装対象）。コミット SHA は設定ではなく `replace-metadata.json` に記録する |
| `targets`（`side: new` のみ） | 実行対象環境。`--target` で選び、`check_urls` で稼働判定して落ちているときだけ `pre_commands` → `start` の順に起動し、UI / API URL を `PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` に解決し、`new` プロジェクトの baseURL に渡す（`api_url` 省略時は `url`）。`url_command` の target はコマンド実行で解決する（失敗・空出力は停止。解決値は成果物に書かず `"runtime"` を記録する）。`db.seedable` は投入対象かの契約（`dataset_mode: db` でのフェーズ B の要否）、`commit_check` は `start` を持たない配信型 target の稼働中コミット確認（下記「軽量経路」） |
| `targets[].on_diff` | 選択した target で要対応差分が出たときの対応手順を書いた Markdown のパス（任意。省略時は修正 → 対象 target で再テスト）。本スキルでの解釈手順は [`references/diff-loop.md`](references/diff-loop.md) |
| `targets[].auth.roles` / `targets[].forbidden_actions` | 選択した target のロール別認証情報（`<ロール名>.{user_name_env,password_env}`。値は環境変数の**名前**。認証不要の環境では省略可）と、実施しない UI / API 操作（未定義時の扱いは正本に従う）。いずれも target ごとの定義のみで、側単位のフォールバックは持たない |
| `uses_storage` / `targets[].storage` | ファイルストレージの利用と、選択した新側 target の接続（`env_vars`）・書き込み範囲（`write_scope`）・アップロード経路（`upload_route`）。**読むだけ**で、経路を現側から変えるなら意図的差異として `intentional_diffs.pending` へ非破壊追記しユーザー確認へ回す（`upload_route` 未宣言のまま実装しない）。ストレージ実体への投入は v1 スコープ外（正本: スキーマ文書「ファイルストレージ」、実装上の扱いは [`references/paging.md`](references/paging.md)） |
| `secrets.wrapper` | シークレットが要るコマンドの前置ラッパー |

各キーの既定値・意味論の正本は上記スキーマ文書にある（ここへ転記しない）。設定・`.replace/features.md` が無ければ `replace-strategy setup` を促して停止する。

- **旧キーはフォールバックとして読まない。** スキーマ正本の「移行」節に列挙された旧キーを見つけたら、同節の対応表を示して**停止する**（旧キーの値で暗黙に代替しない。検出対象の一覧をここへ転記しない）
- **`verification_commands.full` が設定に無ければ停止する。** 完了判定（新側 green ＋検証コマンド）が成立しないため、勝手にコマンドを推測せずユーザーに確認して設定へ記録してもらう。
  **値がリスト（旧形式＝走る範囲が未宣言）のときも同じく停止する**——未宣言を「全体」に倒すと、差分限定の結果が「全体で通った」と名乗る。移行の正本はスキーマ文書「`verification_commands` の形の変更」

## 自律実行（`--autonomous`）

規約（宣言・越えない線・停止の 2 分類・保留の記録形・終わりにまとめて聞く手順）の**正本は `replace-strategy` の `references/autonomy.md`**（ここへ転記しない）。
**同ファイルを読めない場合は自律実行せず**、従来どおり確認のたびに止まる。本スキル固有の対応:

- **判断待ち（保留に落とす）**: 意図的差異レジストリに当てはまらない差異（`intentional_diffs.pending` への追記は行い、確認を保留にする）、`component_diffs` の宣言、
  画面より先に作られた共通部品への破壊的変更、台帳に無い静的資産の方針（方針空欄の行の追記は行う）、部品の依存の決定（`new.stack` が空のときを含む）、配信型 target で `commit_check` が無いときのデプロイ済み確認、
  敵対的レビューでサブエージェントを起動できないときの人間のレビュアーへの受け渡し
- **保留に落としても進める工程**: 保留に依存しないページのフェーズ・実装単位。依存する実装単位は `porting.md` に `TODO`（`判断待ち: <id>`）として残し、推測で実装しない
- **従来どおりの停止のまま**: 前提成果物の欠落、骨格（`references.architecture`）の未整備、`verification_commands.full` が無い、反復上限への到達
- **委譲**: `issue-start --branch-only` のブランチ作成は行ってよい。`golden-dataset --phase b` と `parity-diff` へは `--autonomous` を引き継ぐ。commit / push / PR は越えない線の範囲でだけ行う
- **記録先**: `.replace/parity/<slug>/new/<target>/pending-decisions.json`（テンプレート: [`assets/pending-decisions-template.json`](assets/pending-decisions-template.json)）。
  **`replace-metadata.json` には書かない**——`parity-diff` はその存在と `suite.new_green` を前提に使うため、保留を残す目的でこのファイルを作ると後続が進む。
  未解決の保留が残る間は本スキルの完了を報告せず、**保留が敵対的レビュー・green 化に及ぶなら `suite.new_green` を `true` にしない**（green 化はレビューの後なので、レビューが保留なら green 化も行わない）。
  **再実行では、保留に依存する工程に入る前に、既存の `replace-metadata.json` に残る `suite.new_green: true` を `false` へ戻す**（前回の green 証跡を `parity-diff` に流用させない）

## 実行フロー

詳細は各 reference へ委譲する。番号順に進める。

1. **前提検証と早期失敗**: 前提（上記）を metadata.json の存在で判定し、欠ければ捏造せず停止して該当スキル（`replace-strategy setup` / `golden-dataset` / 対象 slug の `parity-suite`）の実行を促す。
   `slug` を features.md と突き合わせ、モードとパスは metadata.json から引く。着手時は slug に対応する features.md の **Issue 列の番号**で **`issue-start <番号> --branch-only`** を実行してブランチを作る
   （`--branch-only` を外さない。モード未指定の issue-start はブランチ作成の後そのまま実装へ進む契約なので、委ねると同じ Issue に対して実装が二重に走る）。未起票なら停止して `replace-strategy issues` を促す。
   合わせて**新側 target を確定する**（`--target` の解決規則は上記「使い方」。旧キーを見つけたら移行手順を示して停止）
2. **ページ分割とフェーズ構成**: 機能をページ単位のフェーズに分ける。**1 ページを作り切って比較してから次へ**。フェーズ内は読み取り経路 → 書き込み経路の順。api-resource / batch モードはページ分割せず該当モードで動く。詳細: [`references/paging.md`](references/paging.md)
3. **部品の洗い出しと依存の決定**: **入る前に骨格（`references.architecture`）の未整備を検出し、未整備なら停止する**（挙動は上記キー表。骨格を自分で決めない）。
   部品は骨格の上に載るため、骨格が未確定のまま採否を決めると差し替えになり、非破壊追記した決定記録も残り続ける。
   このフェーズの実装に要る部品（UI 部品・データ処理・フォント等）を洗い出し、**自前で書くか／どのパッケージを使うか**を実装に入る前に決める。
   判断材料・決める順序（要件 → 素性・ライセンス → 詳細比較）・リポジトリ方針の扱いは `replace-strategy` の `references/dependency-selection.md` に従い、決定を `.replace/dependencies.md` へ**非破壊追記**する。
   `setup` で決定済みの共通部品はここで再決定しない。**実装中に必要と分かった部品も、そのまま自前実装で進めず同じ基準で判断して `.replace/dependencies.md` へ追記する**（`porting.md` の該当実装単位にも一行残す）。
   **台帳は `状態` が `有効` の行だけを読む**（`取り消し済み` は履歴。同じ部品で `有効` が 2 行あれば進まず確認する）。
   採否に至っていない値はこのフェーズが引き取る——`内蔵` は**単体で実装せず**「採用したもの」列のパッケージを実際に採ったかを確かめ、
   `機能固有` で「適用範囲」がこの機能の行・`未確認` の行・この機能で必要になった `該当なし` の行は、ここで確かめて採否を決める。
   決定が覆ったら**古い行の `状態` を `取り消し済み` にしてから新しい行を追記する**（値の意味・覆り方・読む側の規則の正本は `replace-strategy` の `references/dependency-selection.md`「洗い出しの 6 値」）。
   **合わせてこのフェーズのページが描く静的資産を `.replace/assets.md` と突き合わせる**（台帳に無い資産は機能の中で決めず台帳へ戻す。手順の正本は `replace-strategy` の `references/static-assets.md`「実装時に台帳に無い資産に出会ったら」）。
   台帳が無い（本工程の導入前に `setup` を終えた）プロジェクトではテンプレートから作り、このフェーズで出会った資産を方針空欄で追記して確認する
4. **実装（フェーズごと）**: 現行コードをフロント・バック**いずれもロジックの一次情報源として読む**。照合単位を振り分ける（バックエンド＝旧新を並べた diff、フロントエンド＝スイート green か `parity-diff` 差分ゼロ）。
   **クエリ・データアクセスを書く前に `references.db_semantics` の点検表を読む**（未整備でも停止せず、スキーマ文書「DB 意味論」の点検項目を一次ドキュメントで確認する）。点検結果は `porting.md` へ記録する。
   **書き方は新側リポジトリの規約（`references.coding_conventions`）に従う**（未整備でも自分の流儀を持ち込まず、基底ドキュメント・リント設定・既存コードから読み取る）。
   推測せず、確信度を実装単位ごとに `porting.md` へ**常に**申告し、判断できない箇所は `TODO` で未解決を明示する。詳細: [`references/implementation.md`](references/implementation.md)。
   **画面より先に作られた共通部品に手を入れる必要が出たら、規律の正本は `parity-component` の `references/amend.md`** ——
   **判定はファイルの有無ではなく、その部品が実際に先に作られているか**で行う——`.replace/components.md` は「先に作らない部品」も併記するので、
   ファイルが在るだけでは対象の部品が既に作られている根拠にならない（作られていない部品を改修規律へ回すと、採取物も見本も無いまま「全見本を採り直して差分ゼロ」を求めることになる）。
   対象を `components.md` の**部品一覧**の行に引き当て、その slug の `.replace/components/<slug>/new/<選択中の new target>/build-metadata.json` が在ることまで確かめる。
   「先に作らない部品」表にある・一覧に無い・build 成果物が無い部品は、このフェーズで普通に実装する（改修規律は適用しない）。先に作られていた場合は——
   直す前に「利用側の問題／部品の問題／採取の漏れ」を切り分け、足すのは新しい引数で既定値は改修前の挙動にし、**他の利用箇所への影響は目視ではなくその部品の全見本を採り直して差分ゼロで示す**。
   破壊的変更（既存の引数の削除・改名・意味の変更、既定値の変更、既存の見本の出力が変わる変更）は自分で決めず、影響範囲・代替案・やらない場合に残るものを示してユーザーの判断を求める
   **現行コードを読んで口の要求単位を確定したら、その場で `replace-strategy evidence --feature <slug> --endpoint <口> --evidence <根拠>` へ委譲して `.replace/features.md` の「要求単位の根拠」列を `推定` → `実測` へ更新する**
   （**本スキルは features.md を自分では書かない**。経路・昇格条件の正本は `replace-strategy` の `references/evidence.md`）。
   実装のために読む範囲と確定に要る範囲は同じ——読み取りの口は入口の問い合わせ**と応答への写像**、書き込みの口は要求の組み立て**とハンドラの受け取り・トランザクション境界**なので、
   実装できた口は原則として確定している。**確定したのに書き戻さないと、`status` はその口を永久に未確認として報告する**。
   確定した要求単位が features.md の API 列の口と食い違うときは根拠だけ直さず、口の見直しへ回す（同 `references/evidence.md` 手順 4）。
   **`replace-strategy` が未インストールで委譲先に到達できないときは、自分で features.md を書かず**、確定した口と根拠を報告して導入を促す
5. **新側ロケータマッピング・期待値の充填**（feature モード）: **既定は「不要」**。role ＋アクセシブルネームで同じ論理名が解決する。**書くのは解決できない例外だけ。** Select / Autocomplete / Date picker / Modal / Menu は操作アダプタに実装ごとの分岐が必須。
   期待値解決層（`metadata.json` の `suite.expectations`）には**宣言済みの意図的差異に対応する新側の値だけ**を埋める。
   現側の脆弱マッピングが不要になったかを確認し `porting.md` へ記録。詳細: [`references/new-mapping.md`](references/new-mapping.md)。
   **この「既定は不要」は新側マッピングだけの話であり、フェーズ B は例外ゼロでも省略しない。** データ依存 assertion を green にするには新側 DB への投入が要るため、
   選択した target が投入対象なら新側スキーマが揃った時点で `golden-dataset --phase b --feature <slug> --target <選択中の new target>` を実行する（投入対象でない target では実行しない）。
   そのうえで選択した target の稼働を確認し（`check_urls` で稼働判定 → 落ちているときだけ `pre_commands` → `start` → 再確認。最初の稼働判定の失敗は起動の合図であり、`pre_commands` / `start` / 再確認の失敗が早期停止）、解決した URL を `new` プロジェクトの baseURL に渡す。
   **新側でスイートを回す前に、`new` プロジェクトが現側専用スペック（ベースライン採取・ノイズ測定・強度ゲート）を `testIgnore` で除外していることを確認する**（`metadata.json.suite.current_only`）。
   除外されていなければ回す前に設定する——**新側の実行が現側の証跡を静かに上書きする**（配置と設定の正本は `parity-suite` の `references/locator-mapping.md`）。
   **green 化そのものはフェーズの最後**（敵対的レビューの後）に行う——フェーズ順の正本は [`references/paging.md`](references/paging.md)
6. **見た目の系統差を源流で縮める**（feature モード）: `references.ui_library` で新側ライブラリを選ぶ（固定しない）。テーマ可能なら旧 design token を新側テーマへ寄せる。
   テーマで消せない構造差はクラス/トークン単位の系統差として `component_diffs` へユーザー確認の上で宣言し、宣言できない構造差は `gaps.md` へ追記する（比較の正規化であって仕様変更ではない）。
   **移行元の宣言を「写さない」と決めるなら、その宣言が変える次元を全部測ってから決め**、結果を `porting.md` へ記録する（1 つの次元の一致は他の次元の一致の根拠にならない）。詳細: [`references/theming.md`](references/theming.md)
7. **敵対的レビュー**: レビュー役の往復は高コストなため、先に検証コマンドを通して自明な破綻を安価に落とす（通ったことを**レビューを省略する理由にしない**）。
   ここで回すのは `verification_commands.diff`（無ければ `full`）でよいが、**変更集合がファイルの削除・改名（`git diff --name-status` の `D` / `R`）か定義元（design token・共有定数・設定値・型・エクスポート）の削除・改名を含むなら `full` へ前倒しする**——
   壊れる相手が変更集合の外にいるため差分限定では原理的に捕まらない（走る範囲の正本はスキーマ文書「走る範囲」）。
   **前倒しは削除・改名だけではない**——共有された型・スキーマへの**必須プロパティの追加**のように、変更集合の外の利用側が満たさなくなる追加も同じ機構で捕まらないので `full` を回す
   （判断は操作名ではなく「変更集合の外の判定を変えるか」。利用側のテストが緑でも型の不足は見えないことがある）。
   そのうえで**ローカルの未コミット差分**に対し commit 前に実施する。実装役とレビュー役を分離し、レビュー役には**判断の基準だけ**（差分・現行コード・規約・DB 意味論の点検表・レジストリの `keep` / `may_change`）を渡し、実装意図・確信度は知らせない。指摘 → 修正 → 再レビュー。記録は `review.md`（PR に置かない）。詳細: [`references/adversarial-review.md`](references/adversarial-review.md)
8. **完了判定（本スキル単体）**: 選択した target に対しパリティスイートが**新で green** ＋ **`verification_commands.full` が通る**（batch モードは実行可能スイートを持たないため**出力一致**＋ `full`。モード別の完了判定は [`references/paging.md`](references/paging.md)）。
   **feature モードでは寸法の決まり方の照合も完了判定に入れる**（機能の全ページのフェーズを終えた後に 1 回。ページのフェーズでは回さない。理由は [`references/paging.md`](references/paging.md)）
   ——`new` プロジェクトの `dimension/` を `PARITY_DIMENSION_CAPTURE=1 PARITY_NEW_TARGET=<選択中の new target>` 付きで回すと `new/<target>/dimension-samples.json` が書かれるので、**その直後に**
   `node <parity-suite>/scripts/dimension-fit.mjs check --metadata <現側 metadata.json> --current-samples <現側 dimension-samples.json>`
   `--samples <新側 dimension-samples.json> --write <新側 replace-metadata.json>` を通す
   （パスは `.replace/parity/<slug>/` 直下と `.replace/parity/<slug>/new/<target>/` 配下。現側 samples は式の出所の照合に使う）
   （インストール済みの `parity-suite` から実行し、コピーしない）。**exit 1（式と合わない）は未完了**で、1 点の px ではなく式で写し直す。exit 2 は入力の不備で、判定していないので完了扱いにしない。
   現側の `dimension_model` のキーが無い・4 軸の記録が欠けている・現側 samples が式の指紋と一致しないのも exit 2 で、`parity-suite` へ戻して記録させる（`dimension_check` にも `ok: false` と `error` が書かれ、前回の合格は残らない）。
   **判定しなかった（`judged: false`。`not_measured`・`not_required`・照合できる式が 0 件）ときと、式が読めなかった軸（`unfit_to_note`）があるときは、写していない旨と理由を `porting.md`「寸法の決まり方」へ明示する**
   ——書かずに完了を名乗らない（`not_measured` は `parity-suite` からの引き渡し条件であり、`gaps.md` で済ませない。形式の正本は `parity-suite` の `references/baseline.md`「寸法の決まり方（窓への追従）」）。
   **feature モードでは部品被覆表の新側突き合わせも完了判定に入れる**——**移行元の被覆表の 3 値は移行元側の測定**なので、
   `present` をいくら積んでも新側の欠落は 1 件も示されない（スイートが green でも、下位を持つ項目を押すとメニューが閉じる・
   印が押せる範囲の外にある・並び替えの印が文字に重なる、といった「操作を最後まで完了できない」欠落は残る）。
   現側 `metadata.json` の `component_coverage.declared` が `true` なら、`value: present` のセル 1 つにつき 1 行を
   `.replace/parity/<slug>/new/<target>/component-comparison.json` に書き（**環境別**。様式の正本は `parity-suite` の
   `assets/component-comparison-template.json`）、**入口・当たり判定・完了**の 3 点を観測して記録する。
   突き合わせられないセルは理由を書き、**突き合わせないことを選ぶなら利用者の承認**（`disposition: accepted` ＋ `approved_by` / `approved_at`）を得る。
   **記録には新側の版（`new_implementation.commit` ＝ そのときの `new.commit`、`dirty: false`）も書く**——書かないと、記録の後に実装を変えても古い証拠が通る
   （当たり判定・完了の退行はスイートの green に出ないので、この工程が唯一の網になる）。
   **`new.commit` が `none`（新側が git 管理を持たない）なら `new_implementation.iteration` にそのときの `loop.iterations` も書く**——
   `none` どうしの比較は常に一致するので、書かないと鮮度検査が一度も効かない（検査は `comparison-implementation-unversionable` で落とす）。
   記録したらインストール済みの `parity-suite` の
   `node <parity-suite>/scripts/component-comparison-check.mjs --coverage <被覆表> --comparison <突き合わせ表> --metadata <現側 metadata.json>`
   `--replace-metadata <new/<target>/replace-metadata.json> --target <選択中の new target>`
   を **exit 0 まで通す**（コピーせずスキル配下から実行する。`source_coverage.fingerprint` は手で書かず検査が出す期待値を写す）。
   **`parity-diff` の収束判定も同じスクリプトを呼ぶ**ので、ここで通しておかないと差分の工程で差し戻される。
   **`porting.md`「移行元の宣言を写さないと決めた箇所」が空欄のまま完了を名乗らない**（該当なしは「該当なし」と書く。空欄だと「写さなくてよい」と「誰も測っていない」が区別できない。記録の条件は [`references/theming.md`](references/theming.md)）。
   **完了判定は常に `full` で行う**——手順 7 で `diff` が通ったことを `full` を省く理由にしない。実行した列（`full` / `diff`）と各コマンドの結果は証跡（`replace-metadata.json` の `verification`）へ記録する。
   合わせて `verification.unchecked` に **`.replace/strategy.md`「未検証領域の扱い」の機械検査の穴のうち本機能に効くもの**を写す（正本は `.replace/strategy.md` 側。ここは機能ごとの証跡のための写し。該当が無ければ空配列）。
   合わせて、**他機能のスイートに置かれた在席チェックのうち自 slug を理由にスキップされているものを外し**、green を確認する（自機能のページを他機能と共有する場合。外して赤くなるなら、そのページでの自機能の在席が欠けている）。
   対象は**注記の機械的な目印**（既定は `presence:<slug>`）でスイート全体を検索して見つける（自然文の読み取りで探さない）。
   在席チェックの置き方の正本は `parity-suite` の `references/coverage.md`「同じページに乗る他機能の在席」。
   証跡は `.replace/parity/<slug>/new/<target>/replace-metadata.json` へ記録する（**環境別**。他の target の証跡を上書きしない）。
   feature モードでは `new.commit` と並べて **`new.render_inputs`**（このページの描画に効くファイルの git pathspec の配列: route・使う部品・テーマ・トークン・グローバル CSS）も書いてよい。
   部品の改修で SHA が進んだとき、鮮度検査は描画入力の差分が変更宣言の範囲に収まるかで証跡を持ち越す（`parity-diff` の `references/component-change.md`）。
   **過小に書かない**——漏れたファイルの変更は持ち越しを素通りする。判断が付かなければ書かない（無い・空なら従来どおり SHA の一致で判定する）
   **`parity-diff` の差分ゼロは含めない**（循環回避。理由の正本: [`references/diff-loop.md`](references/diff-loop.md)）。実装フロー（commit / push / PR）は `issue-start` に委ねる。
   **合わせて「要求単位の根拠」の取りこぼしを完了判定に入れる**——インストール済みの `replace-strategy` から
   `node <replace-strategy>/scripts/evidence-gap-check.mjs --features .replace/features.md --slug <slug> --unmeasured .replace/parity/<slug>/metadata.json`
   を通す（コピーせずスキル配下から実行する）。数えるのは**自 slug の行で未確認のまま `unmeasured` にも宣言されていない口**で、
   これは「確定できなかった」と「確定したのに書き戻していない」を区別するためのゲートである
   （`推定` を残すこと自体は正常で、**宣言の無い `推定` だけ**が未完了。区別が付かないまま閉じると `status` はその口を永久に未確認として報告し続ける）。
   - **exit 1（未宣言の口がある）は未完了**。確定しているなら `replace-strategy evidence` で書き戻し、確定できなかったなら
     `unmeasured` への宣言（`endpoint` に口を書く）を `parity-suite` へ戻して依頼する——**本スキルは features.md も `unmeasured` も書かない**
     （書き手の正本は `replace-strategy` の `references/evidence.md` と `parity-suite` の `references/coverage.md`「未測定を機械可読にする」）
   - **exit 2 は入力の不備**（slug が無い・口が重複している等）。判定していないので完了扱いにせず、インベントリを直す
   - **exit 4 は対象外**（その slug の行がバッチ・「その他の Issue」の表にあると見出しから同定できた）。**batch モードは常にこれになる**——
     バッチ行は口を持たないので検査対象が無く、本ゲートは通過とする（インベントリを直す話ではないので exit 2 と混同しない）。
     **対象外は見出しからの陽性同定だけが名乗る**ので、「口の列が無ければ通過」とは読み替えない——
     バッチ・「その他の Issue」と同定できない表（列名のずれ・列の導入前の機能一覧）は exit 2 か exit 3 に落ちる。
     **`--unmeasured` に渡すパスが未生成でも exit 4 になる**（行の分類を先に済ませる実装）ので、batch モードの exit 2 は引数の不足ではなく
     **メッセージが名指しする原因**で切り分ける——`行がインベントリに無い`（バッチ表が `なし` のまま着手した等）と `行が N 件ある` はインベントリ側、
     `列名が規約とずれている` / `見出しを規約名に揃える` は列名側。**exit 4 も「検査した」ではないので、対象外だった事実と slug を `porting.md` へ残す**
     （口の列らしい見出しを持たない表は対象外に倒れるため、口の列を規約外の名前で書いた台帳はここを素通りしうる）
   - **exit 3 は判定不能**。原因は 1 つだけ——**その slug の行の表に「要求単位の根拠」列が無い**（列の導入前のインベントリ、または表の種別を同定できない）。
     **ここだけは完了を止めない**——列を持たない台帳では `推定` を記録する場所自体が無く、止めると導入前に作られた全機能が一斉に閉じられなくなるため。
     **`metadata.json` に `unmeasured` キーが無い旧成果物は exit 3 にならない**（宣言ゼロとして数え、未確認の口が残れば exit 1 で落ちる）——
     あちらは「判定できない」ではなく「1 つも宣言されていない」が事実なので、後方互換の対象にすると推定の口が残ったまま通過する。
     **合格の証拠にはならない**ので、判定不能だった事実と対象 slug を `porting.md` へ必ず記録し、列の追加を `replace-strategy` 側で行うよう促す
     （「合格に倒さない」の意味は `replace-strategy` の `references/evidence.md`「漏れを数える」を参照）
   - **スクリプトに到達できない**（`replace-strategy` が未インストール）ときは合格に倒さず完了を止め、導入手順（`gh skill install shoji9x9/skills replace-strategy`）を示す——
     委譲先の実在を確かめずに緩めると、書き戻しも宣言もされていない状態が黙って通る

   **完了の報告**: 通した判定（スイート green・`full`・モード別の照合）を列挙し、**現行との一致は主張しない**。
   feature モードでは「見た目（余白・幅・罫線・背景・色・寸法・配置）は `parity-diff` の収束まで未検証」を**必ず書く**——
   スイートが green でも 1 画面の画素の大半が違うことがあり（ページの器の幅・ヘッダーの位置・表の組み方）、書かないと利用者が画面を並べて見るまで気付かれない。
   api-resource / batch モードでも、一致の主張は `parity-diff` の収束まで保留する（batch モードの完了判定にある「出力一致」（[`references/paging.md`](references/paging.md)）はスイートのベースラインに対する判定で、現行との一致の報告ではない）。
   **次の工程として、同じ target を渡した `parity-diff --feature <slug> --target <target>` を案内する**（`--autonomous` 実行ならそのまま委譲する）。
   同じ target の `diff-metadata.json` が既に `converged: true` でも、**本スキルはそれを収束の報告に使わない**——収束の入力は新側だけでなく、
   現側ベースライン・データセットのバージョン・撮影条件・差分器の設定にも及び、その鮮度は `parity-diff` の前提確認（`parity-diff` の `references/preflight.md`）だけが判定する。
   収束を報告するのは、そのとき `parity-diff` を回して得た結果に拠る場合だけにする
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
- **回す手順**: 1（前提検証・target 確定）→ **フェーズ B の確認**（対象 target が投入対象の場合のみ。`.replace/dataset/metadata.json` の `phase_b.<slug>.<target>.dataset_version` 後に対象 slug へ影響する `changes` が無いことを確認し、
  欠け／古ければ `golden-dataset --phase b --feature <slug> --target <target>` を先に実行）→ 対象 target の稼働確認（`check_urls`。落ちていれば `pre_commands` → `start` → 再確認）→
  スイートを新に対して green 化 → 検証コマンド（`verification_commands.full`。軽量経路でも完了判定は全体走査）→ 8（`new/<target>/replace-metadata.json` へ証跡を記録）
- **green にならなければ、まずデータを疑う**（フェーズ B 未実施・データセットバージョンの不一致）。次に環境差（URL・起動・外部依存・認証）を疑う。
  **実装を触るのは「同一実装が動いている」前提が崩れたと分かった場合だけ**——そのときは軽量経路を抜けて通常フロー（手順 4 以降）で修正する

## 成果物

すべて対象プロジェクト側に置く。**本スキルが正本を定義するテンプレート**（[`assets/`](assets/)）と、他スキルが正本を持つ成果物への追記がある。

| 成果物 | 場所 | 正本テンプレート |
|---|---|---|
| 実装 | プロジェクトの構成に従う（新側のコード） | — |
| 新側ロケータマッピング | パリティスイートと同じ配置（例外のみ・操作差の分岐を含む） | — |
| 期待値解決層の新側の値 | `metadata.json` の `suite.expectations` が指すパス（宣言済みの意図的差異に対応する項目のみ充填） | 層の正本: `parity-suite` の `references/locator-mapping.md` |
| 寸法の採取値（feature モード。**環境別**） | `.replace/parity/<slug>/new/<target>/dimension-samples.json`（`dimension/` の測定スペックが `new` の実行で書く） | 形式の正本: `parity-suite` の `scripts/dimension-fit.mjs` |
| 移植メモ | `.replace/parity/<slug>/porting.md` | [`assets/porting-template.md`](assets/porting-template.md) |
| レビュー記録 | `.replace/parity/<slug>/review.md` | [`assets/review-template.md`](assets/review-template.md) |
| 部品被覆表の新側突き合わせ（feature モードで `component_coverage.declared: true` のとき。**環境別**） | `.replace/parity/<slug>/new/<target>/component-comparison.json` | 様式・検査の正本: `parity-suite` の `assets/component-comparison-template.json` と `scripts/component-comparison-check.mjs` |
| メタデータ（**環境別**） | `.replace/parity/<slug>/new/<target>/replace-metadata.json` | [`assets/metadata-template.json`](assets/metadata-template.json) |
| レジストリ追記 | `.config/skills/shoji9x9/skills.yml` の `intentional_diffs` / `component_diffs` / `references.dependency_policy`（未確認だった場合のユーザー確認結果） / `new.stack`（空・欠落時に確認した結果） / `references.architecture`（既存実装から読み取り、ユーザーが確定させた決定記録のパス） | 正本: `replace-strategy` の `references/project-config.md` |
| 依存の決定記録 | `.replace/dependencies.md` へ機能固有・実装中の追加を**非破壊追記**（無ければテンプレートから作成）。`内蔵` / `機能固有` / `未確認` / `該当なし` を引き取って決めた結果も、古い行の `状態` を `取り消し済み` にして新しい行を追記する | 様式の正本: `replace-strategy` の `assets/dependencies-template.md` |
| 静的資産の台帳への追記 | `.replace/assets.md` へ台帳に無い資産を方針空欄で**非破壊追記**し、ユーザーが決めた方針を記録する（無ければテンプレートから作成）。「同等物を作る」ならユーザー承認済みの宣言を `intentional_diffs.may_change` へ | 様式の正本: `replace-strategy` の `assets/assets-template.md` |
| 宣言できない構造差 | `.replace/parity/<slug>/gaps.md` の「宣言できない構造差」節へ**本スキルが追記** | 様式の正本: `parity-suite` の `assets/gaps-template.md` |

- テキスト成果物（`porting.md` / `review.md` / `replace-metadata.json` / `new/<target>/component-comparison.json` /
  `new/<target>/dimension-samples.json`）は Git。敵対的レビューは PR レビュー機能上ではなく**ローカルの未コミット差分に対して実施**し、その記録が `review.md`（記録ファイル自体は Git 管理してよい）
- **green 証跡だけが環境別**: `replace-metadata.json` は `new/<target>/` 配下に置き、環境を切り替えても他の target の証跡を上書きしない。`porting.md` / `review.md` は環境非依存のため slug 直下に置く
- 本スキルは実行時に固有の決定論的ツールを同梱しない（差分器・視覚ベースラインは `parity-suite` 同梱・`parity-diff` 担当）

## 姉妹スキルとの連携

- **依存順**: `replace-strategy`（setup）→ `golden-dataset`（フェーズ A）→ **画面より先に部品を作る方針なら `parity-component`** → 各機能で〔`parity-suite` → **`parity-replace`** → `golden-dataset`（フェーズ B）→ `parity-diff`（本スキルと往復）〕
- **`parity-component` との関係**: 共通部品が先に作られている場合、本スキルは**その部品を使う側**になる。実装中に部品へ手を入れる必要が出たときの規律（切り分け・影響の測り方・破壊的変更の判断）は
  同スキルの `references/amend.md` が正本で、本スキルはそこへ委譲する。**部品を先に作っていないプロジェクトでは、共通部品も本スキルが機能ごとに作る**（従来どおり）
- **`parity-suite` から引き継ぐもの**: 論理名の契約（現・新をまたぐ）、現側 green のスイート、
  現側の値だけが埋まった期待値解決層（新側の値の充填は本スキル。[`references/new-mapping.md`](references/new-mapping.md)）、
  Playwright `projects` の `current` / `new` という名前（`new` の baseURL を選択した target から解決して渡すことと green 化は本スキルの担当。配線の正本は `parity-suite`）、脆弱マッピングを記録したマッピング層コメント。
  **assertion を変えた場合（例外充填・穴埋め）は `parity-suite` の強度ゲート再実行が必要**（詳細: [`references/new-mapping.md`](references/new-mapping.md)）
- **`golden-dataset`（フェーズ B）**: 新側スキーマを作った後（実装フェーズで確定した時点）、`golden-dataset --phase b --feature <slug> --target <選択中の new target>` を実行して新側 DB へ投入する。
  **本スキルの完了後ではなく、新側スキーマ確定後・green 化（完了ゲート）前の工程**。対象は投入対象の target のみ（対象外の target には投入しない）
- **`parity-diff` と往復**: 本スキルで**選択した target に対して**新を green にした後、`parity-diff` を**同じ target** で実行して差分を検出し、差分があれば本スキルへ差し戻す。
  引き渡しは環境別ディレクトリ `.replace/parity/<slug>/new/<target>/`（本スキルが `replace-metadata.json` を書き、`parity-diff` がそれを読んで `diff.md` を書く）。終了条件・上限・再入手順は上記「往復ループ」
- **`replace-strategy evidence` へ委譲**: 実装で現行の要求単位を確定したら、その口の「要求単位の根拠」の書き戻し（`推定` → `実測`）をこのモードで行う（実行フロー手順 4）。
  **本スキルは `.replace/features.md` を書かない。** 確定できなかった口の `unmeasured` 宣言は `parity-suite` へ戻す。完了判定はこの 2 つの取りこぼしを拾う（手順 8）
- **`issue-start` へ委譲**: ブランチ作成は着手時に features.md の Issue 番号で `issue-start <番号> --branch-only` を 1 回。
  実装は本スキルが行うため**モード未指定・`--commit` / `--pr`（いずれも実装を内包する）は使わない**。
  commit は issue-start が解決した規約に従い**ページフェーズ単位**で行う（issue-start の実装ステップへ再入しない）
