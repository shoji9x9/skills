---
name: parity-diff
description: 仕様を変えないアプリケーションリプレイスで、parity-suite が採取したベースライン・ノイズ基準値・強度チェックを通った差分ツールを使い、現行と新側の差分を決定論的ツールで検出して分類する replace-strategy の姉妹スキル。検出は画素・特性照合・aria の比較が担い、LLM には「差分があるか」を聞かず「この差分は重要か」だけを 1 件ずつ crop 対で聞いて要対応／許容／環境ノイズに分類する。新側環境は --target で選び成果物は環境別。要対応は parity-replace へ差し戻し、収束は未説明差分ゼロかつ未修正回帰ゼロ。1 回で 1 機能。replace-strategy setup・golden-dataset・対象 slug の parity-suite・parity-replace の新側 green が前提で、未完了なら捏造せず停止する。「現新の差分を検出して」「差分を分類して」「parity-diff」や --feature / --target を伴う依頼で発動する。
argument-hint: "[--feature <slug>] [--target <name>] [--remeasure-noise] [--component-change <change.json>] [--autonomous]"
license: MIT
---

# Parity Diff

`replace-strategy` の姉妹スキル。現行と新側の差分を決定論的なツールで検出し、モデルには分類だけを任せる。

- 検出は決定論的なツールが行い、モデルは分類だけを行う。モデルに「差分があるか」を聞かない（探させない）。ツールが検出した差分について、「この差分は重要か」だけを聞く。
- 見た目の 3 つの比較方法とは別に、初期表示の性能（LCP・CLS・TBT 相当・TTFB）を、`parity-suite` が採った分布とノイズの許容幅で比べる。許容幅を超えた悪化だけを要対応にする。
- `parity-replace` は、スイートが見ている範囲（新側に対して green か）を扱う。
  このスキルは、スイートでは捉えられない差分（余白・色・フォント・角丸・行間・罫線などの見た目）を扱う。
- 1 回の実行で扱うのは 1 機能で、ページ単位で処理する（部品の改修の一括再検証は除く）。
  このスキルは差分を修正しない。要対応の差分は `parity-replace` へ差し戻す。

## 使い方

```text
parity-diff [--feature <slug>] [--target <name>] [--remeasure-noise] [--autonomous]
parity-diff --component-change <change.json> [--target <name>] [--autonomous]
```

- 1 回の実行で扱うのは 1 機能である。複数の機能を並行して進めない。
  例外は下記の `--component-change` の一括再検証だけで、そこでも機能は 1 つずつ順に処理する。
- `slug` は `.replace/features.md` が採番したものを使い、自分では採番しない。省略したときは、features.md の未着手の機能から対話で選ぶ。
- `--target` は、差分を検出する新側の環境である（`skills.replace-strategy.targets` のうち `side: new` のもの）。
  このスキルが対象とする側は、ここで定義する。
  省略したときのデフォルト・候補の提示・存在しない名前や側の違いでの停止といった選択規則は、`replace-strategy` の `references/project-config.md`「実行対象環境」の「選択規則」に従う（ここへ転記しない）。
  成果物は環境ごとに分かれる（下記「成果物」）。
- `--remeasure-noise` は、新側の自己ノイズを全組で測り直す。
  デフォルトでは、前回の実行の測定値を組ごとに再利用する。
  再利用できるかどうかと失効の条件は、[`references/capture-new.md`](references/capture-new.md)「測定値の再利用」で定義する。
- モードは `.replace/parity/<slug>/metadata.json` の `mode`（feature / api-resource / batch）から読む。フラグは無く、features.md の表の位置から導き直さない。
- `--component-change` は、共通部品を後から直したときの一括再検証である。
  変更の宣言（`.replace/components/<slug>/changes/<change-id>.json`）から影響する機能と組を導き、影響する組だけを新側で撮り直して、ツールで判定する。
  現側は撮り直さない。手順・判定・持ち越しの記録は [`references/component-change.md`](references/component-change.md) で定義する。
- `--autonomous` は、その実行だけを自律で進める宣言である（下記「自律実行」）。省略したときは、判断のたびに確認する。
- 自然文でも発動する。「現新の差分を検出して」「差分を分類して」「この画面の差を見て」など。

| モード | 内容 |
|---|---|
| 機能（feature） | 画素・特性照合・aria の 3 つの比較方法で検出し、正規化 → トリアージ → 収束判定の順に進める。性能は別に比べる（[`references/detect.md`](references/detect.md)「性能の比較」） |
| 横断 API（api-resource） | 画面の 3 つの比較方法は使わない。現行の応答（record/replay）を正として、新側の応答を構造で比べる（[`references/api-batch.md`](references/api-batch.md)） |
| バッチ（batch） | 視覚の比較方法は使わない。現行のベースライン（DB の状態・生成ファイル）と新側の出力を、決定論的に構造とバイトで比べる（[`references/api-batch.md`](references/api-batch.md)） |

## 前提

前提が欠けていたら、成果物を作り出さずに停止し、足りないスキルを依存の順に案内する（検出の結果・成果物・ベースラインを作り出さない）。
前提があるかは、決まったパスを Read して判定する。

- ツール: `git`、Node.js。画素の検出は、記録済みの画素差分ツールの出力（差分画像）を読むので `pngjs` が要る（[`references/detect.md`](references/detect.md)）
- 前提スキル（依存の順）: `replace-strategy`（`setup` が完了）→ `golden-dataset`（フェーズ A・B）→ 対象の slug の `parity-suite`（完了）→ `parity-replace`（選択した target で新側が green）
- 前提スキルが未インストールの場合: `gh skill install shoji9x9/skills <name>` で入れてから実行する。
  このスキルは設定のスキーマと成果物の様式を、`replace-strategy` と `parity-suite` の `references/`・`assets/` で定義しているので、単体では動かない（同時に入っていることが前提である）。
- `issue-create`: 選択した target の `on_diff` のドキュメントが Issue の起票を指示する場合だけ要る（要対応の差分の起票を任せる）
- このスキルは現行アプリを動かさない。ノイズ基準値と視覚ベースラインの測定は `parity-suite` が行う。このスキルが撮るのは新側だけである。
- 判定の詳細は [`references/preflight.md`](references/preflight.md) にある。
  target の解決・起動・モードごとの要求・確かめるキーのフルパス・データセットの版の三者の整合・差分ツールの版の一致・反復の上限を扱う。

## 厳守の制約（禁止事項）

- 差分の調査は、十分な証拠を最も安く得られる方法から始める。原因は次の順に切り分ける。
  1. 選択した target から採取した差分の成果物・観測記録（前提の確認で、対象の版・採取の時点・条件が一致すると確かめたもの）
  2. 現行と新側のソースコード
  3. API の実際の動作
  4. UI の実際の動作

  下位の証拠だけでは分類できない場合に限って、次の段へ進む。調査のコストはこの順に高くなるので、必要な証拠が得られた時点で止める。API と UI の操作は、証拠が足りない場合だけ行う。
  設計書・仕様書・受け取ったログなどの受領資料は、調べる候補を挙げるのに使ってよいが、現行の挙動を確定する根拠にはしない。画面の差の観測条件は UI で確かめる。

- LLM に「差分があるか」を聞かない（検出させない）。検出は決定論的なツールが行い、モデルは分類だけを行う。
- モデルの「もう同じに見えます」を収束の根拠にしない。
- 全画面のスクリーンショットの対をモデルに渡して比べさせない。トリアージでは、差分領域の crop の対を 1 件ずつ渡す。
  スイートの外の依頼（「2 枚を見比べて違いを見つけて」など）にも、目視での検出を代わりに提供しない。決定論的なツール（画素の検出）に検出させてから、分類だけを行う。
  断るときは、正しい進め方を必ず添える。決定論的なツールに検出させ、差分領域の crop の対を 1 件ずつ見せて、要対応／許容／環境ノイズの 3 値に分類する進め方である。
- 現行と違う条件で新側を撮らない（環境の差を差分として報告しないため）。
- 失効の条件を確かめずに、自己ノイズの測定値を再利用しない。判断の材料が欠けていたら、再利用せずに測り直す（安全な側の扱い）。再利用しても、チェックの判定は毎回行う。
- カタログサイト（コンポーネントライブラリの見本）や部品ベンダーの機能一覧を、比較の正解にしない。どちらも状態を網羅して挙げるための材料で、正解は動いている現行アプリである。
- 画素を比べる VRT ツールで新旧を突き合わせない（実装が違えば全面が赤になり、意味が無い）。
- 差分をしきい値で消さない（特性照合という別の方法で捉える）。
- xlsx と PDF をバイトの一致で比べない（揮発する項目が入るので一致しない）。xlsx はシート × セルの値と構造で、PDF は抽出したテキストと構造で比べる。
  解析ツールは `metadata.json.differ.file_extract` に記録された値を使い、自分で選び直さない。
  現側と抽出ツールが変わると、差分がツールの差か実装の差かを切り分けられないからである（原本は `replace-strategy` の `references/file-io.md`）。
- テキストの幅や字形の差を、切り分けずに分類しない。「同じフォント名だから」という理由で、環境ノイズや許容にしない。
  差は版（`head.fontRevision`）とヒンティング命令の有無で決まるので、[`references/font-diff.md`](references/font-diff.md) の手順で切り分けてから分類する。
- コンポーネントの差分を、インスタンス単位の無視リストで吸収しない。クラスやトークンの単位の系統差 T（`component_diffs`）で宣言し、T から外れたものを検出する。
  ただし、画素の検出でしか出ない差（computed style は一致し、描画だけが違う）には T の照合キーが無く、`component_diffs` では吸収されない。
  その差を置ける場所は、インスタンス例外（`property: pixel`）だけである（レジストリごとにどの比較方法に使われるかは [`references/normalize.md`](references/normalize.md) で定義する）。
- インスタンス例外を設定ファイル（`.config/skills/shoji9x9/skills.yml`）へ書かない。
  slug の範囲の台帳なので、`.replace/parity/<slug>/component-diff-exceptions.json` に書く（古いキーが残っていたら、移行を案内して停止する）。
- 同じ原因の複数のインスタンスに、同じ `reason` を複製しない。原因は `component_diff_exception_causes[]` に 1 回だけ定義し、`cause` で参照する（インスタンスに `reason` を持たせない）。
- 例外のインスタンスの件数をまとめない。`page`・`element`・`bbox` にワイルドカードを置いて、1 つのエントリで N 箇所を吸収させない。
  例外の件数は検証の弱さを示すので、行数を減らすために隠さない。
- 同じ原因の候補について、承認を N 回求めない。分類は候補ごとに行い、承認は原因ごとに行う。
  `component_diff_exception_causes[]` の 1 つの原因につき承認を 1 回取り、同じ原因の N インスタンスはその承認で確定する。
  「件数をまとめない」は台帳の規則で、承認の単位の規則ではない（台帳のインスタンスは N 件のまま並べ、承認の UI にも件数 N と内訳を出す）。
- 承認済みの原因への参照を足して、未承認のインスタンスを吸収しない。承認の後にインスタンスが増えたら、増えた分の承認を 1 回取る。
  承認記録の累計 N と `cause` の参照の数が一致しなければ、超えた分は未承認（未説明）として数え、収束させない。
- 承認済みの例外の根拠を `gaps.md` に書かない。`gaps.md` は未検証の領域の台帳なので、そこに置くと承認済み（説明済み・許容）と未検証が混在する。書く先は `component-diff-exceptions.md` である。
- 承認の前の分類を、成果物に「許容」と書かない。承認の前は `許容候補（要確認）` と書き、収束判定では未説明として数える（分類がレポートに載った時点で、後の判断の入力になるため）。
- 観測条件を挙げずに仮説を検証しない。差分が出た条件（要素・サイズ・ウェイト・状態）で測る。手近な代表値 1 点の結果を、全体に広げない。
  比べる相手は常に現行で、新側の実験の変種どうしの一致を結論にしない。結論を成果物に書くときは測った条件も書く（条件を書けない結論は、未説明のまま残す）。
- 意図的差異の保留（`intentional_diffs.pending`）を棚卸ししないまま、機能を閉じない。
  この機能に帰属する保留・横断（`cross-cutting`）の保留・帰属不明の保留を人へ 1 件ずつ見せ、`keep` / `may_change` へ移す（移すのは人間）か、持ち越す理由を記録する。
  件数は `diff-metadata.json` の `intentional_diffs_pending` に残す。数え直しは [`scripts/pending-triage-check.mjs`](scripts/pending-triage-check.mjs) が行う。
  工程が確定の時期を決めないと、保留が機能をまたいで積み上がり、「まだ決まっていない差」と「決まったが記録が古い差」を区別できなくなる。判定は [`references/convergence.md`](references/convergence.md) で定義する。
- 部品網羅表に未測定が残る状態で、`converged: true` にしない。現側の `metadata.json` の `component_coverage.declared` が `true` なら、`scripts/coverage-check.mjs` で数え直す。
  未測定が 1 件以上なら `parity-suite` へ戻す。
  差分ツールは採取した状態しか見ないので、測っていない操作の欠落は差分ゼロとして通る。判定は [`references/convergence.md`](references/convergence.md) で定義する。
- 反応の網羅表に未測定が残る状態で、`converged: true` にしない。
  現側の `metadata.json` の `reaction_coverage.declared` が `true` なら、インストール済みの `parity-suite` の `scripts/reaction-check.mjs --tests <テスト一覧> --recorded` で数え直す。
  exit 0 以外なら `parity-suite` へ戻す。
  遅れて出る反応・別の文書に出る反応・自動で消える反応は、差分ツールの採取に記録されない。スクリプトが無ければ、判定を飛ばさずに停止する。判定は [`references/convergence.md`](references/convergence.md) で定義する。
- 網羅表の `present` を新側で突き合わせていない状態で、`converged: true` にしない。
  現側の `metadata.json` の `component_coverage.declared` が `true` なら、インストール済みの `parity-suite` の次のスクリプトで数え直す。
  `scripts/component-comparison-check.mjs --coverage <網羅表> --comparison <新側突き合わせ表>`
  `--metadata <現側 metadata.json> --replace-metadata <replace-metadata.json> --target <target>`。exit 0 以外なら `parity-replace` へ戻す。
  網羅表の 3 値は移行元の側の測定で、起点・当たり判定・完了のどこかで止まる欠落は示さない。判定は [`references/convergence.md`](references/convergence.md) で定義する。
- 撮る範囲に、宣言されていない抜けが残る状態で `converged: true` にしない。インストール済みの `parity-suite` の
  `scripts/capture-scope-check.mjs --metadata <現側 metadata.json>` で数え直し、exit 0 以外なら `parity-suite` へ戻す。
  撮影領域の外・内部のスクロール領域の中・領域の外に出た論理名は、差分ゼロとして通る。
  `capture_scope` を持たない現側の成果物は、後方互換として扱わず、範囲を実測して採り直す。判定は [`references/convergence.md`](references/convergence.md) で定義する。
- 採取物と工程の健全性に未検証が残る状態で、`converged: true` にしない。インストール済みの `parity-suite` の
  `scripts/artifact-health-check.mjs --metadata <現側 metadata.json> --target <target> --stage diff` で数え直し、exit 0 以外なら `parity-suite` へ戻す。
  次のものは、どれも緑のまま通ってしまう。読まれていない採取物、元が採り直されたのに古いままの加工物、後始末が機能していないスイート、`blocking` の未測定、
  `suite.new_green` が真なのに無いか古い `diff-metadata.json`。
  `converged` が偽でも失敗にはしない。失敗にするのは「無い」と「古い」だけである。スクリプトが無ければ、判定を飛ばさずに停止する。判定は [`references/convergence.md`](references/convergence.md) で定義する。
- 追記専用の成果物が縮んだ状態で、`converged: true` にしない。インストール済みの `replace-strategy` の
  `scripts/append-only-check.mjs --root . --base <機能に着手した時点の版>` で数え直し、exit 0 以外なら止めて、過去の決定を元に戻す。
  デフォルトの `HEAD` は使わない。書き直しを commit した後の `HEAD` は作業ツリーと同じなので、何かが失われていても通ってしまう。
  収束の判定は今の状態しか見ないので、積み上げた文書を丸ごと書き直しても、「なぜ許容したのか・いつ誰が承認したのか」が消えたまま通る。
  対象が 0 件のときは合格として扱わない。一覧は `replace-strategy` の `assets/append-only-manifest.json` で定義する。
- 網羅プロファイルを宣言した部品の期待セルを、項目 × インスタンスで数えない。宣言した部品では、インスタンスごとの候補（`instances[].candidates`）が期待セルである。
  挙げた要素が候補に現れない、または `conformance` が無いか `ok: false` なら、収束させない（プロファイルの本体は `parity-suite` の同梱物なので読まない）。
- 網羅表を判定しなかったことを、警告なしに合格にしない。`declared: false` と、`component_coverage` を持たない古い成果物は判定に入れない（後方互換）。
  ただし、判定しなかった事実と理由を `diff-metadata.json.component_coverage`（`judged: false`）と、`diff.md` の未検証の領域に残す。
- 他の機能が未実装であるために解消できない差分を、`converged: true` で通さず、`parity-replace` へも差し戻さない。
  `blocked_by` に帰属させて停止し、依存先の実装の後に再実行する（[`references/convergence.md`](references/convergence.md)）。
- 同じページに乗る別の機能（共同居住機能）の未実装の領域を、実行時のマスクより先に `blocked_by` に分類しない。新側で root が欠けているのは通常の状態である。
  現側のベースラインで測った target に依存しない `bbox` を両方の作業画像に当て、特性と aria の同じ領域も除いてから差分を検出する。
  `blocked_by` は、マスクの外に残った差分だけに使う。
- 性能の差を、単発の値やモデルの判断で決めない。新側を現側と同じ機械・同じブラウザ・同じ測り方で繰り返し測り、`parity-suite` の `scripts/perf-stats.mjs compare` で判定する。
  許容幅を超えた悪化は要対応にし、ばらつき・値の欠け・環境の違いで判定できない組は、合格にせず採り直す（[`references/detect.md`](references/detect.md)「性能の比較」）。
- 生の差分ゼロを収束の条件にしない。収束は、未説明の差分がゼロで、かつ未修正の回帰がゼロのことである。
- 名前の付かない要素の見た目の差を、「computed style で保証済み」として扱わない（特性照合は名前付きの要素しか見ない。名前の無い要素は画素の検出が担う）。
- セル・行・フィールドに論理名を付けて、テーブルやフォームを比べない（内容が同じかは aria の検出が担う）。
- 未検証の箇所を「確認済み」にしない（ベースラインに記録されない箇所と、宣言できない構造の差は、`diff.md` に未検証として残す）。
- 差分ツールやトリアージの補助に依存を足すときは、配布元の素性・ライセンス・メンテナンスの状況を確かめてから入れる（既存のパッケージを探さずに自前で実装し始めるのも同じく避ける）。
  判断の材料と工程は `replace-strategy` の `references/dependency-selection.md` で定義し、記録先は `.replace/dependencies.md` である。
- シークレットの値を、コード・コメント・ログ・成果物・スクリーンショットに残さない（環境変数の名前だけを扱い、値は繰り返さない。原本は `replace-strategy` の `references/project-config.md`「シークレットの扱い」）。

## プロジェクト設定の解決

設定ファイル `.config/skills/shoji9x9/skills.yml` の `skills.replace-strategy.*` を直接読む（転記しない）。
スキーマは `replace-strategy` の `references/project-config.md` で定義する。このスキルが読み書きするキーは次のとおりである。

| キー | 読/書 | 用途 |
|---|---|---|
| `targets[]`（`side: new`） | 読 | 差分を検出する環境。`--target` で選ぶ（選択規則は上記「使い方」で示した原本に従い、ここへ転記しない）。`url` / `api_url` は、新側の疎通・撮影先・api-resource モードの送信先に使う（`PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` として解決する。`url_command` の target はコマンドを実行して解決し、失敗や空の出力なら停止する）。`pre_commands` / `start` / `check_urls` は撮影の前の起動と稼働の確認に使う。`on_diff`（対応手順のドキュメントのパス）は、要対応の差分が残ったときの分岐に使う（手順 7）。投入対象でない target（`dataset_mode: db` で `db` が未定義、または `db.env_vars` はあるが `seedable` の無い読み取り専用のもの）にはゴールデンデータが入っていない。この場合は phase B との整合を免除する代わりに、データに依存する差分を「未検証」として `diff.md` に書く（[`references/preflight.md`](references/preflight.md)） |
| `intentional_diffs.{keep,may_change,pending}` | 読 | 意図的差異のレジストリ（正規化のノイズフィルタ）。`pending` に当たるものは除かずに要確認にする。`pending` は、収束判定での棚卸しの対象としても読む（対象は要素の `slug` で決める。書き換えるのは人間で、このスキルは書かない。要素の形はスキーマの文書の「`pending` 要素の形」で定義する） |
| `uses_storage` / `targets[].storage` | 読 | ファイルストレージを使うかと、選択した新側の target の接続（`env_vars`）・アップロードの方法（`upload_route`）。現側と `upload_route` が違う場合、保存先の path の命名規則の差は、宣言が無ければ「許容」にせず未説明として残す（`intentional_diffs` の対象）。ストレージの実体への投入は範囲外（原本は `replace-strategy` の `references/scope.md`）なので、事前の配置に依存する差分は「未検証」として `diff.md` に書く |
| `component_diffs` | 読 | コンポーネントの系統差 T（クラス・トークンの単位）。宣言するのは `parity-replace` である。T に合えば吸収し、外れれば回帰の候補にする。設定の側に残るのは `component` × `property` で、slug をまたいで使われる（`component` は対象の要素の論理名か glob。1 回の宣言が範囲内のすべてのインスタンスに当たる）。T で照合できないインスタンス例外は設定に置かず、slug の成果物に置く（下記「成果物」） |
| `artifacts.{storage,overrides.<slug>}` | 読 | 新側のベースラインの保存先のデフォルトと、機能ごとの上書き |
| `references.ui_library` | 読 | 旧 → 新の design token の対応表（系統差を正規化するときの判断の材料） |
| `references.db_semantics` | 読 | DB の意味の差（API の応答の並び順の差を判断する材料） |
| （上の 2 キーが未整備のとき） | — | キーの欠落・空の値・解決できないパスは、どれも未整備として扱う。停止はしないが、判断の材料が無いまま「許容」に寄せない。該当する候補は未説明のまま残し、`diff.md` に理由を書く |
| `references.dependency_policy` | 読・書 | 差分ツールやトリアージの補助に依存を足すときの方針（3 つの値をとる。意味はスキーマの文書の「依存導入の方針」で定義する）。書くのは、キーが無い（未確認の）ときだけである（ユーザーに要否を確かめた結果を、既存の内容を消さずに追記する） |
| `secrets.wrapper` | 読 | シークレットが要るコマンドの前に付けるラッパー |

設定と `.replace/features.md` が無ければ、`replace-strategy setup` を促して停止する。
古いスキーマや古いレイアウトは代わりに読まない。見つけたら、移行を案内して停止する。
検出の対象にする古いキー・古いレイアウトの一覧と移行の手順は、`replace-strategy` の `references/project-config.md`「移行」に従う（このスキルでは個別に挙げない）。

## 自律実行（`--autonomous`）

規約（宣言・越えない線・停止の 2 つの分類・保留の記録の形・終わりにまとめて聞く手順）は、`replace-strategy` の `references/autonomy.md` で定義する（ここへ転記しない）。
`replace-strategy` の `references/autonomy.md` を読めない場合は、自律実行せずに、確認のたびに止まる。このスキル固有の扱いは次のとおりである。

- 判断待ち（保留として記録する）にするもの
  - 「許容」の確定（原因の単位。`diff.md` の分類は `許容候補（要確認）` のままにする）
  - 意図的差異の保留の棚卸しの処置
  - 古い成果物を、ユーザーの承認による例外として続けるか
  - 差分ツールやフォント解析ツールを入れるか
  - `on_diff` のドキュメントが指示する起票（越えない線）
  - `references.dependency_policy` の確認
  - `commit_check` の無い配信型の target で、照合する相手の版がデプロイ済みかの確認。確認が取れるまで、その機能は撮らない（[`references/preflight.md`](references/preflight.md)「新側の版の一致」）
- 保留にしても進める工程
  - 要対応の差分の `parity-replace` への差し戻し（同じ `--autonomous` を引き継ぐ）
  - 他の候補のトリアージ、網羅表と反応の数え直し、`blocked_by` の検証、成果物の更新
- 棚卸しの処置を、自分で `carried_over` にしない。理由を記録すれば通る処置なので、自律で書くと人の判断を経ずに棚卸しが通ってしまう。
  未記録のまま残し（`pending-triage-check.mjs` が exit 1 で未棚卸しとして失敗にする）、保留に記録する。
- 記録先は、`diff-metadata.json` の `pending_decisions[]` と `run.autonomous`、`diff.md` の「判断待ち」の節である。
  未解決の保留が 1 件でも残る間は、`converged` を `true` にしない（収束の条件の 1 つ。[`references/convergence.md`](references/convergence.md)）。

## 実行フロー

詳細は各 reference に書いてある。番号の順に進める。

1. target の解決と前提の確認（[`references/preflight.md`](references/preflight.md)）。対象の target を決めてから、停止条件・データセットの版が古くなっていないか・差分ツールの版の一致・反復の上限を確かめる。
   選択した target の `new/<target>/replace-metadata.json` が無いか、`suite.new_green` でなければ、「その環境ではまだ green 証跡が無い」として停止し、同じ `--target` での `parity-replace` を案内する。
   green を取った版（`new.commit`。`--component-change` の一括再検証では変更の宣言の `commits.after`）が、撮る新側の版と違うときも、撮らずに同じく停止する。
   前提が欠けていれば、成果物を作り出さずに停止し、依存の順に案内する。
2. モードで分ける。`metadata.json.mode` で、feature（3 つの比較方法）/ api-resource / batch に分ける。api-resource と batch では、画面の 3 つの比較方法を使わない（[`references/api-batch.md`](references/api-batch.md)）。
3. 新側のベースラインを取得する（[`references/capture-new.md`](references/capture-new.md)）。
   選択した target の `url` / `api_url` を `PARITY_NEW_UI_URL` / `PARITY_NEW_API_URL` に解決して、Playwright の採取用のプロジェクトへ渡し、同じ条件で新側だけを撮る。
   採取用のプロジェクトの名前は `metadata.json.suite.new_only` に記録されている（デフォルトは `new-capture`）。
   採取のスペックは、現側のスペックから手で書き起こさない。同梱の雛形（[`assets/capture-new.spec.template.ts`](assets/capture-new.spec.template.ts)）を `metadata.json.suite.new_only` の場所へコピーして埋める。
   撮影の前に、`current` / `new` からの `testIgnore` の除外と、採取用のプロジェクト（デフォルトは `new-capture`）があることを確かめる。
   `url_command` の target では、手順 1 で解決した URL を使い回す（工程ごとに実行し直さない）。
   条件が一致するかを先に確かめ、一致しなければ差分を報告せずに停止する。
   新側の自己ノイズも測り、現側の `noise_baseline` との開きが大きければ停止する。
   行き来のループでは、前回の実行の測定値を組ごとに再利用してよい（失効の条件は同じ reference にある）。
   古い成果物をユーザーの承認による例外として続けた場合は対比せず、自己ノイズが 0 でない組を未検証にする。
   現側の `metadata.json` が `performance.declared: true` なら、`perf/` のスペックを `new` で実行して新側の性能も採る（同じ reference の「性能の採取」）。
   既存の新側のベースラインから再開する場合も、差分を検出する前に、同じ reference の「共同居住機能の実行時マスク」を必ず通す。
   ページの一覧と、同じ target の green 証跡から有効な集合を導き直し、現側に由来する `bbox` を両方の画像に当てる。新側に root が無いことを、停止の理由や `blocked_by` の根拠にしない。
   当てた詳細は `diff-metadata.json.capture_conditions_verified.cofeature_masks[]` に記録して報告する。恒久的なマスクの検証の結果である既存の `.masks` には混ぜない。
4. 決定論的に差分を検出する（[`references/detect.md`](references/detect.md)）。画素・特性照合・aria の 3 つの比較方法で検出し、LLM は使わない。
   性能は、インストール済みの `parity-suite` の `scripts/perf-stats.mjs compare --write <diff-metadata.json>` で比べる。許容幅を超えた悪化（`regressed`）は、トリアージを通さず要対応にする。
5. 正規化とノイズフィルタ（[`references/normalize.md`](references/normalize.md)）。
   `intentional_diffs` → `component_diffs`（T）→ インスタンス例外 → ノイズ基準値（残りへまとめて当てる）の順に当てる。宣言できない構造の差（`gaps.md`）は、未検証として転記する。
6. LLM でトリアージする（[`references/triage.md`](references/triage.md)）。正規化の後に残った候補だけを、1 件ずつ crop の対で見せる。
   モデルに聞くのは、要対応／許容／環境ノイズの 3 値である。どれとも判断できない候補は、未説明のまま残す（`diff.md` の分類の欄には未説明も並ぶ）。
   「許容」はユーザーの承認で確定し、承認は原因の単位で行う（同じ原因の N インスタンスを 1 回で確定する。代表のインスタンスの判断の材料と件数 N を UI に載せる）。
   テキストの幅や字形の差は、分類の前にフォントの差を切り分ける（版の差かヒンティングの差か。[`references/font-diff.md`](references/font-diff.md)）。
7. 収束を判定し、差し戻す（[`references/convergence.md`](references/convergence.md)）。判定するのは差分ツールである。状態は 4 つある（収束／他機能待ち／判断待ち／未収束）。
   収束の条件に入れるものと、数え直しに使うスクリプトは次のとおりである。
   - 部品網羅表の未測定。現側の `metadata.json.component_coverage` が `declared: true` のとき、[`scripts/coverage-check.mjs`](scripts/coverage-check.mjs) で数え直す（目視で数えない。判定しなかった場合は、理由を記録して未検証に残す）。
   - 反応の網羅表の未測定。現側の `metadata.json.reaction_coverage` が `declared: true` のとき、インストール済みの `parity-suite` の `scripts/reaction-check.mjs --tests <テスト一覧> --recorded` で数え直す。
     一覧は `npx playwright test --list --reporter=json --project=current --project=new` の出力である。
   - 意図的差異の保留の棚卸し。[`scripts/pending-triage-check.mjs`](scripts/pending-triage-check.mjs) で数え直す（対象が 0 件でも記録を省かない）。
   - 新側での突き合わせ（`present` のセルごとの起点・当たり判定・完了）。現側の `metadata.json.component_coverage` が `declared: true` のとき、インストール済みの `parity-suite` の `scripts/component-comparison-check.mjs` で数え直す。
   - 撮る範囲の抜け（撮影領域の外・内部のスクロール領域の中・領域の外に出た論理名・撮っていない表示の軸の値）と、採取の環境と利用者の環境が一致するかの未確認。
     インストール済みの `parity-suite` の `scripts/capture-scope-check.mjs` で数え直す。
   - 採取物と工程の健全性（採取物の読み手・加工物の新しさ・状態を変えるスイートの 2 回続けての緑・未測定の `blocking`・`suite.new_green` に対する `diff-metadata.json` の有無と新しさ）。
     インストール済みの `parity-suite` の `scripts/artifact-health-check.mjs --target <target> --stage diff` で数え直す。
     このチェックは、`diff-metadata.json` に結果を書いた後に通す。工程の節は、自分が書く成果物があるかを見るからである。`--stage suite` を渡すと、未測定の `blocking` を通してしまう。
   - 性能の比較（現側の `metadata.json.performance.declared` が `true` のとき）。`perf-stats.mjs compare` が exit 0 であること。回帰は差し戻し、判定できない組は採り直す。
   - 追記専用の成果物が縮んでいないこと。インストール済みの `replace-strategy` の `scripts/append-only-check.mjs` で数え直す（結果は `diff-metadata.json` の `artifact_health` / `append_only` に残す）。

   `converged: true` にしたら、`parity-replace` が `later`（`owner` がこのスキル）で残した受け入れ条件の行を再取得するよう、報告に書く。
   `issue-start <番号> --acceptance --out .replace/parity/<slug>/new/<target>/acceptance.json` で表を作り直す（`--allow-later` は渡さない）。
   収束の行を `met` にして `closable: true` になるまで、機能の Issue を閉じない（原本は `issue-start` の `references/acceptance.md`。このスキルは表を書かない）。

   他の機能が新側で未実装であることに由来する差分は、`blocked_by` に帰属させ、差し戻さずに停止してユーザーへ報告する（`converged` は false のまま）。
   要対応の差分が残れば、選択した target の `on_diff` のドキュメントに従う。ドキュメントが無ければ、`diff.md` を差し戻しの入力にして、同じ `--target` の `parity-replace` へ渡す。
   ドキュメントが「起票して停止する」運用を指示するなら、差し戻さずに差分の要約を `issue-create` に渡して起票し、停止する（修正のループを回さない）。
   反復の上限を超えていたら、差し戻さずに停止してユーザーへ上げる。

## 成果物

すべて対象のプロジェクトの側に置く。このスキルが原本として定義するテンプレート（[`assets/`](assets/)）がある。

| 成果物 | 場所 | 原本のテンプレート |
|---|---|---|
| 差分レポート | `.replace/parity/<slug>/new/<target>/diff.md` | [`assets/diff-template.md`](assets/diff-template.md) |
| メタデータ | `.replace/parity/<slug>/new/<target>/diff-metadata.json` | [`assets/diff-metadata-template.json`](assets/diff-metadata-template.json) |
| 新側のベースライン | `.replace/parity/<slug>/new/<target>/baseline-new/`（現側の `baseline/` と対称のレイアウト） | — |
| 新側の性能の採取値（現側が `performance.declared: true` のときだけ） | `.replace/parity/<slug>/new/<target>/perf-samples.json`（Git に入れる。比べた結果は `diff-metadata.json` の `performance`） | 採取のスペックは `parity-suite` が置いた `perf/`（`metadata.json` の `suite.perf`） |
| 新側の採取スペック | `metadata.json.suite.new_only` の場所（デフォルトは `<parity_suite_dir>/parity/<slug>/new-only/`。既にあれば上書きしない） | [`assets/capture-new.spec.template.ts`](assets/capture-new.spec.template.ts) |
| インスタンス例外のレジストリ | `.replace/parity/<slug>/component-diff-exceptions.json` に、既存の内容を消さずに追記する（無ければテンプレートから作る）。ユーザーが承認したものだけを書き、設定ファイルには置かない | [`assets/component-diff-exceptions-template.json`](assets/component-diff-exceptions-template.json)（スキーマ: [`references/normalize.md`](references/normalize.md)） |
| 承認済みの例外の根拠 | `.replace/parity/<slug>/component-diff-exceptions.md` に、既存の内容を消さずに追記する（無ければテンプレートから作る）。`component_diff_exception_causes[].evidence` が指す先で、`gaps.md` には書かない | [`assets/component-diff-exceptions-template.md`](assets/component-diff-exceptions-template.md) |
| 証跡の持ち越し（`--component-change` のときだけ。環境ごと） | `.replace/parity/<slug>/new/<target>/evidence-carry.json` に追記する（撮り直した組の判定の記録も、同じ `new/<target>/` の下に置く） | 様式の原本は `parity-suite` の `assets/evidence-carry-template.json`（手順: [`references/component-change.md`](references/component-change.md)） |
| 依存の決定の記録（差分ツールやトリアージの補助に依存を足したときだけ） | `.replace/dependencies.md` に、既存の内容を消さずに追記する（無ければテンプレートから作る） | 様式の原本は `replace-strategy` の `assets/dependencies-template.md` |

- 新側の成果物は環境ごとに置く（`new/<target>/` の下）。環境を切り替えても、他の環境の差分レポート・メタデータ・新側のベースラインを上書きしない。現側の `baseline/` は 1 つの環境だけで、slug の直下に置いたままにする。
- インスタンス例外のレジストリとその根拠は、環境に依存しないので slug の直下に置く（`gaps.md` / `porting.md` と同じ扱い）。
  特定の target でだけ出る差は、例外ではなく環境の差なので、ノイズ基準値と新側の自己ノイズで扱う。
- テキストの成果物（`diff.md`・`diff-metadata.json`・例外のレジストリとその根拠）は Git に入れる。
  新側のベースラインの大きなバイナリ（スクリーンショットなど）は `artifacts` の設定に従い、デフォルトは `local`（commit しない）である。テキスト（特性の JSON・aria）は Git に入れる。
- 自己ノイズの測定の 2 回目の採取物（`new/<target>/noise-pass2/`）と、撮影に使ったブラウザの同一性の記録（`new/<target>/browser-identity.<pass>.json`）は成果物ではない。
  測定値と指紋を `diff-metadata.json` に記録したら削除し、commit しない（テキストでも Git に入れない。原本は [`references/capture-new.md`](references/capture-new.md)）。
- このスキルに同梱した決定論的なツールは、プロジェクトへコピーせず、スキルのディレクトリの中から実行する（`gh skill update` で自動で更新されるようにするため）。
  対象は [`scripts/pixel-crops.mjs`](scripts/pixel-crops.mjs)・[`scripts/diff-normalize.mjs`](scripts/diff-normalize.mjs)・[`scripts/json-normalize-diff.mjs`](scripts/json-normalize-diff.mjs)・
  [`scripts/coverage-check.mjs`](scripts/coverage-check.mjs)・[`scripts/pending-triage-check.mjs`](scripts/pending-triage-check.mjs)・[`scripts/amend-verify.mjs`](scripts/amend-verify.mjs) である。
  性能の比較は、インストール済みの `parity-suite` の `scripts/perf-stats.mjs` を `compare` で呼ぶ（コピーしない）。
  特性照合と応答ヘッダーの正規化は、`parity-suite` で確定した取り決めに従い、プロジェクトの側のコピー（`trait-capture.mjs`・`trait-compare.mjs`・`header-normalize.mjs`）を使う。

## 姉妹スキルとの連携

- 依存の順: 全体の依存の順は、`replace-strategy` の `SKILL.md`「姉妹スキルと依存順」で定義する（ここへ転記しない）。
  このスキルの直前は、同じ target で新側を green にした `parity-replace` である（このスキルと行き来する）。
- `parity-suite` から受け取るものは次のとおりで、すべて `.replace/parity/<slug>/metadata.json` を通して受け取る。
  - 強度のチェックで健全なことを確かめた差分ツール（画素・特性照合・aria の 3 つの比較方法のツールとしきい値）、ノイズ基準値、撮影条件（ページの一覧とマスクの論理名を含む）
  - 部品網羅表。`component_coverage.declared: true` のとき `.replace/parity/<slug>/component-coverage.json` を読む。
    未測定が残れば、収束させずに `parity-suite` へ戻す（様式と網羅プロファイルは `parity-suite` で定義する）
  - 反応の網羅表。`reaction_coverage.declared: true` のとき `parity-suite` の `reaction-check.mjs --tests <テスト一覧> --recorded` で判定する。
    未測定が残れば、収束させずに `parity-suite` へ戻す（様式は `parity-suite` で定義する）
  - 新側専用のスペックの置き場所、`current` / `new` からの `testIgnore` の除外、採取用の `new-capture` プロジェクト（`suite.new_only`）
- `parity-replace` から受け取るものは次のとおりで、すべて選択した target の `.replace/parity/<slug>/new/<target>/replace-metadata.json` から読む（推測せず、スイートも実行し直さない）。
  - 新側の部品の突き合わせ。`component_coverage.declared: true` のとき `new/<target>/component-comparison.json` を、`parity-suite` の `component-comparison-check.mjs` で判定する。
    突き合わせていないものが残れば、収束させずに `parity-replace` へ戻す（様式は `parity-suite` で定義する）
  - 新側の green の証拠（`suite.new_green`）
  - target の名前と新側の URL（`new.{target,ui_url,api_url}`）。`url_command` の target では `"runtime"` が記録されるので、target の設定から解決し直す
  - 新側のマッピングの例外と、実装で前提にしたデータセットの版（`dataset_version`）
  - データセットの版が古くなったかは、この値では判定しない。判定は [`references/preflight.md`](references/preflight.md) の三者の整合（`metadata.json`・データセットの `changes`・`phase_b.<slug>.<target>`）で行う
- `parity-replace` へ差し戻すもの: 要対応の差分が残り、target の `on_diff` が無い（デフォルト）か、そのドキュメントが修正を指示するとき、`diff.md` を差し戻しの入力として同じ target で渡す。
  反復の回数の記録と上限の管理（`--max-iterations` のデフォルトは 5）は、`parity-replace` がその target の `replace-metadata.json` の `loop.*` で行う（環境ごとに独立している）。
  上限を超えたら、差し戻さずに停止してユーザーへ上げる。
  同じ `loop.changed_scope`（直近の反復で描画に影響する変更を入れた範囲）は、自己ノイズの測定値を再利用してよい組の判定に使う（[`references/capture-new.md`](references/capture-new.md)「測定値の再利用」）。
- `issue-create` に任せるもの: target の `on_diff` のドキュメントが「起票して停止する」運用を指示するとき、差し戻す代わりに、要対応の差分の要約（該当のページ・分類・根拠・`diff.md` のパス）を渡して起票し、停止する（`gh` で直接起票しない）。
- ブランチの作成・commit・PR は `issue-start` に任せる（`parity-replace` と同じやり方。このスキルは実装の流れを作り直さない）。
- `replace-strategy status` が、`diff.md` と `diff-metadata.json` を読んで今の状態を導く。
  他機能待ち（`blocked_by`）が解けたことの検出も、`replace-strategy status` が行う。
  依存先が同じ target で新側を green にした slug を挙げ、このスキルの再実行が要ると示す（このスキルは、再実行のときに前回の `blocked_by` を検証し直す）。
