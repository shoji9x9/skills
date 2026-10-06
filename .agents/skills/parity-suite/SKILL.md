---
argument-hint: '[--feature <slug>] [--target <name>] [--autonomous] [--from <区切り>] [--until <区切り>]'
description: 仕様を変えないアプリケーションリプレイスで、新旧どちらの実装にも当てられる実行可能な合否判定基準（パリティスイート）を現行アプリに対して構築し、故障注入で強度を検証する replace-strategy の姉妹スキル。論理名のロケータマッピング層と手書きの寛容な aria スナップショットで Playwright スイートを書き、API を record/replay で特性化し、視覚ベースライン（スクリーンショット・computed style・参考 aria スナップショット）とノイズ基準値を採取して parity-diff へ引き渡す。1 回で 1 機能（横断 API リソース・バッチも可）。replace-strategy setup と golden-dataset の完了が前提で、未完了・Playwright 不可なら停止する。「パリティスイートを作って」「現行アプリを特性化して」「parity-suite」や --feature <slug> / --target <name>（対象環境）を伴う依頼で発動する。
license: MIT
name: parity-suite
---
# Parity Suite

`replace-strategy` の姉妹スキル。現行アプリに対してパリティスイートを作り、故障注入で強度を確かめるところまでを受け持つ。
パリティスイートは、新旧どちらの実装にも当てられる、実行できる合否の判定基準である。
新側には触れない。新側のマッピングを埋めるのは `parity-replace`、現・新の差分を検出するのは `parity-diff` である。
視覚ベースラインとノイズの基準値は、現行アプリを 1 回巡るついでに採り、`parity-diff` へ引き渡す。

## 使い方

```text
parity-suite [--feature <slug>] [--target <name>] [--autonomous] [--from <区切り>] [--until <区切り>]
```

- 1 回の実行で扱うのは 1 つの機能だけである。複数の機能を並行して進めない。調査・特性化・強度の検証が浅くなるためである
- `--autonomous` は、その実行だけを自律で進める宣言である（下の「自律実行」）。省いたときは、判断のたびに確認する
- `--until <区切り>` を渡すと、その区切りを記録したら止まって返る。`--from <区切り>` を渡すと、記録した区切りを照合してから、次の手順で再開する。
  区切りは `authored`（手順 5 の後）・`captured`（手順 6 の後）・`gated`（手順 7 の後）である。
  文脈を縮められない実行形態（subagent など）では、区切りごとに分けて進める。1 つの文脈で最後まで進めると、費用がターン数の 2 乗で増えるためである。
  再開の手順と、各区切りでそろう成果物は [`references/checkpoints.md`](references/checkpoints.md) で定義する
- `slug` は、`.replace/features.md` が採番したものを使う。自分で採番しない。省いたときは、features.md の未着手の機能から対話で選ぶ
- `--target <name>` は、実行する対象の現行環境である。設定の `targets` のうち、`side: current` のものだけを候補にする（このスキルが対象とする側は、ここで定義する）。
  省いたときのデフォルト・候補の示し方・存在しない名前や側の違いで止まることなどの選び方は、
  `replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う（ここへ転記しない）
- モードは slug の種別で決まる（フラグは無い）。features.md の 機能・横断 API リソース・バッチ のどの表にあるかで、次の表のモードになる

| モード | 起点 | 内容 |
|---|---|---|
| 機能（feature） | features.md の機能 | 画面駆動で、スイートとベースラインを採る。すべての構成要素を使う |
| 横断 API（api-resource） | features.md の横断 API リソース | 画面を伴わない、API だけの特性化。スイートは一度だけ書いて共有する |
| バッチ（batch） | features.md のバッチ | データセットと入力ファイルで現行のバッチを実行し、出力を現行のベースラインとして捕捉する |

- 次のような自然文でも発動する。「パリティスイートを作って」「現行アプリを特性化して」「この機能を強度検証して」

## 前提

- ツール: `git`、Node.js（Playwright の実行環境）。`gh` は要らない（このスキルは Issue を操作しない）
- 前提スキル: `replace-strategy`（`setup` が完了していること）、`golden-dataset`（フェーズ A が完了していること）
- 前提スキルがインストールされていない場合: `gh skill install shoji9x9/skills <name>` で導入してから実行する。
  設定のスキーマと成果物の様式は、`replace-strategy` の `references/` と `assets/` で定義する。そのため、このスキルだけでは動かない（同時に導入されていることを前提にする）
- MCP: 要らない（現行アプリは Playwright 自身が操作する）
- 対応する範囲（比べる範囲・確かめる範囲）の一覧は、`replace-strategy` の `references/scope.md` で定義する。
  このスキルは実行時の行動（`gaps.md` への記録・`golden-dataset` への差し戻し）を持ち、一覧は転記しない。
  一覧を読めない環境では、対象外と断定せず、`gaps.md` に未検証として残す
- Playwright（TypeScript）を前提にする。好みではなく、設計が Playwright に固有の機能に依存するためである。理由は 3 つある。
  - `toMatchAriaSnapshot` のデフォルトが部分一致であることを使って、「寛容なスナップショット」を手書きする
  - `getByRole` / `getByLabel` は、ARIA とセマンティクスから role とアクセシブルネームを解決する。そのため、マークアップが違っても、同じ記述が両方の実装に当たりうる
  - `projects` で、同じスイートを 2 つの baseURL（現・新）に対して実行できる。API の特性化も、`request` フィクスチャで同じ仕組みにそろえられる

  Playwright を使えないプロジェクトでは、このスキルの設計は成り立たない。その旨を明示して停止する（代わりのランナーでスイートを書かない）。

## 厳守の制約（禁止事項）

この節では、画素・特性照合・aria の 3 つの差分の検出を「3 つの比較方法」と呼ぶ。

- 仕様の確認は、十分な証拠が得られるいちばん安い方法から始める。
  調べる順は、実行ログ・観測記録 → 現行のソースコード → API の実際の動作 → UI の実際の動作である。
  実行ログ・観測記録は、選択した現行の target から取得し、対象の版・採った時点・条件を追跡できるものに限る。
  下位の証拠だけでは assertion にする挙動を確定できない場合に限って、次へ進む。
  調べる費用は、実行ログ・観測記録 < ソースコード < API の操作 < UI の操作の順に高くなるからである。
  必要な証拠が得られた時点で止め、API や UI の操作は、証拠が足りない場合だけ行う。
  設計書・仕様書・受領したログなどの受領資料は、調べる候補を抜き出すのに使ってよいが、現行の挙動を確定する根拠にはしない。
  UI の表示・操作を assertion にする箇所は、UI で確定する
- 採った aria スナップショットを assertion にしない（取って diff しない）。
  新旧の取得物を機械的に突き合わせると、新しい実装が正しくなったことによる差とノイズが混在し、意味のある信号にならない。
  assertion にするのは、仕様が保証する項目だけを手書きした寛容なスナップショットだけである（採ったものは参考資料にする）
- ページ全体を 1 枚の aria スナップショットにしない。
  部分一致が許すのは、書いていない兄弟の要素が在ることだけで、入れ子の深さは飛ばせず、順序も厳密に比べる。
  そのため 1 枚で書くと、現行の DOM の階層が取り決めに入り、新側が構造を改善しただけで赤くなる。
  セクション単位でアンカーする（[`references/coverage.md`](references/coverage.md)）
- 意図的差異レジストリに宣言の無い差を、side ごとの期待値で吸収しない。新側の不一致を、期待値の側で緑にすることになる。
  宣言に無い差は、`intentional_diffs.pending` へ回してユーザーに確認する
- タブ順の厳密な一致（止まる回数と順序の一致）を assertion にしない。
  仕様が保証するのは、到達できることと論理的な順序であり、止まる回数は実装の方式で変わりうる
- id / name を比較のアンカーにしない。原則は role とアクセシブルネームにする（自動生成の id は変わる対象である）
- 待たない取得 API の検査を省かない。feature モードでスイートを書いた後は、`node <skill>/scripts/auto-wait-check.mjs <parity_suite_dir>/parity/` を実行する。
  走査対象が 1 件以上・違反が 0 件・判定不能が 0 件になるまで、先へ進まない。
  禁止する API とその理由、判定不能を解消する手順は、[`references/locator-mapping.md`](references/locator-mapping.md) で定義する
- 強度の検証（故障注入）を省いて、「テストがあるから大丈夫」としない。テストがあること自体は、品質の証拠にならない
- 強度を、手書きの assertion だけで判定しない。手書きの assertion・ベースライン・差分ツールの一式で判定する
- 故障注入で緑になったことを、「スイートは強い」と宣言しない。
  カタログに無い故障は確かめる範囲の外であり、緑は反例が見つからなかったことを示すだけである
- 現行アプリのデータを破壊しない。選択した target の `forbidden_actions` に従う。
  書き込みを許さない target では、スイートの書き込み系のスペックを実行せず、「未検証」として `gaps.md` に記録する
- 意味論が確定していない機能で、スイートを書き始めない。
  `current.origin: received-assets` で、対象の slug に必須のデータの意味論が、`.replace/bootstrap/semantics.md` の
  「確認待ち」か「確認したが確定できなかったもの」に残っている間は、合否の判定基準を作れない（何が正解かが決まっていない）。
  推測でシナリオを埋めず、足りない情報を報告して停止する
- 同じ部品の 1 つのインスタンスで測った結果を、他のインスタンスの結果として使い回さない。
  部品は画面ごとに設定が違うので、あるページで無効な操作が、別のページでは有効なことがある。
  インスタンス（部品 × ページ）ごとに測り、`present` / `absent` / `unmeasured` の 3 値で網羅表に残す
  （[`references/coverage.md`](references/coverage.md)「部品網羅表」）
- 網羅表を、見た目を保証するものとして扱わない。数えるのは操作と状態の有無だけで、色・寸法・余白・書体は見ていない。
  機能がそろっていて見た目がすべて違う部品も、すべてのセルが `present` で埋まる。
  `unmeasured` が 0 件であることを、「見た目が現行と合っている」根拠にしない。
  見た目を受け持つのは画素の比較と特性の照合で、画面より先に作った共通部品では `parity-component` が受け持つ
  （[`references/coverage.md`](references/coverage.md)「網羅表は見た目を見ていない」）
- 測っていない部品の操作を、網羅表の空欄のままにしない。行が無い組み合わせと `evidence` の空欄は、`unmeasured` として数える（判定できないものは未測定として扱う）。
  `metadata.json` の `component_coverage` は、キーごと省かない。
  キーが無いことは古い成果物という意味になり、`parity-diff` が後方互換のために判定を飛ばす処理に、測らなかった事実が紛れ込む
- 操作の特性化を、押した直後の状態で止めない。
  反応は、遅れて出る・操作したコンテナの外（親の文書・別のフレーム）に出る・自動で消えるので、直後のスナップショットでは取りこぼす。
  操作ごとに、反応の欄を反応の網羅表 `reactions.json` に持たせる（反応が無ければ、`kind: none` を実測して書く）。
  出るまで待ち、消えるまでの時間を 2 回以上測って assertion にする。
  そのうえで、移行元のソースのフィードバックの呼び出しと、`scripts/reaction-check.mjs` で突き合わせる（[`references/coverage.md`](references/coverage.md)「操作の反応」）
- 観点を洗い出す起点を、画面の処理と部品へ渡す引数で止めない。操作が最後に呼ぶ送信・実行の関数まで、部品の内側を読む。
  送る前の判定（件数・長さ・大きさの上限、必須・形式の検証）は、境界の両側（上限ちょうど・1 つ超え、など）で現行に当てて、`pre_send` に残す。
  表への書き込み（監査・利用ログなど）は、例外処理の中も含めて移行元のソースからすべて列挙し、`side_effect_writes` に残す。
  どちらも、利用者に見える反応にも 3 つの比較方法にも現れず、ふだんの操作では両側で緑になる
  （[`references/coverage.md`](references/coverage.md)「送る前の判定（`pre_send`）」「表への書き込み（`side_effect_writes`）」）
- 状態の表示と、送っている間の押し直しを、文章で書いた観点だけで済ませない。
  画面ごとに、0 件・取得の失敗・読み込み中・トースト・ダイアログを、現行で「ある／ない」に振り分けて `state_displays` に残す。
  送る操作ごとに、応答を保留して押し直したときの、送った回数・確認の回数・覆いを `resubmit` に残す。
  取得の失敗と読み込み中は、「起こせない」と書く前に、要求の横取り（`page.route` の abort / fulfill / 応答の保留）で起こす。
  どちらもふだんの操作では入らない状態で、撮らなければ両側で緑になる
  （[`references/coverage.md`](references/coverage.md)「送っている間の押し直し（`resubmit`）」「画面ごとの状態表示（`state_displays`）」）
- 網羅表に載せる項目の粒度を、自分の判断で決めない。
  データグリッドのように構成要素ごとに操作の可否を設定する部品は、代表の列だけを測っても網羅表を満たせてしまう（登録しなかった列は、期待するセルにすら現れない）。
  同梱の網羅プロファイルで候補の集合を展開し、`scripts/coverage-expand.mjs` で網羅表と機械的に照合する（[`references/coverage-profiles.md`](references/coverage-profiles.md)）。
  合うプロファイルが無い複雑な部品は、暗黙に汎用の扱いにしない。`profile: null` と理由を書いて、未検証として残す
- 視覚の採取を同値クラスで減らすとき、代表以外の候補を成果物から消さない。
  減らしてよいのは視覚ベースラインの採取だけで、E2E はすべての候補に要る（機能が組み込まれていることは、候補ごとに確かめる）。
  減らすなら、`equivalence_classes` に分類の根拠と、すべての候補の所属を残す。
  クラスを 1 つでも宣言したら、どのクラスにも属さない候補が 1 件でもあれば失敗する。
  根拠は「現行アプリで実際に同じ描画になることを確かめた手順」で、「見た目が同じそう」は根拠にしない
  （[`references/coverage-profiles.md`](references/coverage-profiles.md)「視覚採取の同値クラス」）
- ブラウザで確かめていない挙動を、「確認済み」と記録しない。未検証のものは、理由を付けて `gaps.md` に残す。
  ファイルのアップロードも同じである。`setInputFiles` で流せることは、その画面で通ったことの証拠にならない（操作できることと、特性化したことを混同しない）
- バイト列に到達できない出力を、「対象」として扱わない。ダウンロードが起きない出力と、出力ディレクトリに到達できない出力は、`gaps.md` に未検証として残す。
  取得の方法と形式ごとの扱いは、`replace-strategy` の `references/file-io.md` で定義する。xlsx は揮発する項目を含むので、バイトの一致を取らない
- side 専用のスペックを、相手側の project の実行対象に残さない。`testIgnore` で両向きに除外する。
  現側専用（ベースラインの採取・ノイズの測定・強度チェック）を `new` に残すと、新側の実行が現側の証跡を警告なしに上書きする。
  `parity-diff` が後で置く新側専用（`new-only/`）を `current` に残すと、現行アプリの画面が新側のベースラインとして書き出され、差分が 0 件と誤って判定される。
  新側専用は `new`（`parity-replace` の green の検証用）からも除外し、採取専用の `new-capture` プロジェクトで実行する。
  `new` に残すと、green の検証がテストを集める時点で失敗する
- 撮影したビューポートの 1 点で合うことを、「寸法が合う」として扱わない。
  3 つの比較方法はその点でしか比べないので、1 点で実測した px を並べた新側の版組でも、すべての比較が緑になる。
  feature モードでは、窓の大きさを変えて位置と寸法の式を読み、`metadata.json` の `capture_conditions.dimension_model` をキーごと省かない。
  ビューポートが 1 つなら、`measured` か、理由を付けた `not_measured` にする。
  未測定を `gaps.md` に書いて済ませない。`parity-replace` への引き渡しの条件として、`dimension_model` に残す
  （[`references/baseline.md`](references/baseline.md)「寸法の決まり方（窓への追従）」）
- スクロールバーを隠した撮影だけで、頁の高さの決め方（`height: 100%` と `100vh`）を保証しない。
  Playwright のヘッドレスの Chromium はスクロールバーを隠すので、横のスクロールバーが出る窓でもこの差は 0 になり、3 つの比較方法はすべて緑のまま通る。
  feature モードでは、次の 2 つをキーごと省かない。
  `capture_conditions.scrollbars`（撮影のときの扱い）と、`capture_conditions.overflow`（スクロールバーを表示し、頁の最小幅より狭い窓での縦・横のはみ出し）である。
  撮影のときの扱いのデフォルトは `shown` である（`--hide-scrollbars` を外して撮る）。
  隠すと、内部のスクロール領域のスクロールバーが場所を取って中身がはみ出す差と、横のバーが出るか出ないかの差も消える。
  `hidden` で撮るなら、`scrollbars_reason` に理由を書く。`shown` なら、撮ったバーの出どころを `scrollbar_environment` に書く。
  内部のスクロール領域には論理名を付けて、`traits.elements` に入れる
  （[`references/baseline.md`](references/baseline.md)「スクロールバーが場所を取る窓のはみ出し」「撮る範囲の決め方」）
- 採取した環境でだけ成り立つ一致を、「一致」として扱わない。
  総称ファミリーのフォントのフォールバックなどは、採取した環境では差分が 0 件になり、利用者の環境でだけ表示が食い違う。
  `viewer_environment` は、`一致: <確かめ方>` か `乖離: <内容と gaps.md の該当箇所>` の形で書き、「未確認」のまま完了させない（`capture-scope-check.mjs` が失敗にする）。
  確かめる方法は、target の `browser.cdp_url` で利用者の環境のブラウザへ接続して撮ることである
  （[`references/baseline.md`](references/baseline.md)「採取環境と利用者環境の乖離」）
- 表示を切り替える軸（ロケール・配色テーマなど）を数えずに、デフォルトの 1 つの値だけで撮らない。他の値での差は、スイートにも 3 つの比較方法にも現れない。
  同梱の候補の一覧をすべて「在る／無い」に振り分け、出所を付けて `capture_conditions.display_axes` に残す。
  デフォルト以外の値ごとに 1 軸ずつ振った変種を、すべてのページ × すべての状態で撮る。互いに影響する対だけを、理由を付けて掛け合わせる。
  値ごとに変わる文言・振る舞いは、期待値解決層に持たせる（[`references/baseline.md`](references/baseline.md)「表示を切り替える軸（掛け合わせずに撮る）」）
- 現行と一致していることを、安全性が保たれていることの代わりにしない。
  サーバーの設定が付ける防御のヘッダーは、画面にも API の定義にも現れず、新側が付けなくても両側で緑になる。
  `.replace/response-headers.json`（横断の応答ヘッダーの一覧）に載るヘッダーを、対象の slug の応答（API とページへの遷移）で assertion にする
  （[`references/api-batch.md`](references/api-batch.md)「応答ヘッダー」）。
  逆に、現行の弱点を「直す」と仕分けた行（`.replace/weaknesses.md`）に触れる振る舞いは、side で共通の期待値に固定しない
  （[`references/locator-mapping.md`](references/locator-mapping.md)「期待値解決層」）
- スイートに依存を足すときは、配布元の素性・ライセンス・メンテナンスの状況を確かめずに導入しない。既存のパッケージを探さずに、自前で実装し始めるのも同じである。
  判断の材料と工程は `replace-strategy` の `references/dependency-selection.md` で定義し、記録先は `.replace/dependencies.md` である
- シークレットの値を、コード・コメント・ログ・成果物・スクリーンショット・スナップショットに残さない。
  設定とコードには環境変数の名前だけを置き、値を繰り返し書かない

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を直接読む（転記しない）。
スキーマは `replace-strategy` の `references/project-config.md` で定義する（以下、スキーマ文書と呼ぶ）。このスキルが読み書きするキーは次のとおりである。

| キー | 用途 |
|---|---|
| `parity_suite_dir` | パリティスイートの置き場所（指定が無いときは `e2e/`） |
| `artifacts.{retention,storage,size_threshold_mb,overrides.<slug>}` | 大きなバイナリの保存先のデフォルトと、機能ごとの上書き |
| `secrets.wrapper` | シークレットが要るコマンドの前に付けるラッパー |
| `targets` | 実行する対象の環境。`side: current` のものから `--target` で選ぶ。選択した target の `url` が UI の baseURL になる（`url_command` の target では、コマンドを実行して解決した URL）。`api_url` が API の特性化の baseURL になる（省いたときは、その UI の URL）。`pre_commands` / `start` / `check_urls` があれば、実行フローの手順 1 で起動と稼働の確認に使う |
| `targets[].auth.roles` | ロールごとの認証情報の環境変数の名前（認証が要らない環境では `auth` ごと省く。扱いは [`references/auth.md`](references/auth.md)） |
| `targets[].db.env_vars` | 現行の DB に接続する環境変数の名前。選択した current の target のもの（DB を持たない環境では省いてよい）。このスキルは読むだけで投入しないので、`db.seedable` は見ない |
| `targets[].forbidden_actions` | 選択した target で行わない UI / API の操作（空のリストと未定義の意味は、スキーマ文書に従う） |
| `uses_storage` / `targets[].storage` | ファイルストレージを使うかと、選択した current の target の接続（`env_vars`）・書き込める範囲（`write_scope`）・アップロードの方法（`upload_route`）。ファイル出力の捕捉とアップロードの特性化で読む。ゴールデンデータの投入はしないが、テストがストレージへ直接書く・消す場合（後始末など）は、`storage.seedable: true` で、`write_scope` の下であることが前提になる（[`references/data-discipline.md`](references/data-discipline.md) で定義する）。アプリを通したアップロードの可否は、`forbidden_actions` で決まる。`upload_route` が宣言されていなければ、推測せずユーザーに確認する。`uses_storage: true` なのに宣言した target が無ければ、ストレージへの依存を `gaps.md` に書く |
| `intentional_diffs` | 意図的差異レジストリ。故障カタログを導くとき（[`references/strength-gate.md`](references/strength-gate.md)）と、side ごとの期待値の根拠（[`references/locator-mapping.md`](references/locator-mapping.md)「期待値解決層」）に読む。書くのは、`pending` への追記（既存の内容を変えない）だけで、宣言に無い差を見つけたときに書く。`keep` / `may_change` は人間が確定するので書かない（書き手の区分は、スキーマ文書の「キーの書き手とライフサイクル」で定義する）。追記した側が分かる形で書く。差異の文言は `item`（照合のキー）に、`slug` には対象の slug を、`added_by` には `parity-suite` を、`added_at` には追記した日を書く。`item` を別のキー名で書くと、追記のときは通り、数工程後の `parity-diff` の棚卸しで「`item` が空」として現れる（要素の形は、スキーマ文書の「`pending` 要素の形」で定義する）。確定させる時期は、`parity-diff` の収束の判定が求める棚卸しである（スキーマ文書の「`pending` の棚卸し」） |
| `current.origin` | 現行環境の由来（`managed` / `received-assets`。キーが無ければ `managed`）。`received-assets` のときだけ、対象の slug の意味論が確定しているかを、実行フローの手順 1 で確かめる（意味は、スキーマ文書の「現行環境の由来」で定義する） |
| `current.feedback_calls` | 移行元で、利用者に見える副作用を出す呼び出しの一覧（パターンの id・正規表現・種類）。反応の網羅表で移行元のソースと突き合わせるために読む。キーが無い（未確認の）ときだけ、移行元のソースから候補を挙げてユーザーに確認し、確定した値をこのキーへ 1 回記録する（意味は、スキーマ文書の「フィードバック呼び出し」で定義する） |
| `references.db_semantics` | DB の意味論の差（並び順の特性化で読む）。整っていない（キーが無い・値が空・パスを解決できない）ときは停止しない。判断の材料が無いまま推測せず、実測で特性化し、整えるようユーザーに促す |
| `verification_commands` | 書いたスイート・マッピング層・操作アダプタに通す検証コマンド。通すのは `full`（全体を走査する列）で、`diff`（変更したファイルだけの列）は使わない。`full` が無くても、値がリスト（古い形式で、実行する範囲が宣言されていない）でも停止せず、その旨を `gaps.md` に記録して進む。`parity-replace` の完了の判定と違い、ここでは生成物の品質を保つためのもので、スイートの合否の判定ではない。スイートの合否は、現側の green と強度チェックが見る（意味は、スキーマ文書の「検証コマンド」で定義する） |
| `references.coding_conventions` | スイート・マッピング層・操作アダプタを書くときに従うコーディング規約。スイートは対象のプロジェクトの側のコードなので、そのリポジトリの規約に従う。同梱のツールのコピーは修正しない取り決めなので、対象外である。整っていなくても停止しないが、推測で自分の流儀を持ち込まない。基底ドキュメント・リントの設定・既存のコードから読み取る（意味は、スキーマ文書の「コーディング規約」で定義する） |
| `references.dependency_policy` | スイートに依存を足すときの方針（3 つの値をとる。意味は、スキーマ文書の「依存導入の方針」で定義する）。キーが無い（未確認の）ときだけ、ユーザーに要否を確かめた結果を、このキーへ追記する（既存の内容を変えない） |

各キーのデフォルト値と意味は、スキーマ文書で定義する（ここへ転記しない）。`parity_suite_dir` のデフォルトだけは、このスキルの受け入れ条件なので書いた。

設定が無ければ、`replace-strategy setup` を促して停止する。
スキーマ文書の「移行」の節に挙げた古いキーが残っていたら、代わりに読むことはせず、その節を示して停止する。
一律に停止するのは、キーの名前が変わった古いキーだけである。`verification_commands` がリストの場合のように、キーの名前が変わらない移行は、上の表の振る舞いに従う。

## 自律実行（`--autonomous`）

取り決め（宣言・越えない線・停止の 2 つの分類・保留の記録の形・終わりにまとめて聞く手順）は、`replace-strategy` の `references/autonomy.md` で定義する（ここへ転記しない）。
`autonomy.md` を読めない場合は、自律で実行せず、確認のたびに止まる。このスキルに固有の対応は次のとおりである。

- 対象の選択（`--feature` を省いたとき・デフォルトの無い `--target`）は、保留にせず、候補を示して停止する。
  記録先が slug で決まるためである（`replace-strategy` の `references/autonomy.md`「宣言」）
- 判断を待つもの（保留にするもの）は、次のとおりである。
  - `current.feedback_calls` の候補の確定（設定への記録は越えない線である）
  - ファイルストレージの `upload_route` が宣言されていないときの方法
  - 後始末できない書き込み系の特性化を実行するか（`references/data-discipline.md` の承認）
  - スイートへの依存の追加
  - フレームが環境の都合で別のオリジンになっているときの、`targets[].url` の変更（その頁の反応は記録しない）
  - `intentional_diffs.pending` へ追記した差異の確認
- 保留にしても進める工程は、読み取り系の特性化・ベースラインの採取・保留に依存しない構成要素の強度の検証である。
  保留に依存するスペック（たとえば、実行するかが保留の書き込み系）は書かず、`gaps.md` に判断待ちとして残す（未検証を確認済みにしない）
- 記録先は `.replace/parity/<slug>/pending-decisions.json` である（テンプレートは [`assets/pending-decisions-template.json`](assets/pending-decisions-template.json)）。
  `metadata.json` には書かない。`parity-replace` / `parity-diff` は、`metadata.json` があることを、このスキルが完了した前提に使う。
  そのため、保留を残す目的でこのファイルを作ると、後続の工程が進んでしまう。
  未解決の保留が 1 件でも残る間は、`parity-replace` への引き渡しを報告しない。
  保留が強度チェックに依存する範囲に及ぶなら、`differ.validated_by_strength_gate` も `true` にしない

## 実行フロー

詳しい手順は、各 reference に任せる。番号の順に進める。
手順 5・6・7 の後はそれぞれ区切り（`authored` / `captured` / `gated`）で、達したら `scripts/checkpoint.mjs record` で記録する。
`--until` が無くても記録する。止まった実行を、新しい文脈から再開できるようにするためである。
大きな JSON 成果物（`component-coverage.json`・`reactions.json`）は、Write で本文ごと書かず、`scripts/table-upsert.mjs` で 1 行ずつ書く。
書いた本文が文脈に積まれ続けるためである。どちらも [`references/checkpoints.md`](references/checkpoints.md) で定義する。

### 1. 前提検証と早期失敗

- `.replace/features.md` か設定が無ければ、`replace-strategy setup` を促して停止する
- `.replace/dataset/metadata.json` が無ければ、`golden-dataset`（フェーズ A）を促して停止する
- setup とフェーズ A は、未解決の保留があれば、証拠があっても未完了として同じく停止する。
  見る保留の範囲は、`replace-strategy` の `references/autonomy.md`「下流の前提判定」で定義する。フェーズ B の別の slug・別の target の保留では止めない
- Playwright が使えない（Node が無い・導入できない）なら、設計が成り立たないことを明示して停止する
- `--target` から現行の環境を確定する。
  `url_command` の target は、ここで 1 回だけコマンドを実行して URL を解決する。失敗したときと出力が空のときは停止し、以降は解決した値を使い回す
- target が `browser.cdp_url` を持てば、`PARITY_CURRENT_CDP_URL` に解決し、その接続先へ届くことも確かめる
  （設定の方法は [`references/locator-mapping.md`](references/locator-mapping.md)「利用者環境のブラウザへ接続する」）
- その target が稼働しているかを、`check_urls`（省いたときは `url`）で判定する。止まっているときだけ、`pre_commands` → `start` の順で起動して確かめ直す。
  稼働中なら、`pre_commands` も `start` も実行しない。意味と、条件付きの実行の順は、`browser-test` の `references/project-config.md` で定義する。
  最初の稼働の判定で止まっていたことは、停止の条件ではなく、起動の合図である。
  `pre_commands` / `start` / 起動した後の確認が失敗したら、そこで停止し、後の工程へ進まない
- 選択した target の `url` / `api_url` に届くかと、認証の環境変数があるか（値は出さない）を確かめ、早めに失敗する

### 2. 対象決定

`slug` を features.md と突き合わせる（無い slug なら停止する。自分で採番しない）。種別からモードを決める。

`current.origin: received-assets` の場合は、ここでシナリオを確定できるかを確かめる。次のどちらかに当たれば、スイートの構築へ進まずに停止する。

- `.replace/dataset/verification.md` の「意味論が未確定の機能」に、対象の slug がある
- `.replace/bootstrap/semantics.md` の状態「確認待ち」か「確認したが確定できなかったもの」に、その slug に必須の意味論が残っている

停止したら、足りない意味論・質問票の該当する項目・回答が返るまで始められないことを報告する。
`managed` のプロジェクトと、キーが無いプロジェクトでは、この確認をしない。
この確認は設定ファイルと成果物だけで済むので、手順 1 の起動（`pre_commands` / `start`）より先に行う。始められない機能のために、現行アプリを起動しない。

### 3. 保存先検証

`artifacts`（`overrides.<slug>` を含めて）に書き込めるかを撮影の前に確かめ、書き込めなければ早めに失敗する（詳細は [`references/baseline.md`](references/baseline.md)）。

### 4. データセットの投入先・バージョン確認

`.replace/dataset/metadata.json` の `current.target` が、手順 1 で確定した target と一致することを確かめる。
`current.target` は、`golden-dataset` がフェーズ A で投入した current の target の名前である。
一致しなければ、「ベースラインとシードの環境不一致」として停止し、同じ target へ投入するか、target の選択を変えるようユーザーに促す。
`current.target` が `null` のときは照合しない。
`mode: static` は、ゴールデンデータがリポジトリの中の静的なデータで、特定の環境に結びつかないためである（取り決めは `replace-strategy` の `references/project-config.md` で定義する）。

続けて `version` を読み、成果物に `dataset_version` として記録する。
照合するのは、既存の `.replace/parity/<slug>/metadata.json` の `dataset_version` より後の `changes[].affects` と、slug が実際に参照するテーブルである。
照合の方法は、`golden-dataset` の `references/versioning.md` に従う。
交差するときだけ、古くなったとして再取得を宣言する。数値が古いだけなら再取得せず、記録した値も書き換えない。
変更履歴が不正か欠けていれば、すべての slug に影響するものとして扱う。

### 5. authoring

次の順に書く。ロケータマッピング（現側）→ 期待値解決層（side ごとの期待値。現側の値だけを埋める）→ 操作の差の吸収 → スイート → 手書きの aria → API の特性化。
スイートには、表示と操作・状態の網羅・ドキュメントレベルの要素・同じページに載る他の機能の在席を含める。
手書きの aria は、セクション単位で複数枚に分ける。部分一致が許すのは書いていない兄弟が在ることだけで、深さを飛ばせないためである。

- 状態の網羅は、部品の規範的な資料（コンポーネントカタログ・部品のベンダーの機能一覧）から導く。
  部品のインスタンス（部品 × ページ）ごとに測り、網羅表 `component-coverage.json` に 3 値で残す（feature モードだけ。[`references/coverage.md`](references/coverage.md)「状態網羅の導出源」）
- 部品・インスタンス・軸の要素の 3 つの集合すべてに、出所と完全性を宣言する（`component_inventory` / `instance_inventory` / `enumeration`）。
  受領した現行のソースが読めるなら、そこから部品の配置を静的に列挙してから画面を開く。
  実際の UI を歩くと、その画面がそのとき描いたものしか拾えず、本体の周りの部品が集合から抜ける。
  一次情報を使わなかったときは、理由を書く
  （[`references/coverage.md`](references/coverage.md)「3 つの集合に出所と完全性を要求する」）
- 構成要素ごとに操作の可否を設定する部品（データグリッドなど）は、網羅プロファイルで候補の集合を展開してから測る。
  インスタンスごとに構成要素を出所付きで列挙し、`node <skill>/scripts/coverage-expand.mjs --coverage <網羅表> --write` で、候補と照合の結果を書き戻す。
  スクリプトはコピーせず、スキルの中のものをそのまま実行する。プロファイルはスクリプトの位置から解決するので、実行するときの cwd は問わない。
  欠落・未列挙・証拠なし・対応付けなしが 0 件になるまで、測定に戻る（[`references/coverage-profiles.md`](references/coverage-profiles.md)）。
  視覚の採取を同値クラスで減らす場合も、E2E はすべての候補に要る（減らしてよいのはベースラインの採取だけ）
- 網羅表が埋まったら、撮る前に、撮影状態の必要な集合を導く。
  `value: present` のセルと、項目の `visual_states`（プロファイルで宣言したものは `--write` が書き戻す）から、次のものを `visual_state_coverage.rows` に起こす。
  コンテナを開く（`opens-container`）・ホバー（`hover`）・フォーカス（`focus`）・押している最中（`active`）・不活性（`disabled`）の 5 種と、操作を終えた後に残る見た目（`after-operation`）である。
  撮るなら `capture_conditions.states` の状態の名前を、撮れないなら理由（`gaps.md` の「撮影状態の対象外」）を埋める。
  この位置で行うのは、測った操作からしか導けず、状態を後から足すと、現行の側もベースラインとノイズの基準値を採り直すことになるためである
  （[`references/baseline.md`](references/baseline.md)「撮影状態の決め方（1）網羅表から導く」）
- 操作ごとに、反応を「出るまで待ち、消えるまで測る」で観測し、反応の網羅表 `reactions.json` に残して assertion にする（feature モードだけ）。
  反応を記録する前に、対象のページのすべてのフレームのオリジンが、`targets[].url` のオリジンと同じかを測り、`document_origins` に残す。
  違えば、移行元が組み立てる絶対 URL で、本来の配置を確かめる。本来も別のオリジンなら、根拠を文書ごとに `cross_origin_evidence` へ書く。
  環境の都合で別のオリジンなら、記録せずに停止し、`targets[].url` をそろえるようユーザーに促す。
  別のオリジンのフレームからは親の文書へ反応が届かず、実在する反応が誤って `kind: none` と記録されるためである。
  移行元のフィードバックの呼び出し（`current.feedback_calls`）を走査して、記録と突き合わせる。
  照合スクリプトは `metadata.json` を読むので、手順 8 で通す（[`references/coverage.md`](references/coverage.md)「操作の反応」）
- 同じ表に、操作ごとに、押した後に残る見た目と戻り先を現行で測り、`aftermath` に書く。
  残る見た目は、塗り・色・印・フォーカスである。戻り先は、押す前後の URL と、押す前に動かした状態のうち戻った範囲である。
  残る見た目は、撮る状態か assertion に割り当てる。どちらにもしないなら、理由を書く。
  戻す範囲は、画面が持つ状態を表の `screen_states` に棚卸しし、そのすべてをデフォルトから動かしてから押して測る。
  途中の見た目しか導かない撮影状態にも、出て消える反応にも入らず、差が「差 0 件」と同じに見えるためである
  （[`references/coverage.md`](references/coverage.md)「押した後に残るもの（`aftermath`）」）
- 同じ表に、操作ごとに送る前の判定（`pre_send`）を書き、表の直下に表への書き込み（`side_effect_writes`）を書く。
  操作のハンドラから、部品の内側を送信・実行の直前まで読んで、判定を列挙する。
  判定ごとに境界の両側を現行で測り、assertion にする（ゴールデンデータが境界に届かないなら、代わりの作り方を記録する）。
  書き込みは、`.replace/features.md` の副作用の出力にある表について、移行元のソースを書き込みのパターンで走査して、すべて記録する。
  1 か所ずつ、値・時機・回数と、確かめ方（assertion か、読んだだけか）を書く
  （[`references/coverage.md`](references/coverage.md)「送る前の判定（`pre_send`）」「表への書き込み（`side_effect_writes`）」）
- 同じ表に、操作ごとに送っている間の押し直し（`resubmit`）を書き、表の直下に画面ごとの状態の表示（`state_displays`）を書く。
  送る操作は応答を保留して押し直し、送った回数・確認の回数・覆い（書き込む操作は書き込みの回数も）を測って assertion にする。
  状態の表示は、`capture_conditions.pages` のすべての画面で 5 つの候補を振り分ける。ある なら撮る状態か assertion に、ない なら何も出ないことを assertion にする。
  撮る状態に割り当てるなら、ベースラインを採る前に `capture_conditions.states` へ足す。後から足すと、現行の側を採り直すことになる
  （[`references/coverage.md`](references/coverage.md)「送っている間の押し直し（`resubmit`）」「画面ごとの状態表示（`state_displays`）」）
- 詳細は、[`references/locator-mapping.md`](references/locator-mapping.md) / [`references/coverage.md`](references/coverage.md) /
  [`references/api-batch.md`](references/api-batch.md) / [`references/auth.md`](references/auth.md) にある
- スイート・マッピング層・操作アダプタは対象のプロジェクトの側のコードなので、そのリポジトリのコーディング規約（`references.coding_conventions`）に従って書く。
  整っていなくても停止しないが、推測で自分の流儀を持ち込まず、基底ドキュメント・リントの設定・既存のコードから読み取る
  （解決の順は `replace-strategy` の `references/project-config.md`「コーディング規約」で定義する）
- feature モードでは、書いた後に `node <skill>/scripts/auto-wait-check.mjs <parity_suite_dir>/parity/` を実行する。
  走査対象が 1 件以上・待たない取得 API が 0 件・判定不能（`unresolved-receiver`）が 0 件になるまで直す（スクリプトはコピーせず、スキルの中から実行する）。
  `ok:` の行が出す件数を読む。走査したファイルの数がスイートの実際のファイルの数と合っていることと、判定不能が 0 件であることを確かめる。
  違反が 0 件なだけでは、検査が届いた証拠にならない。
  この検査は、commit したスイートが常に満たす条件である。工程の外で入った変更にも当たるように、プロジェクトの pre-commit と CI にも組み込む
  （起動の方法と、組み込める時期は [`checks.json`](checks.json)）
- 状態を変える工程（書き込み系のスペック・ファイルのアップロード・バッチの実行）は、すべてのモードで [`references/data-discipline.md`](references/data-discipline.md) の規律に従う。
  復元 → 一意のプレフィックスと後始末 → 後始末できないなら承認を得て「hermetic でない」と明示する、の順である
- api-resource / batch モードは、画面の工程（ロケータマッピング・手書きの aria・状態遷移）を行わない（[`references/api-batch.md`](references/api-batch.md) の該当するモードに従う）
- API の特性化に入る前に、対象の slug の features.md で根拠が `推定` の口を拾う。record/replay で確定できた口は、`replace-strategy evidence` に任せて書き戻す。
  確定できなかった口は `推定` のまま残し、測るまで機能を閉じさせないものは、手順 9 の `unmeasured` へ宣言する。
  このスキルは features.md を自分では書かない（[`references/api-batch.md`](references/api-batch.md)「要求単位を確定したら features.md へ書き戻す」）

### 6. ベースライン採取とノイズ基準値測定（feature モードのみ）

現行アプリを操作するついでに 3 点セットを採り、2 回撮ってノイズの基準値を出す。2 回目の採取物は、基準値を記録したら削除する。

- 続けて、寸法の決まり方を測る。`traits.elements` のすべての論理名を、撮影したビューポートを含み、幅と高さを別々に動かした 4 つ以上の窓で読む。
  `dimension/` の測定のスペックを `PARITY_DIMENSION_CAPTURE=1` を付けて `current` で実行し、`dimension-samples.json` を書く。
  手順 7 の強度チェックなど、他の実行ではこの変数を渡さず、上書きさせない。当てはめは手順 8 で行う
- あわせて、スクロールバーを表示した窓のはみ出しを測る。
  `overflow/` の測定のスペックを `PARITY_OVERFLOW_CAPTURE=1` を付けて `current` で単独で実行し、`capture_conditions.overflow` を書かせる（手で転記しない）。
  同じスペックは、ふだんの実行でこの記録を期待値として、現・新の両側に当てる。
  撮影のときにスクロールバーが場所を取ったかは、`capture_conditions.scrollbars` に書く（デフォルトは `shown`）。
  撮影・特性の採取・範囲の実測に使う `current` プロジェクトの `launchOptions` で、`--hide-scrollbars` を外す
  （[`references/baseline.md`](references/baseline.md)「スクロールバーが場所を取る窓のはみ出し」）
- 撮影状態は、次のものから決める。導いた集合も棚卸しも、ふだんの状態の一覧を置き換えない。
  - 手順 5 で網羅表から導いた集合（`visual_state_coverage.rows` の `captured`）を基にする
  - 操作で開くコンテナを再帰的に数えた `capture_conditions.popup_inventory` のうち、撮るコンテナを足す
  - 操作から導けない状態（`error` / 初期表示のバリアント）を足す
  - 反応の網羅表の `aftermath` で、撮ると決めた状態を足す
- 撮る前に、表示を切り替える軸を数えて `capture_conditions.display_axes` を書く。
  基準の組に加えて、デフォルト以外の値の変種も、同じページ × 状態で撮る。
  値は、操作アダプタの `applyDisplayAxes` で、基準の組にも明示して当てる
  （[`references/baseline.md`](references/baseline.md)「表示を切り替える軸（掛け合わせずに撮る）」）
- 各状態は、撮る対象の矩形が落ち着くまで待ってから撮る。2 回撮って一致することは、待つことの代わりにならない（詳細は [`references/baseline.md`](references/baseline.md)）
- 成果物を書き出す現側専用のスペック（この手順と手順 7）は、`current-only/` に置き、`new` プロジェクトから `testIgnore` で除外する。
  除外しないと、新側の実行が現側の証跡を警告なしに上書きする（置き場所と設定は [`references/locator-mapping.md`](references/locator-mapping.md)）。
  同じ設定で、`current` / `new` の両方のプロジェクトから `new-only/`（`parity-diff` が新側の採取のスペックを置く場所）も除外し、採取用の `new-capture` プロジェクトを用意する（この時点では空でよい）
- 撮る範囲は、撮った組ごとに実測して `capture_conditions.capture_scope` に残す。文書と撮影領域の寸法・内部のスクロール領域・撮影領域の外にある論理名を採る。
  抜け（下が切れている・スクロール領域の中が撮れていない・論理名が領域の外にある）は、範囲を広げて消す。
  消せないなら、`capture_scope_exemptions` に理由と `gaps.md` の該当する箇所を書いて、対象外にする。
  デフォルトは全画面（`full_page: true`）で、ビューポートの中で撮るのは、全画面で撮れない理由があるときだけにする。
  範囲が狭いことは「差分 0 件」と同じに見え、実装の後で範囲の外の差分が出てから、現側ごと撮り直すことになる
  （[`references/baseline.md`](references/baseline.md)「撮る範囲の決め方」）
- api-resource / batch モードのベースラインは、API の応答と出力（DB の状態・生成したファイル）の捕捉であり、視覚の 3 点セットは採らない

### 7. 強度チェック（故障注入）

注入しない状態で、すべての検出の方法が緑になること（ポジティブコントロール）を、同じ実行の仕組みで先に確かめる。
そのうえで、既知の回帰の分類から故障カタログを導いて注入する。
素通りした故障は、スイートを強めるか、`gaps.md` に書く。詳細は [`references/strength-gate.md`](references/strength-gate.md) にある。

結果は、この手順の中で `strength.md` に書く。区切り `gated` は、`strength.md` が無いと記録できない。
手順 8 へ持ち越すと、新しい文脈へ強度チェックの結果が渡らない。

### 8. 成果物記録と完了報告

- スイートが現側に対して green であることを確かめ、設定の `verification_commands.full`（静的解析・型検査）をスイートに通す。
  `full` が無くても、値がリスト（古い形式で、実行する範囲が宣言されていない）でも停止せず、`gaps.md` に記録して進む。
  検証コマンドがスイートのパスを対象に含んでいない場合も、含まれていないことを記録し、範囲を勝手に広げない
- そのうえで、`gaps.md` / `metadata.json` を作り、手順 7 で書いた `strength.md` を仕上げる
- feature モードでは `component-coverage.json` も作り、`metadata.json` の `component_coverage` に、期待するセルの数と未測定の数を宣言する。
  部品を使っていない場合と、列挙を起こせない場合は、`declared: false` と理由を書き、同じ理由を `gaps.md` にも残す
- `declared: true` の網羅表は、必ず `scripts/coverage-expand.mjs` を exit 0 まで通し、`conformance` に記録を残す。プロファイルを宣言した部品が 1 つも無くても要る。
  コマンドは `node <skill>/scripts/coverage-expand.mjs --coverage <網羅表> --metadata <metadata.json> --write` である。
  `--metadata` を省かない。省くと、撮影状態を `capture_conditions.states` と照合しないまま `conformance.visual_states.checked: false` で通り、`parity-diff` が収束させない。
  撮影状態を確定した `metadata.json` を書いた後に通す
- feature モードでは、`node <skill>/scripts/capture-scope-check.mjs --metadata <metadata.json>` も exit 0 まで通す（コピーせず、スキルの中から実行する）。
  `noise_baseline` と `capture_scope` を突き合わせるので、ノイズの基準値と範囲の実測を書いた後に通す。
  このスクリプトは、次のものもここで数える。
  - `scrollbars`（`hidden` の理由・`shown` の環境）と `overflow`
  - 内部のスクロール領域の `overflow_x` / `overflow_y` / `bar` と、`traits.elements` への採り忘れ（`untraced:<名前>` の抜け）
  - 表示の軸 `display_axes`（変種の撮り忘れは `#not-captured` の抜け）・`viewer_environment`・`browser` の記録

  抜けが残るなら、範囲を広げて採り直すか、`capture_scope_exemptions` に理由と `gaps.md` の該当する箇所を書く。exit 0 にするために、実測した値を丸めない
- `capture_conditions.dimension_model` は、次のコマンドを exit 0 まで通して書かせる。手で転記しない。コピーせず、スキルの中から実行する。

  ```bash
  node <skill>/scripts/dimension-fit.mjs fit --samples .replace/parity/<slug>/dimension-samples.json --metadata <metadata.json> --write
  ```

  `traits.elements` と `capture_conditions.viewports` を読むので、それらを書いた `metadata.json` の後に通す。
  測れなかったときだけ `not_measured` と理由を、ビューポートが 2 つ以上で測らないときだけ `not_required` と理由を書き、キーごと省かない
- 同じく、`metadata.json` の `reaction_coverage` を宣言する。キーごと省かない。
  操作を持たない画面駆動の機能も `declared: false` にせず、`operations: []` と理由の表で、画面ごとの状態の表示を振り分ける。
  `declared: false` と理由で済ませるのは、画面を持たない `api-resource` / `batch` だけである（書き方は [`references/coverage.md`](references/coverage.md)「照合と宣言」）
- `reaction-check.mjs` を通す前に、`covered_by` をテストに解決し、assertion が期待値まで届くかを監査する。
  テストの一覧は、`npx playwright test --list --reporter=json --project=current --project=new` の出力である。
  両側を `=` 付きで明示する。省くと `new-capture` の採取のスペックまで読み込まれ、採取用の環境変数が無いと一覧の取得が失敗する。
  `--audit-sheet` が出す期待値と、テストのソースの 2 つだけを、実装役とは別の subagent に渡す。
  「期待値のうち確かめていない部分はどこか」を 1 行ずつ問わせて、`assertion_audit` に記録する。
  届いていない行は、assertion を深くして監査し直す。1 本のテストを 2 行以上が名乗るなら、すべての行に `shared_assertion_reason` を書く。
  欄が埋まっているだけでは、期待値より浅い assertion を名乗っても、緑になって収束する
  （[`references/coverage.md`](references/coverage.md)「`covered_by` をテストへ解決し、assertion が期待値まで届くかを監査する」）
- 続けて、`reactions.json` を次のコマンドで exit 0 まで通す（コピーせず、スキルの中から実行する）。
  `capture` の状態の名前を `capture_conditions.states` と照合するので、撮影状態を確定した `metadata.json` を書いた後に通す。

  ```bash
  node <skill>/scripts/reaction-check.mjs --metadata <metadata.json> --root <移行元のソースのルート> --tests <テスト一覧> --write
  ```

- 記録が無い網羅表と `ok: false` の網羅表は、`parity-diff` が収束させない（`conformance` が無いことは、古い成果物ではなく未実行として扱われる）
- `metadata.json` には、選択した current の target の名前と、解決した URL を記録する。現側は 1 つの環境である。
  既存の `metadata.json` と target の名前が違えば、ベースラインが古くなったとして再取得を宣言する
- データが足りなければ、`golden-dataset` へ戻るよう案内する

### 9. 採取物と工程の健全性の記録

`metadata.json` に、次のものを書く。

- `artifact_health`（採取物ごとの、読むスペックと「何から作ったか」）
- `suite.state_mutating` / `suite.repeat_run`。状態を変えるスイートは、2 回続けて緑にし、各回に `suite_fingerprint` を記録する。
  スイートを変えたら、2 回続けて実行し直す。記録を版に結びつけないと、後でスペックや後始末を変えても、古い記録で通ってしまう。
  `repeat_run.specs` でスペックごとに分類すれば、2 回を求めるのは状態を変えるスペックだけになり、変えたスペックだけを実行し直せば足りる。
  指紋は、`artifact-health-check.mjs --fingerprint` の出力から転記する
- `unmeasured`（未測定の、機械で読める宣言）

視覚の採取物を持たない機能（`api-resource` など）で、`declared: false` と理由で済ませてよいのは `artifact_health` だけである。
`suite.state_mutating` は書き込み系の機能こそ要るので、必ず書く（書かないと、未検証として失敗する）。

書いたら、`node <skill>/scripts/artifact-health-check.mjs --metadata <metadata.json> --stage suite` を exit 0 まで通す（コピーせず、スキルの中から実行する）。

- `--stage suite` を省かない。デフォルトは `diff`（`parity-diff` の収束の判定）で、`unmeasured` の `disposition: blocking` を失敗にする。
  blocking は「測るまで機能を閉じさせない」記録で、このスキルが書く出力そのものなので、このスキルの完了は止めない（受け取るのは `parity-diff` の収束の判定である）
- `--stage suite` でも、記録の不備は失敗にする。不備は、`item` の空・重複、`reason` の空、語彙に無い `disposition`、承認の記録が無い `accepted` である。
  測定を待っていることと、不正な記録は別のものである
- exit 0 にするために、項目を消したり、承認の無い `accepted` にしたりしない。
  項目を消すと未測定を数えられなくなり、承認の無い `accepted` は、測らないと誰も決めていない項目を合格にする

採取物は工程の出力であり、次の工程の入力である。
読まれていない採取物・元を採り直したのに古いままの加工物・後始末が終わっていないスイート・測っていない項目は、どれも緑のまま通ってしまう
（[`references/baseline.md`](references/baseline.md)「採取物の健全性」「状態を変えるスイートは 2 回続けて緑にする」、
[`references/coverage.md`](references/coverage.md)「未測定を機械可読にする」）。

- `unmeasured` に転記するのは、`gaps.md` に残した未検証のうち、「測るまで機能を閉じさせないもの」である。`item` / `reason` は、`gaps.md` の該当する行と同じ文言にする
- 測らないことをユーザーが承認したものだけを `accepted` にでき、`approved_by` / `approved_at` が要る（承認の記録が空なら、`blocking` として数えられる）
- この手順は、成果物を書いた後に置く。検査は `metadata.json` の宣言と、`baseline_dir` の実体・スペックの字面を突き合わせるので、両方がそろってからでないと通せない

## 成果物

すべて対象のプロジェクトの側に置く。スキーマの原本はこのスキルにある（テンプレートは [`assets/`](assets/)）。

| 成果物 | 場所 | 原本のテンプレート |
|---|---|---|
| パリティスイート | `<parity_suite_dir>` | — |
| ロケータマッピング・期待値解決層・操作アダプタ | `<parity_suite_dir>` の下（実際のパスは `metadata.json` に記録する） | — |
| 強度レポート | `.replace/parity/<slug>/strength.md` | `assets/strength-template.md` |
| 未検証領域 | `.replace/parity/<slug>/gaps.md` | `assets/gaps-template.md` |
| 視覚ベースライン | `.replace/parity/<slug>/baseline/` | — |
| メタデータ・ノイズの基準値 | `.replace/parity/<slug>/metadata.json` | `assets/metadata-template.json` |
| 部品網羅表（feature モードだけ。操作と状態の有無だけを数え、見た目は見ていない） | `.replace/parity/<slug>/component-coverage.json` | `assets/component-coverage-template.json` |
| 寸法の採取値（feature モードだけ。窓 × 論理名の矩形） | `.replace/parity/<slug>/dimension-samples.json` | 形式は [`scripts/dimension-fit.mjs`](scripts/dimension-fit.mjs) で定義する（手順は [`references/baseline.md`](references/baseline.md)） |
| 反応の網羅表（feature モードだけ。操作 → 反応・送る前の判定・送っている間の押し直し、表への書き込み、画面ごとの状態の表示） | `.replace/parity/<slug>/reactions.json` | `assets/reactions-template.json` |
| 現行の弱点の追記（台帳に無い弱点に気づいたときだけ） | `.replace/weaknesses.md` へ、仕分けを空欄にした行を追記する（既存の内容を変えない。無ければテンプレートから作る） | 様式は `replace-strategy` の `assets/weaknesses-template.md` で定義する |
| 依存の決定の記録（スイートに依存を足したときだけ） | `.replace/dependencies.md` へ追記する（既存の内容を変えない。無ければテンプレートから作る） | 様式は `replace-strategy` の `assets/dependencies-template.md` で定義する |

- テキストの成果物（特性の JSON・aria・`metadata.json`・`strength.md`・`gaps.md`・`component-coverage.json`・`reactions.json`・`dimension-samples.json`）は Git に入れる。
  スクリーンショットなどの大きなバイナリは `artifacts` の設定に従い、デフォルトは `local`（commit しない）である
- `metadata.json` の `run.procedure_revision` には、採取した時点の [`assets/procedure-revisions.json`](assets/procedure-revisions.json) の `revision` を整数で書く（コピーせず、スキルの中から読む）。
  確かめる軸を足した改訂より前の成果物を、`replace-strategy status` が「旧手順で閉じた機能」として挙げる材料になる。
  すでに閉じた機能に 1 つの軸を当て直しただけでは、上げない。同じ改訂の他の軸まで当てたことになるためである。
  `run.finished_at` も同じく、特性化を全体でやり直したときだけ書き換える（ベースラインの再取得・一部の追記では、前の値を残す）。
  プロジェクトの側で足した軸の対象はこの日付で決まるので、新しい日付にすると、閉じた機能が警告なしに対象から外れる。
  当て直しは、`replace-strategy` の `references/procedure-changes.md` の台帳に記録する
- 区切りの記録（`.replace/parity/<slug>/checkpoints.json`）も成果物ではない。同じ作業ツリーで再開するための作業の記録である。
  指紋は commit しない大きなバイナリも含むので、commit しない（形式は [`scripts/checkpoint.mjs`](scripts/checkpoint.mjs) で定義する）
- ノイズの測定の 2 回目の採取物（`.replace/parity/<slug>/noise-pass2/`）は成果物ではない。
  基準値を `metadata.json.noise_baseline` に記録したら削除し、commit しない（テキストでも Git に入れない。手順は [`references/baseline.md`](references/baseline.md) で定義する）
- 決定論的なツールの原本は、このスキルに同梱する。
  [`scripts/trait-capture.mjs`](scripts/trait-capture.mjs) / [`scripts/trait-compare.mjs`](scripts/trait-compare.mjs) / 要素単位の撮影を使う場合は [`scripts/element-shot.mjs`](scripts/element-shot.mjs) /
  応答ヘッダーを録画する場合は [`scripts/header-normalize.mjs`](scripts/header-normalize.mjs) である。
  実行するときは、プロジェクトの側の `<parity_suite_dir>/parity/lib/tools/vendor/`（デフォルト）にコピーして使い、実際のパスを `metadata.json` に記録する。
  コピーは修正しない取り決めなので、プロジェクトが自作したツールとパスで分けられる、コピー専用のサブディレクトリに置く（置き方は [`references/locator-mapping.md`](references/locator-mapping.md)）
- 網羅プロファイルと、[`scripts/coverage-expand.mjs`](scripts/coverage-expand.mjs)・[`scripts/pixel-strict-count.mjs`](scripts/pixel-strict-count.mjs) は、コピーしない。
  スキルの中のスクリプトをそのまま実行する（`gh skill update` の自動更新を反映させるため）。
  プロファイル（[`assets/coverage-profiles/`](assets/coverage-profiles/)）はスクリプトの位置から解決するので、実行するときの cwd は問わない。
  照合の結果は網羅表の `conformance` に残り、`parity-diff` はそれを読む
- [`scripts/checkpoint.mjs`](scripts/checkpoint.mjs)・[`scripts/table-upsert.mjs`](scripts/table-upsert.mjs) もコピーしない。
  区切りの記録と照合、大きな JSON 成果物の 1 行の更新に使う（[`references/checkpoints.md`](references/checkpoints.md)）
- [`scripts/reaction-check.mjs`](scripts/reaction-check.mjs) もコピーしない。照合の結果は、`reactions.json` の `conformance`（表の指紋付き）に残る。
  `parity-diff` は、インストールしたこのスキルから、同じスクリプトを `--recorded` で呼ぶ。
  ページの path の解決（[`scripts/page-identity.mjs`](scripts/page-identity.mjs)）を import するので、同じディレクトリに置いたまま呼ぶ。
  `component_coverage.declared: true` なら部品網羅表も読み、撮る状態の使い回しを表をまたいで数えるので、`coverage-expand.mjs --write` の後に通す
- [`scripts/dimension-fit.mjs`](scripts/dimension-fit.mjs) もコピーしない。このスキルは `fit` で式を `metadata.json` に書く。
  `parity-replace` は、インストールしたこのスキルから同じスクリプトを `check` で呼んで、新側を照合する
- [`scripts/capture-scope-check.mjs`](scripts/capture-scope-check.mjs) もコピーしない。このスキルは手順 8 で撮る範囲の抜けを数える。
  `parity-diff` は、インストールしたこのスキルから同じスクリプトを呼んで、収束の判定に入れる（`capture_conditions.capture_scope` と `noise_baseline` の突き合わせ）
- [`scripts/component-comparison-check.mjs`](scripts/component-comparison-check.mjs) もコピーしない。網羅表の 3 値は、移行元の側の測定である。
  そのため、新側の突き合わせは `parity-replace` が `new/<target>/component-comparison.json` に書く（様式は [`assets/component-comparison-template.json`](assets/component-comparison-template.json) で定義する）。
  `parity-replace` と `parity-diff` が、インストールしたこのスキルから同じスクリプトを呼ぶ
- [`scripts/artifact-health-check.mjs`](scripts/artifact-health-check.mjs) もコピーしない。このスキルは手順 9 で `metadata.json` を検査する。
  `parity-diff` は、インストールしたこのスキルから同じスクリプトを `--target` を付けて呼び、収束の判定に入れる（採取物・反復の実行・未測定・工程の成果物の 4 群）
- [`scripts/component-impact.mjs`](scripts/component-impact.mjs) もコピーしない。共通部品の変更の宣言から、各機能の影響する撮影の組を導く。
  `parity-diff` の部品の改修の一括再検証（`parity-diff` の `references/component-change.md`）が呼び、鮮度の検査も同じ判定を計算し直す
- [`scripts/evidence-carry.mjs`](scripts/evidence-carry.mjs) もコピーしない。新側の commit が変わった後も、差分の証跡を持ち越せるかを判定するライブラリである。
  `artifact-health-check.mjs` と `component-comparison-check.mjs` が import し、このライブラリ自身は `component-impact.mjs` を import する。
  この 4 本は、同じディレクトリに置いたまま呼ぶ。
  持ち越しは、両方の検査に `--new-repo` を渡したときだけ評価される。
  記録と `replace-metadata.json` の版が一致している一括再検証の直後は、検証先の版を `--carry-to` で渡したときだけ評価される（手順は `parity-diff` の `references/component-change.md` で定義する）

## 姉妹スキルとの連携

- `golden-dataset` とは往復する。フェーズ A の完了が前提である。
  探索でシードの不足（空のリストしか確かめられない・ページネーションが 1 ページだけ、など）を見つけたら、`gaps.md` に「データ不足」として記録し、`golden-dataset` へ戻す。
  戻るとバージョンが上がるので、影響を受けるベースラインを再取得する
- `parity-replace` へは、次のものを引き渡す。
  - 論理名の取り決め（現・新をまたぐ）
  - 現側で green のスイート
  - 現側の値だけを埋めた期待値解決層（`metadata.json.suite.expectations`。新側の値を埋めるのは `parity-replace`）
  - 現側専用のスペックの、`testIgnore` による除外（`metadata.json.suite.current_only`）
  - 寸法の決まり方（`metadata.json.capture_conditions.dimension_model` と `dimension/` の測定のスペック。`not_measured` も引き渡しの条件としてそのまま渡す）
  - スクロールバーを表示した窓のはみ出し（`metadata.json.capture_conditions.overflow` と、それを期待値として両側に当てる `overflow/` のスペック。頁ごとに 1 テスト）
  - 部品網羅表と、新側で突き合わせる宿題。
    3 値は移行元の側の測定なので、`value: present` のセルごとに、新側で操作の起点・当たり判定・完了を観測して `new/<target>/component-comparison.json` に書くのは `parity-replace` である。
    様式は、このスキルの `assets/component-comparison-template.json` で定義する
  - 実装していない機能の在席のチェック（slug を付けてスキップする）
  - Playwright の `projects` の `current` / `new` という名前と、target を選ぶ仕組み。
    baseURL は環境変数から解決する。`side: new` の target の選択と、`new` の baseURL の設定は、`parity-replace` の段階で行う
- `parity-diff` は、次のものを使い回す。すべて `metadata.json` を通して引き渡す。
  - 強度チェックで健全なことを確かめた差分ツール（ツール・しきい値）
  - ノイズの基準値
  - 撮影条件。撮る範囲の実測 `capture_scope` を含み、このスキルの `capture-scope-check.mjs` で数え直す。
    スクロールバーの扱い `scrollbars`・表示の軸の値 `display_axes`・撮影に使ったブラウザ `browser` は、新側の採取でも同じにする
  - 部品網羅表。`metadata.json.component_coverage` が `declared: true` のときだけ、収束の判定に入る。
    プロファイルを宣言した部品では、`parity-diff` はプロファイルを読まず、網羅表の `instances[].candidates` と `conformance` から数え直す
  - 反応の網羅表。`metadata.json.reaction_coverage` が `declared: true` のときだけ、収束の判定に入る。
    このスキルの `reaction-check.mjs --tests <テスト一覧> --recorded` で数え直す（一覧は `npx playwright test --list --reporter=json --project=current --project=new` の出力）
  - 新側専用のスペックの置き場所・`current` / `new` からの `testIgnore` による除外・採取用の `new-capture` プロジェクト。
    `metadata.json.suite.new_only` に記録する。スペック本体は、`parity-diff` が同梱の雛形から置く
- `replace-strategy evidence` には、API の特性化で確定した口の「要求単位の根拠」の書き戻し（`推定` → `実測`）を任せる。
  このスキルは `.replace/features.md` を書かないので、確定を観測した時点でこのモードを呼ぶ
  （[`references/api-batch.md`](references/api-batch.md)「要求単位を確定したら features.md へ書き戻す」）
- `replace-strategy status` は、`strength.md` / `gaps.md` / `metadata.json` を読んで、今の状況を導く
