---
name: parity-suite
description: 仕様を変えないアプリケーションリプレイスで、新旧どちらの実装にも当てられる実行可能な合否判定基準（パリティスイート）を現行アプリに対して構築し、故障注入で強度を検証する replace-strategy の姉妹スキル。論理名のロケータマッピング層と手書きの寛容な aria スナップショットで Playwright スイートを書き、API を record/replay で特性化し、視覚ベースライン（スクリーンショット・computed style・参考 aria スナップショット）とノイズ基準値を採取して parity-diff へ引き渡す。1 回で 1 機能（横断 API リソース・バッチも可）。replace-strategy setup と golden-dataset の完了が前提で、未完了・Playwright 不可なら停止する。「パリティスイートを作って」「現行アプリを特性化して」「parity-suite」や --feature <slug> / --target <name>（対象環境）を伴う依頼で発動する。
argument-hint: "[--feature <slug>] [--target <name>] [--autonomous] [--from <区切り>] [--until <区切り>]"
license: MIT
---

# Parity Suite

`replace-strategy` の姉妹スキル。**現行アプリに対してパリティスイート（新旧どちらの実装にも当てられる実行可能な合否判定基準）を構築し、故障注入で強度を検証するところまで**を担う。
**新側には触れない**——新側マッピングの充填は `parity-replace`、現・新の差分検出は `parity-diff` の担当。
視覚ベースラインとノイズ基準値は現行アプリを 1 回巡るついでに採取し、`parity-diff` へ引き渡す。

## 使い方

```text
parity-suite [--feature <slug>] [--target <name>] [--autonomous] [--from <区切り>] [--until <区切り>]
```

- **1 回の実行につき 1 機能。** 複数機能を並行して進めない（調査・特性化・強度検証が浅くなるため）
- `--autonomous` はその実行だけを自律で進める宣言（下記「自律実行」）。省略時は従来どおり判断のたびに確認する
- `--until <区切り>` はその区切りを記録したら止まって返る。`--from <区切り>` は記録した区切りを照合してから次の手順で再開する。
  区切りは `authored`（手順 5 の後）・`captured`（手順 6 の後）・`gated`（手順 7 の後）。**文脈を縮められない実行形態（subagent 等）では区切りごとに分けて回す**
  （1 つの文脈で最後まで回すと費用がターン数の 2 乗で増える。再開の手順と各区切りで揃う成果物の正本は [`references/checkpoints.md`](references/checkpoints.md)）
- `slug` は `.replace/features.md` が採番したもの。**自分で採番しない。** 省略時は features.md の未着手から対話選択する
- `--target <name>` は実行対象の現行環境。設定の `targets` のうち **`side: current` のものだけを候補**にする（本スキルが対象とする側の宣言はここが正本）。
  省略時の既定・候補提示・存在しない名前や側違いでの停止といった**選択規則は `replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う**（ここへ転記しない）
- **モードは slug の種別で決まる**（フラグは無い）。features.md の 機能／横断 API リソース／バッチ のどの表にあるかで下表のモードになる

| モード | 起点 | 内容 |
|---|---|---|
| 機能（feature） | features.md の機能 | 画面駆動でスイート＋ベースラインを採取。全構成要素を使う |
| 横断 API（api-resource） | features.md の横断 API リソース | 画面を伴わない API のみの特性化。スイートは一度だけ書いて共有 |
| バッチ（batch） | features.md のバッチ | データセット＋入力ファイルで現行バッチを走らせ、出力を現行ベースラインに捕捉 |

- 自然文でも発動する:「パリティスイートを作って」「現行アプリを特性化して」「この機能を強度検証して」

## 前提

- **ツール**: `git`、Node.js（Playwright の実行環境）。`gh` は不要（本スキルは Issue を操作しない）
- **前提スキル**: `replace-strategy`（`setup` 完了）、`golden-dataset`（フェーズ A 完了）
- **前提スキルが未インストールの場合**: `gh skill install shoji9x9/skills <name>` で導入してから実行する。
  本スキルは設定スキーマ・成果物様式の**正本を `replace-strategy` の `references/` / `assets/` に持つ**ため、単体では成立しない（同時に導入されている前提）
- **MCP**: 不要（現行アプリの駆動は Playwright 自身が行う）
- **対応範囲（比較・検証の範囲）の一覧は `replace-strategy` の `references/scope.md` が正本。** 本スキルは実行時の行動（`gaps.md` への記録・`golden-dataset` への差し戻し）を持ち、一覧を転記しない
  （読めない環境では対象外と断定せず `gaps.md` に未検証として残す）
- **Playwright（TypeScript）前提**。好みではなく設計が Playwright 固有機能に依存するため。理由は 3 点:
  - `toMatchAriaSnapshot` の既定が部分一致であることを利用して「寛容なスナップショット」を手書きする
  - `getByRole` / `getByLabel` が ARIA とセマンティクスから role とアクセシブルネームを解決するため、マークアップが違っても同じ記述が両実装に当たりうる
  - `projects` で同一スイートを 2 つの baseURL（現・新）へ流せる。API 特性化も `request` フィクスチャで同じ仕組みに寄せられる

  **Playwright を使えないプロジェクトでは本スキルの設計は成立しない**ため、その旨を明示して停止する（代替ランナーでスイートを書かない）。

## 厳守の制約（禁止事項）

- **仕様確認は十分な証拠が得られる最小コストの経路から始める。** 選択した現行 target から取得し、対象版・採取時点・条件を追跡できる実行ログ／観測記録 → 現行ソースコード → API の実動作 → UI の実動作の順に調べ、
  下位の証拠だけでは assertion にする挙動を確定できない場合に限って次へ上げる。これは調査コストが実行ログ／観測記録 < ソースコード < API 操作 < UI 操作の順に高くなるためで、必要な証拠が得られた時点で止め、API／UI 操作は不足する場合だけ行う。
  設計書・仕様書・受領ログを含む受領資料は調査候補の抽出に使ってよいが、現行挙動の確定根拠にはしない。UI の表示・操作を assertion にする箇所は UI で確定する

- **採取した aria スナップショットを assertion にしない。取って diff しない。** 新旧の取得物を機械的に突き合わせると、新実装が正しくなったことによる差とノイズが混ざりシグナルにならない。assertion は仕様が保証する項目だけを手書きした寛容なスナップショットのみ（採取物は参考資料）
- **ページ全体を 1 枚の aria スナップショットにしない。** 部分一致が許容するのは**書いていない兄弟が在ること**だけで、**入れ子の深さは飛ばせず順序も厳密**なため、1 枚で書くと現行の DOM 階層が契約に入り、新側が構造を改善しただけで赤くなる（セクション単位でアンカーする。[`references/coverage.md`](references/coverage.md)）
- **意図的差異レジストリに宣言の無い差を side 別の期待値で吸収しない。** 新側の不一致を期待値側で緑にすることになる（宣言に無い差は `intentional_diffs.pending` へ回してユーザー確認）
- **タブ順の厳密一致（停止数・順序の完全一致）を assertion にしない。** 仕様が保証するのは到達可能性と論理的順序であり、停止数は実装方式で変わりうる
- **id / name を比較のアンカーにしない。** 原則は role ＋アクセシブルネーム（自動生成 id は変更対象）
- **待たない取得 API の検査を省かない。** feature モードの authoring 後は `node <skill>/scripts/auto-wait-check.mjs <parity_suite_dir>/parity/` を実行し、走査対象が 1 件以上・違反 0 件・**判定不能 0 件**になるまで先へ進まない（禁止 API と理由、判定不能の解消手順の正本は [`references/locator-mapping.md`](references/locator-mapping.md)）
- **強度検証（故障注入）を省いて「テストがあるから大丈夫」としない。** テストの存在自体は品質の証拠にならない
- **強度を手書き assertion 単体で判定しない。** 「手書き assertion ＋ ベースライン ＋ 差分器」の一式で判定する
- **故障注入の緑を「スイートは強い」と宣言しない。** カタログ外は射程外であり、緑は反例が見つからなかったことに過ぎない
- **現行アプリのデータを破壊しない**（選択した target の `forbidden_actions` を尊重。書き込みが許可されない target ではスイートの書き込み系スペックを実行せず「未検証」として `gaps.md` に記録する）
- **意味論が未確定の機能でスイートを書き始めない。** `current.origin: received-assets` で、対象 slug の必須データ意味論が `.replace/bootstrap/semantics.md` の
  「確認待ち」または「確認したが確定できなかったもの」に残っている間は、**合否判定基準を作れない**（何が正解かが決まっていない）。推測でシナリオを埋めず、不足情報を報告して停止する
- **同じ部品の 1 インスタンスで測った結果を、他のインスタンスの測定結果として流用しない。** 部品は画面ごとに設定が違うため、あるページで無効な操作が別のページでは有効でありうる。
  インスタンス（部品 × ページ）ごとに測り、`present` / `absent` / `unmeasured` の 3 値で被覆表に残す（[`references/coverage.md`](references/coverage.md)「部品被覆表」）
- **被覆表を見た目の担保として扱わない。** 数えるのは操作と状態の**有無**だけで、色・寸法・余白・書体は見ていない（機能が揃っていて見た目が全部違う部品も全セルが `present` で埋まる）。
  `unmeasured` 0 を「見た目が現行と合っている」の根拠にしない——見た目は画素比較と特性照合が持ち、**画面より先に作った共通部品では `parity-component`** が持つ（[`references/coverage.md`](references/coverage.md)「被覆表は見た目を見ていない」）
- **測っていない部品の操作を、被覆表の空欄で済ませない。** 行が無い組み合わせ・`evidence` の空欄は `unmeasured` として数える（fail-closed）。
  `metadata.json` の `component_coverage` を**キーごと省略しない**——キーの欠落は旧成果物の意味になり、`parity-diff` が後方互換で判定を飛ばす経路に測らなかった事実が紛れる
- **操作の特性化を「押した直後の状態」で止めない。** 反応は遅れて出る・操作した器の外（親文書・別フレーム）に出る・自動で消えるため、直後のスナップショットでは取りこぼす。
  操作ごとに反応の欄を反応の被覆表 `reactions.json` に持たせ（無ければ `kind: none` を実測で書く）、**出るまで待ち、消えるまでの時間を 2 回以上測って** assertion にし、
  移行元ソースのフィードバック呼び出しと `scripts/reaction-check.mjs` で突き合わせる（[`references/coverage.md`](references/coverage.md)「操作の反応」）
- **被覆表に載せる項目の粒度を自分の判断で決めない。** データグリッドのように構成要素ごとに操作可否が設定される部品は、
  代表列だけを測っても被覆表は満たせてしまう（登録しなかった列は期待セルにすら現れない）。
  **同梱の被覆プロファイルで候補集合を展開し、`scripts/coverage-expand.mjs` で被覆表と機械的に照合する**
  （[`references/coverage-profiles.md`](references/coverage-profiles.md)）。
  適合するプロファイルが無い複雑な部品は暗黙に汎用扱いにせず、`profile: null` ＋理由で未検証として残す
- **視覚採取を同値クラスで減らすとき、代表以外の候補を成果物から消さない。** 削減してよいのは視覚ベースライン採取だけで、
  **E2E は全候補に要る**（機能配線の確認は候補ごと）。削減するなら `equivalence_classes` に**分類根拠**と
  **全候補の所属**を残す——**1 つでもクラスを宣言したら、どのクラスにも属さない候補が 1 件でもあれば失敗する**。
  根拠は「現行アプリで実際に同じ描画になることを確かめた手順」で、**「見た目が同じそう」は根拠にしない**
  （[`references/coverage-profiles.md`](references/coverage-profiles.md)「視覚採取の同値クラス」）
- **ブラウザで確認していない挙動を「確認済み」と記録しない。** 未検証は理由付きで `gaps.md` に残す。
  **ファイルアップロードも同じ**——`setInputFiles` で流せることは、その画面で通ったことの証拠にならない（操作可能性と特性化済みを混同しない）
- **バイト列に到達できない出力を「対象」として扱わない。** ダウンロードが発火しない・出力ディレクトリに到達できない出力は `gaps.md` に未検証として残す
  （取得経路と形式別の扱いの正本は `replace-strategy` の `references/file-io.md`。xlsx は揮発項目のため**バイト一致を取らない**）
- **side 専用スペックを相手側の project の実行対象に残さない。** `testIgnore` で両向きに除外する——現側専用（ベースライン採取・ノイズ測定・強度ゲート）を `new` に残すと新側の実行が現側の証跡を静かに上書きし、
  `parity-diff` が後から置く新側専用（`new-only/`）を `current` に残すと現行アプリの画面が新側ベースラインとして書き出され差分ゼロに化ける。
  新側専用は `new`（`parity-replace` の green 検証用）からも除外し、採取専用の `new-capture` プロジェクトで走らせる——`new` に残すと green 検証がテスト収集の時点で落ちる
- **撮影したビューポートの 1 点で合うことを「寸法が合う」として扱わない。** 3 経路はその点でしか比べないため、1 点の実測 px を並べた新側の版組が全経路で緑になる。
  feature モードでは窓を変えて位置と寸法の式を読み、`metadata.json` の `capture_conditions.dimension_model` を**キーごと省略しない**（ビューポートが 1 つなら `measured` か理由付きの `not_measured`）。
  **未測定を `gaps.md` に書いて済ませない**——`parity-replace` への引き渡し条件として `dimension_model` に残す（[`references/baseline.md`](references/baseline.md)「寸法の決まり方（窓への追従）」）
- **スクロールバーを隠した撮影だけで、頁の高さの決め方（`height: 100%` と `100vh`）を担保しない。** Playwright のヘッドレス Chromium はスクロールバーを隠すので、横スクロールバーが出る窓でもこの差は 0 になり、3 経路すべてが緑のまま通る。
  feature モードでは `capture_conditions.scrollbars`（撮影時の扱い）と `capture_conditions.overflow`（スクロールバーを表示した、頁の最小幅より狭い窓での縦・横のはみ出し）を**キーごと省略しない**
  （[`references/baseline.md`](references/baseline.md)「スクロールバーが場所を取る窓のはみ出し」）
- **採取環境でだけ成立する一致を「一致」として扱わない。** 総称ファミリーのフォントフォールバック等は採取環境では差分ゼロになり、利用者環境でだけ壊れる（`viewer_environment` に記録し、乖離は `gaps.md` へ）
- **スイートに依存を追加するとき、配布元の素性・ライセンス・メンテナンス状況を確認せずに導入しない**（既存パッケージを探さずに自前実装を始めるのも同様）。判断材料・工程の正本は `replace-strategy` の `references/dependency-selection.md`、記録先は `.replace/dependencies.md`
- **シークレットの値をコード・コメント・ログ・成果物・スクリーンショット・スナップショットに残さない。** 設定・コードには環境変数名だけを置き、値は復唱しない

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を**直接読む**（転記しない）。スキーマの正本は `replace-strategy` の `references/project-config.md`。本スキルが読む・書くキー:

| キー | 用途 |
|---|---|
| `parity_suite_dir` | パリティスイートの配置（未指定時 `e2e/`） |
| `artifacts.{retention,storage,size_threshold_mb,overrides.<slug>}` | 大きなバイナリの保存先既定と機能ごとの上書き |
| `secrets.wrapper` | シークレットが要るコマンドの前置ラッパー |
| `targets` | 実行対象環境。`side: current` から `--target` で選ぶ。選択した target の `url`（`url_command` の target はコマンド実行で解決した URL）が UI、`api_url`（省略時はその UI URL）が API 特性化の baseURL。`pre_commands` / `start` / `check_urls` があれば実行フロー 1 で起動・稼働確認に使う |
| `targets[].auth.roles` | ロール別の認証情報の環境変数**名**（認証不要の環境では `auth` ごと省略。扱いは [`references/auth.md`](references/auth.md)） |
| `targets[].db.env_vars` | 現行 DB 接続の環境変数名。選択した current target のもの（DB を持たない環境では省略可）。本スキルは**読むだけ**で投入しないため `db.seedable` は見ない |
| `targets[].forbidden_actions` | 選択した target に実施しない UI / API 操作（空リスト・未定義の意味論は正本に従う） |
| `uses_storage` / `targets[].storage` | ファイルストレージの利用と、選択した current target の接続（`env_vars`）・書き込み範囲（`write_scope`）・アップロード経路（`upload_route`）。ファイル出力の捕捉・アップロードの特性化で**読む**（ゴールデンデータ投入はしないが、**テストがストレージへ直接書く・消す**〈後始末等〉場合の許可は `storage.seedable: true` ＋ `write_scope` 配下が前提。正本は [`references/data-discipline.md`](references/data-discipline.md)。アプリ経由のアップロードは `forbidden_actions` が律する）。`upload_route` が未宣言なら推測せずユーザーに確認し、`uses_storage: true` なのに宣言した target が無ければストレージ依存を `gaps.md` へ |
| `intentional_diffs` | 意図的差異レジストリ。故障カタログの導出（[`references/strength-gate.md`](references/strength-gate.md)）と、side 別期待値の根拠（[`references/locator-mapping.md`](references/locator-mapping.md)「期待値解決層」）で**読む**。書くのは `pending` への非破壊追記だけ（宣言に無い差を見つけたとき。`keep` / `may_change` は人間が確定させるため書かない。書き手区分の正本はスキーマ文書の「キーの書き手とライフサイクル」）。**追記元が分かる形で書く**——差異の文言は **`item`**（照合キー）、`slug` は対象 slug、`added_by: parity-suite`、`added_at` に追記日の 4 キー（`item` を別のキー名で書くと追記時は通り、数工程あとの `parity-diff` の棚卸しで「`item` が空」として現れる。要素の形の正本はスキーマ文書の「`pending` 要素の形」）。確定させる時期は `parity-diff` の収束判定が要求する棚卸し（同文書「`pending` の棚卸し」） |
| `current.origin` | 現行環境の由来（`managed` / `received-assets`。**キー欠落は `managed`**）。`received-assets` のときだけ、対象 slug の意味論が確定しているかを実行フロー 1 で確認する（意味論の正本はスキーマ文書の「現行環境の由来」） |
| `current.feedback_calls` | 移行元の利用者に見える副作用を出す呼び出しの一覧（パターン id・正規表現・種類）。反応の被覆表で移行元ソースと突き合わせるために**読む**。**キー欠落＝未確認**のときだけ、移行元ソースから候補を挙げてユーザーに確認し、確定した値を同キーへ 1 回記録する（意味論の正本はスキーマ文書の「フィードバック呼び出し」） |
| `references.db_semantics` | DB 意味論の差（並び順の特性化で読む）。**未整備（キー欠落・空値・解決できないパス）なら停止せず**、判断材料が無いまま推測せずに実測で特性化し、整備をユーザーに促す |
| `verification_commands` | 書いたスイート・マッピング層・操作アダプタに通す検証コマンド。**通すのは `full`（全体走査の列）**で、`diff`（変更ファイルだけの列）は使わない。**`full` が無くても、値がリスト（旧形式＝走る範囲が未宣言）でも停止せず**、その旨を `gaps.md` に記録して進む（`parity-replace` の完了判定と違い、ここでは生成物の品質担保であってスイートの合否判定ではない。スイートの合否は現側 green と強度ゲートが見る。意味論の正本はスキーマ文書の「検証コマンド」） |
| `references.coding_conventions` | スイート・マッピング層・操作アダプタを書くときに従うコーディング規約（**スイートは対象プロジェクト側のコード**であり、リポジトリの規約に従う。同梱ツールのコピーは修正しない規約のため対象外）。**未整備でも停止しないが、推測で自分の流儀を持ち込まない**——基底ドキュメント・リント設定・既存コードから読み取る（意味論の正本はスキーマ文書の「コーディング規約」） |
| `references.dependency_policy` | スイートに依存を足すときの方針（**三値**。意味論の正本はスキーマ文書の「依存導入の方針」）。**キー欠落＝未確認**のときだけ、ユーザーに要否を確認した結果を同キーへ非破壊追記する |

各キーの既定値・意味論の正本は上記スキーマ文書にある（ここへ転記しない。`parity_suite_dir` の既定だけは本スキルの受け入れ条件のため明記した）。

設定が無ければ `replace-strategy setup` を促して停止する。スキーマ文書の「移行」節に列挙された**旧キー**が残っていたら**フォールバックとして読まず**、同節を示して停止する
（**一律停止はキー名が変わった旧キーだけ**。`verification_commands` がリストなど「キー名が変わらない移行」は上表の挙動に従う）。

## 自律実行（`--autonomous`）

規約（宣言・越えない線・停止の 2 分類・保留の記録形・終わりにまとめて聞く手順）の**正本は `replace-strategy` の `references/autonomy.md`**（ここへ転記しない）。
**同ファイルを読めない場合は自律実行せず**、従来どおり確認のたびに止まる。本スキル固有の対応:

- **対象の選択**（`--feature` の省略・既定の無い `--target`）は保留にせず、候補を示して停止する（記録先が slug で決まるため。正本の「宣言」）
- **判断待ち（保留に落とす）**: `current.feedback_calls` の候補の確定（設定への記録は越えない線）、ファイルストレージの `upload_route` が未宣言のときの経路、
  後始末できない書き込み系特性化の実行可否（`references/data-discipline.md` の承認）、スイートへの依存の追加、フレームが環境の都合で別オリジンになっているときの `targets[].url` の変更（その頁の反応は記録しない）、`intentional_diffs.pending` へ追記した差異の確認
- **保留に落としても進める工程**: 読み取り系の特性化・ベースライン採取・保留に依存しない構成要素の強度検証。**保留に依存するスペック（例: 実行可否が保留の書き込み系）は書かず、`gaps.md` に判断待ちとして残す**（未検証を確認済みにしない）
- **記録先**: `.replace/parity/<slug>/pending-decisions.json`（テンプレート: [`assets/pending-decisions-template.json`](assets/pending-decisions-template.json)）。
  **`metadata.json` には書かない**——`parity-replace` / `parity-diff` はその存在を本スキル完了の前提に使うため、保留を残す目的でこのファイルを作ると後続が進む。
  未解決の保留が 1 件でも残る間は `parity-replace` への引き渡しを報告しない。保留が強度ゲートに依存する範囲へ及ぶなら `differ.validated_by_strength_gate` も `true` にしない

## 実行フロー

詳細は各 reference へ委譲する。番号順に進める。
**手順 5・6・7 の後はそれぞれ区切り（`authored` / `captured` / `gated`）で、達したら `scripts/checkpoint.mjs record` で記録する**——
`--until` が無くても記録する（止まった実行を新しい文脈から再開できるようにするため）。
**大きな JSON 成果物（`component-coverage.json`・`reactions.json`）は Write で本文ごと書かず、`scripts/table-upsert.mjs` で 1 行ずつ書く**
（書いた本文が文脈に積まれ続けるため。どちらも [`references/checkpoints.md`](references/checkpoints.md)）。

1. **前提検証と早期失敗**: `.replace/features.md`・設定が無ければ `replace-strategy setup` を促して停止。
   `.replace/dataset/metadata.json` が無ければ `golden-dataset`（フェーズ A）を促して停止。
   **setup とフェーズ A は、未解決の保留があれば証拠があっても未完了として同じく停止する**（見る保留の範囲の正本: `replace-strategy` の `references/autonomy.md`「下流の前提判定」。フェーズ B の別 slug・別 target の保留では止めない）。
   Playwright が使えない（Node が無い・導入不可）なら設計不成立を明示して停止。
   `--target` から現行環境を確定し（`url_command` の target はここで 1 回だけコマンドを実行して URL を解決する。失敗・空出力は停止し、以降は解決済みの値を再利用する）、
   その target を `check_urls`（省略時は `url`）で稼働判定し、落ちているときだけ `pre_commands` → `start` の順で起動して再確認する（稼働中なら `pre_commands` / `start` はどちらも実行しない。
   意味論と条件付き実行順の正本は `browser-test` の `references/project-config.md`。**最初の稼働判定が落ちていることは停止条件ではなく起動の合図**で、`pre_commands` / `start` / 起動後の再確認の失敗はそこで停止し、後続工程へ進まない）。
   選択した target の `url` / `api_url` への疎通と認証環境変数の存在確認（値は出さない）で早期に失敗する
2. **対象決定**: `slug` を features.md と突き合わせる（無い slug は停止。自分で採番しない）。種別からモードを決める。
   **`current.origin: received-assets` の場合はここでシナリオの確定可否を確認する**——`.replace/dataset/verification.md` の「意味論が未確定の機能」に対象 slug があるか、
   `.replace/bootstrap/semantics.md` の「確認待ち」または「確認したが確定できなかったもの」にその slug の必須意味論が残っていれば、**スイート構築へ進まず停止**し、
   不足している意味論・質問票の該当項目・回答が返るまで開始できないことを報告する（`managed`・キー欠落のプロジェクトでは本確認を行わない）。
   **この確認は設定ファイルと成果物だけで済むため、手順 1 の起動（`pre_commands` / `start`）より先に行う**——開始できない機能のために現行アプリを起動しない
3. **保存先検証**: `artifacts`（`overrides.<slug>` を考慮）の書き込み可否を**撮影前に**検証し、不可なら早期に失敗する（詳細: [`references/baseline.md`](references/baseline.md)）
4. **データセットの投入先・バージョン確認**: `.replace/dataset/metadata.json` の `current.target`（`golden-dataset` がフェーズ A で投入した current target 名）が手順 1 で確定した target と一致することを確認する。
   一致しなければ「ベースラインとシードの環境不一致」として停止し、同じ target へ投入するか target 選択を変えるようユーザーに促す。
   **`current.target` が `null` のときは照合しない**（`mode: static` ＝ ゴールデンデータがリポジトリ内の静的データで、特定の環境に紐づかないため。契約の正本は `replace-strategy` の `references/project-config.md`）。
   続けて `version` を読み、成果物に `dataset_version` として記録する。既存の `.replace/parity/<slug>/metadata.json` の `dataset_version` より後の
   `changes[].affects` と slug の実効参照テーブルを、`golden-dataset` の `references/versioning.md` に従って照合する。
   交差するときだけ陳腐化として再取得を宣言し、数値が古いだけなら再取得せず記録値も書き換えない。不正／欠落した変更履歴は全 slug に影響するものとして扱う
5. **authoring**: ロケータマッピング（現側）→ **期待値解決層**（side 別の期待値。現側の値だけを埋める）→ 操作差分の吸収 → スイート（表示＋操作・状態カバレッジ＋ドキュメントレベル要素＋**同じページに乗る他機能の在席**）→ 手書き aria（**セクション単位で複数枚**。部分一致は書いていない兄弟が在ることしか許容せず深さを飛ばせない）→ API 特性化。
   **状態網羅は部品の規範的な資料（コンポーネントカタログ・部品ベンダーの機能一覧）から導出し、部品インスタンス（部品 × ページ）ごとに測って被覆表 `component-coverage.json` に 3 値で残す**（feature モードのみ。[`references/coverage.md`](references/coverage.md)「状態網羅の導出源」）。
   **部品・インスタンス・軸の要素の 3 つの集合すべてに来歴と完全性を宣言する**（`component_inventory` / `instance_inventory` / `enumeration`）——
   **受領した現行ソースが読めるなら、そこから部品の配置を静的に列挙してから画面を開く**（実 UI の歩行はその画面がその時描いたものしか拾わず、本体の周りの部品が集合の側で落ちる）。
   一次情報源を使わなかったときは理由を書く（[`references/coverage.md`](references/coverage.md)「3 つの集合に来歴と完全性を要求する」）。
   **構成要素ごとに操作可否が設定される部品（データグリッド等）は、被覆プロファイルで候補集合を展開してから測る**——
   インスタンスごとに構成要素を来歴付きで列挙し、`node <skill>/scripts/coverage-expand.mjs --coverage <被覆表> --write` で候補と適合結果を書き戻し（**コピーせずスキル配下のスクリプトをそのまま実行する**。プロファイルはスクリプトの位置から解決するので実行時の cwd は問わない）、
   欠落・未列挙・証拠なし・対応付けなしが 0 件になるまで測定へ戻る（[`references/coverage-profiles.md`](references/coverage-profiles.md)）。
   **視覚採取を同値クラスで削減する場合も、E2E は全候補に要る**（削減してよいのはベースライン採取だけ）
   **被覆表が埋まったら、撮る前に撮影状態の必要集合を導く**——`value: present` のセルと項目の `visual_states`（プロファイル宣言済みなら `--write` が書き戻す）から
   **器を開く・指を乗せる・焦点を当てる・押している最中・不活性**の 5 種と**操作を終えた後に残る見た目**（`after-operation`）を `visual_state_coverage.rows` へ起こし、撮るなら `capture_conditions.states` の状態名、撮れないなら理由（`gaps.md` の「撮影状態の対象外」）を埋める。
   **この位置なのは、測った操作からしか導けず、かつ状態を後から足すと現行側もベースラインとノイズ基準値を採り直しになるため**（[`references/baseline.md`](references/baseline.md)「撮影状態の決め方（1）被覆表から導く」）
   **操作ごとに反応を「出るまで待ち、消えるまで測る」で観測し、反応の被覆表 `reactions.json` に残して assertion にする**（feature モードのみ）。
   **反応を記録する前に、対象ページの全フレームのオリジンが `targets[].url` のオリジンと同じかを測って `document_origins` に残す**——違えば、移行元が組み立てる絶対 URL で本来の配置を確かめ、
   本来も別オリジンなら根拠をその文書ごとに `cross_origin_evidence` へ書き、環境の都合なら記録せず停止して `targets[].url` を揃えるようユーザーに促す（別オリジンのフレームからは親の文書へ反応が届かず、実在する反応が `kind: none` に化ける）。
   移行元のフィードバック呼び出し（`current.feedback_calls`）を走査して記録と突き合わせる（照合スクリプトは `metadata.json` を読むので手順 8 で通す。[`references/coverage.md`](references/coverage.md)「操作の反応」）。
   **同じ表に、操作ごとに押した後に残る見た目（塗り・色・印・焦点）と戻り先（押す前後の URL・押す前に動かした状態のうち戻った範囲）を現行で測って `aftermath` に書く**——
   残る見た目は撮る状態か assertion に割り当て、どちらにもしないなら理由を書く。**戻す範囲は、画面が持つ状態を表の `screen_states` に棚卸しし、その全てを既定から動かしてから押して測る**
   （途中の見た目しか導かない撮影状態と、出て消える反応のどちらにも入らず、差が「差 0 件」と同じ見え方になるため。[`references/coverage.md`](references/coverage.md)「押した後に残るもの（`aftermath`）」）
   詳細: [`references/locator-mapping.md`](references/locator-mapping.md) / [`references/coverage.md`](references/coverage.md) / [`references/api-batch.md`](references/api-batch.md) / [`references/auth.md`](references/auth.md)。
   **スイート・マッピング層・操作アダプタは対象プロジェクト側のコードなので、そのリポジトリのコーディング規約（`references.coding_conventions`）に従って書く**
   （未整備でも停止しないが、推測で自分の流儀を持ち込まず基底ドキュメント・リント設定・既存コードから読み取る。解決順の正本は `replace-strategy` の `references/project-config.md`「コーディング規約」）。
   feature モードでは、authoring 後に `node <skill>/scripts/auto-wait-check.mjs <parity_suite_dir>/parity/` を実行し、走査対象が 1 件以上・待たない取得 API が 0 件・判定不能（`unresolved-receiver`）が 0 件になるまで修正する（スクリプトはコピーせずスキル配下から実行する）。
   **`ok:` 行が出す件数を読む**——走査ファイル数がスイートの実ファイル数と合っていること、判定不能が 0 件であることを確かめる（違反 0 件だけでは「検査が届いた」ことの証拠にならない）。
   **状態を変える工程（書き込み系スペック・ファイルアップロード・バッチ実行）は全モード共通で [`references/data-discipline.md`](references/data-discipline.md) の規律に従う**（復元 → 一意プレフィックス＋後始末 → 後始末できないなら承認を得て「hermetic でない」と明示）。
   **api-resource / batch モードは画面系工程（ロケータマッピング・手書き aria・状態遷移）を行わない**（[`references/api-batch.md`](references/api-batch.md) の該当モードに従う）。
   **API 特性化に入る前に、対象 slug の features.md で根拠が `推定` の口を拾い、record/replay で確定できた口は `replace-strategy evidence` へ委譲して書き戻す**——
   確定できなかった口は `推定` のまま残し、測るまで機能を閉じさせないものは手順 9 の `unmeasured` へ宣言する（**本スキルは features.md を自分では書かない**。[`references/api-batch.md`](references/api-batch.md)「要求単位を確定したら features.md へ書き戻す」）
6. **ベースライン採取とノイズ基準値測定**（feature モードのみ）: 現行アプリを駆動するついでに 3 点セットを採り、2 回撮ってノイズ基準値を出す（**2 回目の採取物は基準値を記録したら削除する**）。
   **続けて寸法の決まり方を測る**——`traits.elements` の全論理名を、撮影したビューポートを含み幅と高さを独立に動かした 4 窓以上で読む
   （`dimension/` の測定スペックを `PARITY_DIMENSION_CAPTURE=1` 付きで `current` に走らせ、`dimension-samples.json` を書く。手順 7 の強度ゲートなど他の実行では渡さず上書きさせない。当てはめは手順 8）。
   **あわせてスクロールバーを表示した窓のはみ出しを測る**——`overflow/` の測定スペックを `PARITY_OVERFLOW_CAPTURE=1` 付きで `current` に単独で走らせ、`capture_conditions.overflow` を書かせる（手で転記しない）。
   同じスペックは通常の実行でこの記録を期待値として現・新の両側に当てる。撮影時にスクロールバーが場所を取ったかは `capture_conditions.scrollbars` に書く（[`references/baseline.md`](references/baseline.md)「スクロールバーが場所を取る窓のはみ出し」）。
   撮影状態は**手順 5 で被覆表から導いた集合**（`visual_state_coverage.rows` の `captured`）を土台に、操作で開く器を再帰的に数えた `capture_conditions.popup_inventory` の撮る器と、
   操作から導けない状態（`error` / 初期表示のバリアント）と、反応の被覆表の `aftermath` で撮ると決めた状態を足して決め（導出も棚卸しも通常の状態一覧を置き換えない）、各状態は撮る対象の矩形が落ち着くまで待ってから撮る（2 回撮りの一致は待ちの代わりにならない）。詳細: [`references/baseline.md`](references/baseline.md)。
   **成果物を書き出す現側専用スペック（本手順と手順 7）は `current-only/` に置き、`new` プロジェクトから `testIgnore` で除外する**（除外しないと新側の実行が現側の証跡を静かに上書きする。配置と設定は [`references/locator-mapping.md`](references/locator-mapping.md)）。
   同じ設定で **`current` / `new` の両プロジェクトから `new-only/`（`parity-diff` が新側採取スペックを置く場所）も除外し、採取用の `new-capture` プロジェクトを用意する**（この時点では空でよい）。
   **撮る範囲は撮った組ごとに実測して `capture_conditions.capture_scope` に残す**——文書と撮影領域の寸法・内部スクロール器・撮影領域の外にある論理名を採り、
   穴（下が切れている・器の中が撮れていない・論理名が領域外）は範囲を広げて消すか `capture_scope_exemptions` に理由と `gaps.md` の該当箇所を書いて対象外にする。
   **既定は全画面（`full_page: true`）**で、ビューポート内で撮るのは全画面で撮れない理由があるときだけにする。
   **範囲の狭さは「差分 0 件」と同じ見え方になり、実装後に範囲外の差分が出てから現側ごと撮り直すことになる**（[`references/baseline.md`](references/baseline.md)「撮る範囲の決め方（穴は採取の段で数える）」）。
   api-resource / batch モードのベースラインは API 応答・出力（DB 状態・生成ファイル）の捕捉であり、視覚 3 点セットは採らない
7. **強度ゲート（故障注入）**: **無注入で全経路が緑になること（ポジティブコントロール）を同じ実行系で先に確認**したうえで、既知の回帰分類から故障カタログを導出し注入する。素通りした故障は強化するか `gaps.md` へ。詳細: [`references/strength-gate.md`](references/strength-gate.md)。
   **結果はこの手順の中で `strength.md` に書く**（区切り `gated` は `strength.md` が無いと記録できない。手順 8 へ持ち越すと、新しい文脈へ強度ゲートの結果が渡らない）
8. **成果物記録と完了報告**: スイートが**現に対して green** であることを確認し、設定の `verification_commands.full`（静的解析・型検査）をスイートに通す
   （**`full` が無くても、値がリスト〈旧形式＝走る範囲が未宣言〉でも停止せず** `gaps.md` に記録して進む。検証コマンドがスイートのパスを対象に含んでいない場合も、含まれていないことを記録して範囲を勝手に広げない）。
   そのうえで `gaps.md` / `metadata.json` を生成し、手順 7 で書いた `strength.md` を仕上げる。
   feature モードでは `component-coverage.json` も生成し、`metadata.json` の `component_coverage` に期待セル数と未測定数を宣言する（部品を使っていない・列挙を起こせない場合は `declared: false` ＋理由を書き、同じ理由を `gaps.md` にも残す）。
   **`declared: true` の被覆表は必ず `scripts/coverage-expand.mjs` を exit 0 まで通し、`conformance` に記録を残す**——プロファイルを宣言した部品が 1 つも無くても要る
   （`node <skill>/scripts/coverage-expand.mjs --coverage <被覆表> --metadata <metadata.json> --write`）。
   **`--metadata` を省かない**——省くと撮影状態を `capture_conditions.states` と照合しないまま `conformance.visual_states.checked: false` で通り、`parity-diff` が収束させない
   （撮影状態を確定した `metadata.json` を書いた後に通す）。
   feature モードでは `node <skill>/scripts/capture-scope-check.mjs --metadata <metadata.json>` も **exit 0 まで通す**
   （`noise_baseline` と `capture_scope` を突き合わせるため、ノイズ基準値と範囲の実測を書いた後に通す。`scrollbars` と `overflow` の記録もここで数える。コピーせずスキル配下から実行する）。
   穴が残るなら範囲を広げて採り直すか、`capture_scope_exemptions` に理由と `gaps.md` の該当箇所を書く（**exit 0 を作るために実測値を丸めない**）。
   `capture_conditions.dimension_model` は `node <skill>/scripts/dimension-fit.mjs fit --samples .replace/parity/<slug>/dimension-samples.json --metadata <metadata.json> --write` を exit 0 まで通して書かせる
   （`traits.elements` と `capture_conditions.viewports` を読むため、それらを書いた `metadata.json` の後に通す。手で転記しない。コピーせずスキル配下から実行する）。
   測れなかったときだけ `not_measured` と理由、ビューポートが 2 つ以上で測らないときだけ `not_required` と理由を書き、キーごと省略しない。
   同じく `metadata.json` の `reaction_coverage` を宣言し（操作を持たない機能だけ `declared: false` ＋理由。キーごと省略しない）、
   `reactions.json` を `node <skill>/scripts/reaction-check.mjs --metadata <metadata.json> --root <移行元ソースのルート> --write` で exit 0 まで通す
   （`capture` の状態名を `capture_conditions.states` と照合するため、撮影状態を確定した `metadata.json` を書いた後に通す。コピーせずスキル配下から実行する）。
   記録が無い・`ok: false` の被覆表は `parity-diff` が収束させない（`conformance` の欠落は旧成果物ではなく未実行として扱われる）。
   `metadata.json` には**選択した current target 名**と解決した URL を記録する（現側は 1 環境。既存 `metadata.json` と target 名が違えばベースライン陳腐化として再取得を宣言する）。
   データ不足があれば `golden-dataset` へ戻す案内をする
9. **採取物と工程の健全性の記録**: `metadata.json` に `artifact_health`（採取物ごとの読むスペックと「何から作ったか」）・
   `suite.state_mutating` / `suite.repeat_run`（状態を変えるスイートは 2 回続けて緑。各回に `suite_fingerprint` を記録し、
   **スイートを変えたら 2 回続けて回し直す**——記録を版に結びつけないと、後からスペックや後始末を変えても古い記録で通る。
   `repeat_run.specs` でスペックごとに分類すれば、2 回を求めるのは状態を変えるスペックだけになり、変えたスペックだけを回し直せば足りる。
   指紋は `artifact-health-check.mjs --fingerprint` の出力から写す）・
   `unmeasured`（未測定の機械可読な宣言）を書き、
   **視覚採取物を持たない機能（`api-resource` 等）でも `artifact_health.declared: false` ＋理由で済ませるのはこの節だけ**——
   `suite.state_mutating` は書き込み系こそ要る側なので必ず書く（書かないと未検証として落ちる）、
   `node <skill>/scripts/artifact-health-check.mjs --metadata <metadata.json> --stage suite` を **exit 0 まで通す**（コピーせずスキル配下から実行する）。
   **`--stage suite` を省かない**——既定は `diff`（`parity-diff` の収束判定）で、`unmeasured` の `disposition: blocking` を落とす。
   blocking は「測るまで**機能を閉じさせない**」記録であって**本スキルが書く出力そのもの**なので、本スキルの完了は止めない（受け取るのは `parity-diff` の収束判定）。
   `--stage suite` でも**記録の不備は落ちる**（`item` の空・重複・`reason` の空・語彙外の `disposition`・承認記録の無い `accepted`）——測定待ちと壊れた記録は別物。
   **exit 0 を作るために項目を消したり承認の無い `accepted` にしたりしない**（Issue #278 で塞いだ穴が戻る）。
   **採取物は工程の出力であり次の工程の入力**なので、読まれていない採取物・元が採り直されたのに古い加工物・後始末が効いていないスイート・
   測っていない項目は、どれも**緑のまま抜ける**（[`references/baseline.md`](references/baseline.md)「採取物の健全性」「状態を変えるスイートは 2 回続けて緑にする」、
   [`references/coverage.md`](references/coverage.md)「未測定を機械可読にする」）。
   **`unmeasured` へ写すのは `gaps.md` に残した未検証のうち「測るまで機能を閉じさせないもの」**で、`item` / `reason` は `gaps.md` の該当行と同じ文言にする。
   **測らないことをユーザーが承認したものだけ `accepted` にでき、`approved_by` / `approved_at` が要る**（承認記録が空なら `blocking` として数えられる）。
   **この手順は成果物を書いた後に置く**——検査は `metadata.json` の宣言と `baseline_dir` の実体・スペックの字面を突き合わせるため、両方が揃ってからでないと通せない

## 成果物

すべて対象プロジェクト側に置く。**スキーマの正本は本スキル**（テンプレート: [`assets/`](assets/)）。

| 成果物 | 場所 | 正本テンプレート |
|---|---|---|
| パリティスイート | `<parity_suite_dir>` | — |
| ロケータマッピング・期待値解決層・操作アダプタ | `<parity_suite_dir>` 配下（実際のパスは `metadata.json` に記録） | — |
| 強度レポート | `.replace/parity/<slug>/strength.md` | `assets/strength-template.md` |
| 未検証領域 | `.replace/parity/<slug>/gaps.md` | `assets/gaps-template.md` |
| 視覚ベースライン | `.replace/parity/<slug>/baseline/` | — |
| メタデータ・ノイズ基準値 | `.replace/parity/<slug>/metadata.json` | `assets/metadata-template.json` |
| 部品被覆表（feature モードのみ。**操作と状態の有無だけを数え、見た目は見ていない**） | `.replace/parity/<slug>/component-coverage.json` | `assets/component-coverage-template.json` |
| 寸法の採取値（feature モードのみ。窓 × 論理名の矩形） | `.replace/parity/<slug>/dimension-samples.json` | 形式の正本: [`scripts/dimension-fit.mjs`](scripts/dimension-fit.mjs)（手順は [`references/baseline.md`](references/baseline.md)） |
| 反応の被覆表（feature モードのみ。操作 → 反応） | `.replace/parity/<slug>/reactions.json` | `assets/reactions-template.json` |
| 依存の決定記録（スイートに依存を足したときのみ） | `.replace/dependencies.md` へ**非破壊追記**（無ければテンプレートから作成） | 様式の正本: `replace-strategy` の `assets/dependencies-template.md` |

- テキスト成果物（特性 JSON・aria・`metadata.json`・`strength.md`・`gaps.md`・`component-coverage.json`・`reactions.json`・`dimension-samples.json`）は Git。スクリーンショット等の大きなバイナリは `artifacts` 設定に従い、既定 `local`（コミットしない）
- **区切りの記録（`.replace/parity/<slug>/checkpoints.json`）も成果物ではない。** 同じ作業ツリーで再開するための作業記録で、指紋はコミットしない大きなバイナリも含むのでコミットしない
  （形式の正本: [`scripts/checkpoint.mjs`](scripts/checkpoint.mjs)）
- **ノイズ測定の 2 回目の採取物（`.replace/parity/<slug>/noise-pass2/`）は成果物ではない。** 基準値を `metadata.json.noise_baseline` へ記録したら削除し、コミットしない（テキストでも Git に入れない。正本: [`references/baseline.md`](references/baseline.md)）
- 決定論的ツールは正本を本スキルに同梱する（[`scripts/trait-capture.mjs`](scripts/trait-capture.mjs) / [`scripts/trait-compare.mjs`](scripts/trait-compare.mjs) / 要素単位の撮影を使う場合は [`scripts/element-shot.mjs`](scripts/element-shot.mjs)）。
  実行時はプロジェクト側 `<parity_suite_dir>/parity/lib/tools/vendor/`（既定）へコピーして使い、実際のパスを `metadata.json` に記録する。
  **コピーは修正しない規約のため、プロジェクト自作ツールとパスで分けられるコピー専用のサブディレクトリに置く**（配置指針は [`references/locator-mapping.md`](references/locator-mapping.md)）
- **被覆プロファイルと [`scripts/coverage-expand.mjs`](scripts/coverage-expand.mjs)・[`scripts/pixel-strict-count.mjs`](scripts/pixel-strict-count.mjs) はコピーしない。**
  スキル配下のスクリプトをそのまま実行する（`gh skill update` の自動更新を効かせる）。
  プロファイル（[`assets/coverage-profiles/`](assets/coverage-profiles/)）はスクリプトの位置から解決するので、
  実行時の cwd は問わない。照合結果は被覆表の `conformance` に残り、`parity-diff` はそれを読む
- **[`scripts/checkpoint.mjs`](scripts/checkpoint.mjs)・[`scripts/table-upsert.mjs`](scripts/table-upsert.mjs) もコピーしない。** 区切りの記録・照合と、大きな JSON 成果物の 1 行更新に使う（[`references/checkpoints.md`](references/checkpoints.md)）
- **[`scripts/reaction-check.mjs`](scripts/reaction-check.mjs) もコピーしない。** 照合結果は `reactions.json` の `conformance`（表の指紋付き）に残り、
  `parity-diff` はインストール済みの本スキルから同じスクリプトを `--recorded` で呼ぶ
- **[`scripts/dimension-fit.mjs`](scripts/dimension-fit.mjs) もコピーしない。** 本スキルは `fit` で式を `metadata.json` に書き、
  `parity-replace` はインストール済みの本スキルから同じスクリプトを `check` で呼んで新側を照合する
- **[`scripts/capture-scope-check.mjs`](scripts/capture-scope-check.mjs) もコピーしない。** 本スキルは手順 8 で撮る範囲の穴を数え、
  `parity-diff` はインストール済みの本スキルから同じスクリプトを呼んで収束判定に入れる（`capture_conditions.capture_scope` と `noise_baseline` の突き合わせ）
- **[`scripts/component-comparison-check.mjs`](scripts/component-comparison-check.mjs) もコピーしない。** 被覆表の 3 値は**移行元側の測定**なので、
  新側の突き合わせは `parity-replace` が `new/<target>/component-comparison.json`（様式の正本: [`assets/component-comparison-template.json`](assets/component-comparison-template.json)）へ書き、
  `parity-replace` と `parity-diff` がインストール済みの本スキルから同じスクリプトを呼ぶ
- **[`scripts/artifact-health-check.mjs`](scripts/artifact-health-check.mjs) もコピーしない。** 本スキルは手順 9 で `metadata.json` を検査し、
  `parity-diff` はインストール済みの本スキルから同じスクリプトを `--target` 付きで呼んで収束判定に入れる（採取物・反復実行・未測定・工程の成果物の 4 群）
- **[`scripts/component-impact.mjs`](scripts/component-impact.mjs) もコピーしない。** 共通部品の変更宣言から各機能の影響する撮影組を導く。
  `parity-diff` の部品改修の一括再検証（`parity-diff` の `references/component-change.md`）が呼び、鮮度検査も同じ判定を再計算する
- **[`scripts/evidence-carry.mjs`](scripts/evidence-carry.mjs) もコピーしない。** 新側のコミットが変わった後も差分の証跡を持ち越せるかを判定するライブラリで、
  `artifact-health-check.mjs` と `component-comparison-check.mjs` が import し、自身は `component-impact.mjs` を import する——**この 4 本は同じディレクトリに置いたまま**呼ぶ
  （持ち越しは両検査に `--new-repo` を渡したときだけ評価される。手順の正本は `parity-diff` の `references/component-change.md`）

## 姉妹スキルとの連携

- **`golden-dataset` との往復**: フェーズ A 完了が前提。探索でシード不足（空リストしか確認できない・ページネーションが 1 ページ等）を見つけたら `gaps.md` に「データ不足」として記録し `golden-dataset` へ戻す。戻るとバージョンが上がり、影響を受けるベースラインを再取得する
- **`parity-replace` へ引き渡すもの**: 論理名の契約（現・新をまたぐ）、現側 green のスイート、現側の値だけを埋めた期待値解決層（`metadata.json.suite.expectations`。新側の値の充填は `parity-replace`）、現側専用スペックの `testIgnore` 除外（`metadata.json.suite.current_only`）、
  寸法の決まり方（`metadata.json.capture_conditions.dimension_model` と `dimension/` の測定スペック。`not_measured` も引き渡し条件としてそのまま渡す）、
  スクロールバーを表示した窓のはみ出し（`metadata.json.capture_conditions.overflow` と、それを期待値として両側に当てる `overflow/` のスペック。頁ごとに 1 テスト）、
  部品被覆表と**新側の突き合わせの宿題**（3 値は移行元側の測定なので、`value: present` のセルごとに新側で入口・当たり判定・完了を観測して
  `new/<target>/component-comparison.json` へ書くのは `parity-replace`。様式の正本は本スキルの `assets/component-comparison-template.json`）、
  未実装機能の在席チェック（slug 付きでスキップ）、Playwright `projects` の `current` / `new` という名前と target 選択の仕組み
  （baseURL は環境変数から解決する。`side: new` の target 選択と `new` の baseURL 設定は `parity-replace` 段階）
- **`parity-diff` が再利用するもの**: 強度ゲートで健全性を確認済みの差分器（ツール・しきい値）、ノイズ基準値、
  撮影条件（**撮る範囲の実測 `capture_scope` を含む。本スキルの `capture-scope-check.mjs` で数え直す**。スクロールバーの扱い `scrollbars` は新側採取で同じにする）、部品被覆表（`metadata.json.component_coverage` が `declared: true` のときだけ収束判定に入る。
  プロファイルを宣言した部品では、`parity-diff` はプロファイルを読まず被覆表の `instances[].candidates` と `conformance` から数え直す）、
  反応の被覆表（`metadata.json.reaction_coverage` が `declared: true` のときだけ収束判定に入る。本スキルの `reaction-check.mjs --recorded` で数え直す）、
  新側専用スペックの置き場所・`current` / `new` からの `testIgnore` 除外・採取用の `new-capture` プロジェクト（`metadata.json.suite.new_only`。スペック本体は `parity-diff` が同梱雛形から置く）。すべて `metadata.json` 経由で引き渡す
- **`replace-strategy evidence` へ委譲するもの**: API 特性化で確定した口の「要求単位の根拠」の書き戻し（`推定` → `実測`）。
  **本スキルは `.replace/features.md` を書かない**ので、確定を観測した時点でこのモードを呼ぶ（[`references/api-batch.md`](references/api-batch.md)「要求単位を確定したら features.md へ書き戻す」）
- **`replace-strategy status`** が `strength.md` / `gaps.md` / `metadata.json` を読んで現況を導出する
