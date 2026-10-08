# 新側のベースラインを同じ条件で取得する

撮るのは新側だけである。現行は、`parity-suite` が採ったベースライン（`.replace/parity/<slug>/baseline/`。現側は 1 つの環境なので slug の直下）を使う。
このスキルは、現行のアプリを動かさない。

## 採取スペックは雛形から起こす

新側の採取スペックを、現側のスペックを読みながら手で書き起こさない。差分を報告する前提は条件が一致することなので、書き写すと不一致が入り込む。
同梱の雛形 [`../assets/capture-new.spec.template.ts`](../assets/capture-new.spec.template.ts) をプロジェクトへコピーして埋める。
雛形は、撮影の条件を `metadata.json.capture_conditions` から読む形で書いてある。手で書き写す箇所を残さない。

- コピー先は、`metadata.json` の `suite.new_only` である（`parity-suite` が記録した、新側専用のスペックの置き場所。デフォルトは `<parity_suite_dir>/parity/<slug>/new-only/`）。パスは推測せず、記録から読む
- `current` と `new` の両方のプロジェクトから除外されていることを、撮影の前に確かめる（同じ `suite.new_only` の `testIgnore` パターン）。
  - `current` から除外されていないまま現側の実行（ベースラインの再取得・強度チェック）に含まれると、現行のアプリの画面が新側のベースラインとして書き出され、差分ゼロと誤って判定される。
  - `new` から除外されていないと、採取専用の環境変数を持たない `parity-replace` の green の検証が、テストを集める時点で失敗する（往復ループが進まなくなる）。
  - 記録が無いときと、除外が設定されていないときは、撮影せずに止まって `parity-suite` へ設定を戻す（対になる規則である現側専用のスペックの除外の原本は、`parity-suite` の `references/locator-mapping.md`）
- 撮影は、`suite.new_only` に記録した採取専用のプロジェクト（デフォルトは `new-capture`）で実行する（`--project new` では実行されない）。プロジェクトの名前が記録に無ければ、撮影せずに止まり、`parity-suite` へ戻す
- 雛形が読む撮影の条件は、`metadata.json.capture_conditions` の `viewports`・`states`・`pages`・`masks`・`full_page`・`scrollbars`・`display_axes`・`browser` である。
  `pages[].name` が `noise_baseline[].page` と同じ語彙であることを確かめる。
  語彙がずれると、`PARITY_NOISE_PAIRS` で使い回す組を絞り込んでも 1 組も一致せず、自己ノイズの測定が何も測らずに終わる。
  `masks[].name` は、ロケータのマッピングで解決できる論理名であることを確かめる
- `capture_conditions.cofeature_masks` は、撮影の条件へそのまま足さない。
  下の「共同居住機能の実行時マスク」で、同じ target の実装の状態から有効な集合を導き、現側と新側の原本を残した作業用のコピーへ、同じように当てる
- 雛形は、1 回目（`baseline-new/`）と 2 回目（`noise-pass2/`）を、同じスペックの別のパスとして撮る。差分の量（`pixel_diff`・`trait_diffs`）を測るのは記録済みの差分ツールの仕事で、スペックは撮るだけである。
  2 回目は、測った後に消す一時的なものである（下の「2 回目の採取物は測定後に削除する」）
- プロジェクトに新側の採取スペックが既にあるときは、それを優先して上書きしない（雛形の要件を満たしているかだけを確かめる）

## URL の受け渡し（撮影より先）

撮影も、api-resource モードでのリクエストも、選んだ target の URL が Playwright に渡っていないと成り立たない。撮影の前に設定する。

- 選んだ target の `url` と `api_url`（省いたときは `url`）を、環境変数 `PARITY_NEW_UI_URL` と `PARITY_NEW_API_URL` に解決する。
  それを、Playwright の採取用のプロジェクトの baseURL と `request` フィクスチャへ渡す。
  採取用のプロジェクトは、`metadata.json.suite.new_only` に記録した名前のもの（デフォルトは `new-capture`）で、`new` と同じ baseURL の設定を使う
- 選んだ target が `browser.cdp_url` を持つときは、`PARITY_NEW_CDP_URL` に解決し、共通のフィクスチャが利用者の環境のブラウザに接続する。
  設定の原本は、`parity-suite` の `references/locator-mapping.md`「利用者環境のブラウザへ接続する」にある。
  現側の `capture_conditions.browser` と宣言の有無が合わなければ、撮影せずに止まる（下の「条件一致の先行検証」の `browser`）。
  `url_command` を持つ target は、このスキルの実行で target を解決したときに 1 回だけコマンドを実行して得た URL を使う。失敗したときと、出力が空のときは止まる。
  後の工程では解決した値を使い回し、工程ごとに実行し直さない（解決の規則の原本は、`replace-strategy` の `references/project-config.md`「URL の引き渡し」）
- 解決した値が、`new/<target>/replace-metadata.json` の `new.ui_url` と `new.api_url` に一致することを確かめる（別の環境の URL で撮らない）。
  記録が `"runtime"` のフィールドは解決した値を持たないので、target の名前の一致で代わりに照合する。
  固定の値で記録したフィールド（例: `url_command` の target の固定の `api_url`）は、そのまま照合する。
  target に `commit_check` があれば（固定の `url` か `url_command` かに関わらず）、その出力が記録の `new.commit` と一致することも確かめる。
  一致しなければ、green の証跡とは別のデプロイなので止まる。部品の改修をまとめて再検証するときは、照合相手が変更宣言の `commits.after` になる（[`component-change.md`](component-change.md)）
- 設定の原本は、`parity-suite` の `references/locator-mapping.md` である（`current`・`new`・`new-capture` のプロジェクトの baseURL を環境変数で参照する形。URL を config に直接書かない）

## 条件一致の先行検証（差分検出より前）

環境の差を差分として報告しないために、撮影の前に条件が一致するかを確かめる。不一致を見つけたら、差分を報告せずに止まる。

- `metadata.json.capture_conditions` の次の項目を、新側で再現できるかを確かめる。
  `environment`・`viewports`・`full_page`・`scrollbars`・`display_axes`・`browser`・`animations: "disabled"`・`masks`・`states`
- ビューポートの寸法、アニメーションを止めること、マスクを当てることが現行と一致していることを、撮影の前に確かめる

### `capture_conditions_verified` は項目ごとに記録する

「確かめた」を 1 つの真偽値にまとめない。照合できた項目とできなかった項目が混在し、未検証のものが「検証済み」と誤って判定されるからである。
`diff-metadata.json.capture_conditions_verified` は、次のキーを持つオブジェクトで記録する（共同居住機能のマスクの `cofeature_masks` は、下の「共同居住機能の実行時マスク」）。

| キー | 記録する内容 |
|---|---|
| `viewports` | 現側の `viewports` と新側の実際の寸法、および `full_page`（画面全体か、ビューポートの中か）が一致したか。一致しなければ止まる。画像の大きさが違うと、すべてのページの全面が差分になる |
| `animations` | `animations: "disabled"` を新側でも当てられたか（一致しなければ止まる） |
| `scrollbars` | 現側の `scrollbars`（`hidden`・`shown`）と同じ扱いで新側を撮ったか。雛形は、`shown` のときは `--hide-scrollbars` を外して起動し、撮影に使うページに `overflow: scroll` の箱を置いてバーの幅を測る。`shown` なのに 0 のとき、`hidden` なのに 0 でないときは止まる（`cdp` では起動の引数が反映されないため）。ヘッドありの起動ではスクロールバーが場所を取るので、`hidden` の撮影には使わない。現側が `hidden`（デフォルトは `shown`。`scrollbars_reason` が付く）なら、スクロールバーが場所を取る差〈要素のはみ出し・横のバーの有無・バーの見た目〉を比べていないことを、理由とともに `diff.md` の未検証領域へ転記する。キーごと無い旧成果物は止まり、`parity-suite` へ戻す（原本は `parity-suite` の `references/baseline.md`「スクロールバーが場所を取る窓のはみ出し」） |
| `display_axes` | 現側の `display_axes` の基準の組（すべての軸の `default`）と、各変種（`variants`）の値を、操作アダプタの `applyDisplayAxes`（`metadata.json.suite.interactions`）で新側にも当てて撮ったか。変種は `viewports` と同じく外側のループで回す。書き出し先は変種の `label` で、窓の寸法は変種の `viewport` が指す窓のものを使う。当てられない値があれば止まる。キーごと無い旧成果物は止まり、`parity-suite` へ戻す（原本は `parity-suite` の `references/baseline.md`「表示を切り替える軸（掛け合わせずに撮る）」） |
| `browser` | 現側の `browser`（`launched`・`cdp`）と、選んだ新側の target の `browser.cdp_url` の有無が一致したか。`cdp` なら、`PARITY_NEW_CDP_URL` に解決して共通のフィクスチャで接続する。そして、接続したブラウザの `browser.version()` と `navigator.userAgent` と、描画するブラウザの側の OS〈`browser_os`〉が、現側の `browser_identity` と一致することも確かめる。`browser_os` は `parity-suite` の `references/locator-mapping.md` と同じ読み方と正規化で読み、キーの集合ごと一致することを確かめる。reduced UA は OS の版を短くするので、版と UA だけでは別の機械を見分けられない。現側に `browser_os` が無い旧成果物〈手順の改訂 5 より前〉は止まり、`parity-suite` で撮り直す。片側だけを利用者の環境で撮ると、環境の差がそのまま差分に出るので、一致しなければ止まる。キーごと無い旧成果物は止まり、`parity-suite` へ戻す（設定の原本は `parity-suite` の `references/locator-mapping.md`「利用者環境のブラウザへ接続する」） |
| `masks` | 現側の `masks` のロケータを新側でも解決して、マスクできたか（解決できないマスクは、値に理由を残す） |
| `states` | 現側の `states` の各状態へ、操作アダプタ（`metadata.json.suite.interactions`。下の「論理名の解決」）で新側でも遷移できたか（遷移できない状態があれば止まる） |
| `popup_inventory` | 現側の `popup_inventory` の整合が取れたかと、`diff.md` の未検証領域へ転記した `captured: null` の要素。整合の条件は、下の箇条書きの「現側 `capture_conditions.popup_inventory` を読む」にある。単一の文字列の `opened_by` は、旧形式として 1 要素の配列と同じに読む。キーごと無い旧成果物は止まる。ユーザーが承認した例外で続けたときだけ、`"absent: 承認済みの例外。ノイズ吸収なしで続行"` を記録する（整合が取れなければ止まる） |
| `environment` | 現側の `environment`（自由に書いた記述）と照合できたか |

- `environment` は自由に書いた記述なので、機械では照合できない。
  原則として `"unverified: <理由>"`（例: `"unverified: 現側は記述のみで新側と機械照合できない"`）を記録し、同じ内容を `diff.md` の未検証領域へ転記する。
  照合できたときだけ、照合した根拠（比べたブラウザ・OS・フォントなど）を値に書く
- 現側の `capture_conditions.viewer_environment` が「乖離」なら、その内容を `diff.md` の未検証領域へ転記する。
  「未確認」は `parity-suite` の `capture-scope-check.mjs` が失敗にするので、収束の判定で `parity-suite` へ戻る。
  現と新を同じ条件で撮るように揃えると、採取した環境でだけ成り立つ一致（総称ファミリーのフォントの代わりに使われる書体・システムの UI から来るデフォルトの値）が現と新の両側に同じように当たる。
  そのため、利用者の環境でだけ表示が変わる差を、差分ゼロとして通してしまう。
  同じ条件で確かめたことを、「利用者の環境でも一致する」と読み替えない（原本は `parity-suite` の `references/baseline.md`「採取環境と利用者環境の乖離」）
- 現側の `capture_conditions.popup_inventory` を読む（原本は `parity-suite` の `references/baseline.md`「撮影状態の決め方（2）コンテナの棚卸し」）。
  - 次の行があれば、撮影せずに止まり、`parity-suite` へ戻す。
    - `captured` が `states` に無い名前を指す行
    - `captured: null` なのに `reason` が空の行
    - `captured` を持つのに、`reason` のキーが無いか、`null` でない行（両方を埋めた行を含む）
  - 操作アダプタ（`suite.interactions`。新側の例外を含む）とスイートから、ポップアップなどの要素を開く呼び出しを列挙する。
    単位は、「どの要素の中から呼ぶか（1 段目は `null`）× 関数名 × 開く対象の論理名」である。
    列挙したすべての呼び出しが、同じ `parent` を持つ行の `opened_by`（`<関数名>(<開く対象の論理名>)` の配列）に現れることも確かめる。
    関数名だけで突き合わせると、引数で対象を変える関数の 1 行が、他の呼び出しまで満たしてしまう。
    呼び出す場所を除いて突き合わせると、別の親の要素から呼ぶ同じ呼び出しが 1 つにまとまってしまう。
  - 現れない呼び出しがあれば、その要素は数えられておらず、撮られていない。止まって `parity-suite` へ戻す。
  - 次の行も、不整合として止まる。
    - `opened_by` が空の配列の行
    - 同じ要素を 2 つ持つ行
    - 同じ `parent` × 同じ呼び出しを持つ 2 行
    - 同じ `name` の 2 行（`parent` は問わない。`name` は機能の棚卸し全体で一意である）

    前の 2 つは、どの要素がその呼び出しで開くかが決まらない。最後のものは、1 つの要素を 2 回数えている。開き方が複数あるなら、行を分けずに 1 行の `opened_by` に並べる。
  - 単一の文字列の `opened_by` は、旧形式として 1 要素の配列と同じに読む。読み替えるのは形だけで、上の突き合わせと不整合の判定は同じように当てる。
  - 列挙した呼び出しは、`opened_by` と同じ正規化にそろえてから突き合わせる。
    正規化では、開く対象を決める引数だけを残し、他はすべて除く（原本は `parity-suite` の `references/baseline.md`）。
    書き方がそろっていないと、同じ呼び出しが 2 つの文字列になり、「現れない呼び出し」として誤って止まる。
  - 記録の側に古い引数の書き方（`openCombo(page, 演算子)` など）が残っているときも、同じ理由で誤って止まる。
    これは不整合ではなく移行の忘れなので、止まらずに記録の側を新しい書き方に書き換えてから突き合わせる（原本は同じく `baseline.md`）。
  - `captured: null` の行は、`diff.md` の未検証領域へ転記する。撮っていない要素は 3 つの比較方法のどれにも出ないので、差分ゼロを「画面が同じ」と読み替えない
- `popup_inventory` のキーごと無い旧成果物は、静止を待つ処理を入れる前に採取したものである。撮影せずに止まり、`parity-suite` でベースラインとノイズの基準値を採り直すよう戻す。
  古い「ノイズ 0」の基準値を正規化に使うと、2 つの値のどちらかになる採取の揺れを、吸収したり誤って分類したりすることがある。そのため、未検証と注記するだけでは進めない。
  - 例外は、採り直せない理由（現行の target を撤去したなど）をユーザーに示して承認を得たときだけである。
  - そのときは、現側のノイズの基準値による吸収を当てない。`diff-normalize.mjs` に `--noise` を渡さず、画素の比較でも `noise_baseline` を差し引かない。
  - 承認の記録と、次の 2 つを `diff.md` の未検証領域に残す。「撮影する状態の要素の棚卸しが無く、撮っていない要素の見た目は未検証」と、「ノイズの基準値は静止を待つ処理を入れる前の採取なので、吸収に使っていない」である。
  - 下の「新側の自己ノイズ測定」の、現側の `noise_baseline` と比べるチェックも、この例外では当てない。古い「ノイズ 0」と比べると、新側に少しでもノイズがあれば必ず止まり、例外を使えないからである（代わりのチェックは同じ節にある）
- 次のときは、差分を報告せずに止まる。
  - `viewports` か `animations` が一致しない
  - `masks` を解決できない
  - `states` の状態へ遷移できない
  - `popup_inventory` の整合が取れない

  未検証のまま、または不一致のまま差分検出へ進まない。別の状態のスクリーンショット同士を比べて、偽の回帰を報告しないためである

## 共同居住機能の実行時マスク

`capture_conditions.cofeature_masks` の候補から、実行ごとに有効な集合を機械的に導く。前の回の集合や `blocked_by` は引き継がない。

1. 対象のページについて `.replace/features.md` のページの一覧を読み、対象の slug と同じページに載る別の slug を挙げる
2. 別の slug ごとに、選んだ同じ target の `.replace/parity/<slug>/new/<target>/replace-metadata.json` を読む。ファイルが無いか、`suite.new_green` が false の slug だけを、未実装とする
3. 未実装の slug とページが一致する `cofeature_masks` の `regions[]` を、有効な集合にする。green の slug、別の target の証跡、ページの一覧に無い slug は含めない
4. 現側で記録した page × state × viewport ごとの `bbox` を使う。
   次のときは、差分検出へ進まずに `parity-suite` へ戻す。対象の撮影の組の矩形が無いとき、画像の外にはみ出すとき、幅か高さが正でないとき、持ち主の領域があいまいなときである
5. 新側の root を解決できることは、必須にしない。未実装なら新側の DOM に root が無いのが正常なので、現側から来た同じ `bbox` を、現側と新側の作業用の画像に当てる。
   新側の root を解決できたときだけ、その矩形が記録した `bbox` の中に収まることを確かめる。外にあれば「別の領域を隠すおそれ」として止まる
6. いつも当てる `masks` を当てた原本は、上書きしない。画素は、両方の作業用の画像の同じ座標へ、同じマスクの色を当てる。
   特性照合と aria は、現側の `name` の下を比べる入力から除き、新側に対応する root があるときだけ、その下も除く。新側の root が無いこと自体を、エラーや aria の差分にしない

`diff.md` と `diff-metadata.json.capture_conditions_verified.cofeature_masks[]` には、ページ・状態・ビューポートごとに、次のものを記録する。
有効にした `slug → name + bbox`、読んだ green の証跡のパスと値、新側の root の有無である。
いつも当てる `capture_conditions.masks` を確かめた結果は、既にある `capture_conditions_verified.masks` にだけ記録し、共同居住機能のマスクを入れない。
用途を分けないと、いつも当てるマスクを解決できたことと、実行のたびに増減する候補の集合を、同じ値から判定できなくなる。
依存先が green になれば、次の回はその slug が集合から外れ、最後の 1 回はその領域を含めて全面を比べる。
共同居住機能のマスクの外に残った、未実装が原因の差分だけが `blocked_by` の候補である。マスクした領域を、差分の件数や `blocked_by` に数えない。

実行の結果の報告には、正常な場合だけでなく、次の境界も含める。
ここを省くと、新側の root が無いことを許す変更が、別の異常まで成功として扱うように読める。

- 対象の撮影の組の `bbox` が無いとき、寸法が正でないとき、画像の外にあるとき、持ち主の領域があいまいなときは、`parity-suite` へ戻して止まる。`blocked_by` や片側だけのマスクとして扱わない
- 新側の root は無くてよい。あるときだけ対応する下の要素を除き、その実際の矩形が現側から来た `bbox` の中に収まることを確かめる。外にあれば別の領域を隠すおそれがあるので止まる
- 同じ target で green になった slug を外したこと、最後に外した後の全面の比較、マスクした領域を差分の件数と `blocked_by` に数えないことを示す

## 論理名の解決

- 現側のマッピングは `metadata.json.suite.locator_map` である。新側の例外は、選んだ target の `new/<target>/replace-metadata.json` の `suite.locator_map_new` である（`none` なら現側のものだけで解決する）
- 状態の遷移（hover・focus・active・disabled・selected・error など）には、`metadata.json.suite.interactions` の操作アダプタを使い回す（`capture_conditions.states` と同じ状態へ遷移させる）

## 特性採取

- 採取のツールは、プロジェクトの側のコピー `metadata.json.suite.tools` の `trait-capture.mjs` を使う。
  スキルの間で参照せず、プロジェクトの側のコピーを使うのは、インストールに依存しないためである（原本は `parity-suite` に同梱している）
- 採る対象・プロパティの集合・状態は、現行と同じにする（`metadata.json.traits.property_set`・`traits.elements`・`capture_conditions.states`）
- 相対的な位置と大きさは、`getBoundingClientRect()` から要素の対の関係を導いて比べる（絶対的な座標は比べない。導くのは `trait-compare.mjs` の側）
- 採取が `element is outside the document` で失敗したら、新側の論理名が、描画されていない要素（支援技術のためのコピー）に解決している。
  欠けたものとして先へ進まず、`suite.locator_map_new` の例外を直して採り直す（差し戻し先は `parity-replace` の新側のマッピング。判定の原本は `parity-suite` の `references/baseline.md`）

## aria スナップショット

同じページ・同じ状態で、新側の aria スナップショットを採る（[`detect.md`](detect.md) の aria の比較で、現行の参考のスナップショットと構造を比べる）。

## 保存

- 保存先は、選んだ target の `.replace/parity/<slug>/new/<target>/baseline-new/` である（環境ごと。他の環境の新側のベースラインを上書きしない）。
  `parity-suite` の `baseline/` と同じレイアウトにする（同じページ・状態・ビューポートの対応が取れるようにする）
- 書き込めるかを撮影の前に確かめ、書き込めなければ早めに失敗する（すべて撮ってから保存できないと分かるのを避ける）
- テキスト（特性の JSON・aria）は Git に入れる。スクリーンショットなどの大きなバイナリは、`artifacts` の設定（`overrides.<slug>` を考慮する）に従う。デフォルトは `local`（commit しない）
- 実際の保存先を `diff-metadata.json.paths.baseline_new` に記録する（スクリーンショットは作業のためのもので、切り替えた後に残っている必要はない）
- `noise-pass2/` は、保存先を選ぶ対象にしない（測った後に消すため。下の「2 回目の採取物は測定後に削除する」）

## 性能の採取

性能は、画面の採取と別のスペックで採る。`parity-suite` が `current` と `new` の両方のプロジェクトに置いた `perf/` のスペック（`metadata.json` の `suite.perf`）を、`new` で実行する。
雛形のコピーを新しく作らない。現側と同じスペックで採らないと、比べる値の読み方が揃わない。

```bash
PARITY_PERF_CAPTURE=1 PARITY_SLUG=<slug> PARITY_NEW_TARGET=<target> PARITY_NEW_UI_URL=<url> \
  npx playwright test <parity_suite_dir>/parity/<slug>/perf/ --project new --workers=1
```

- 出力は `.replace/parity/<slug>/new/<target>/perf-samples.json` で、テキストの成果物として Git に入れる。
- 現側を採った機械・ブラウザ・測り方（`performance.environment` と `performance.settings`）と同じ条件で採る。違えば比較は `env_mismatch` で止まる。
  `channel` と `headless` も現側と同じにする（`channel` の指定と `headless: false` では、ブラウザ本体が Google へ送信する。原本は `parity-suite` の `SKILL.md`「前提」）。
- 自己ノイズの再利用（下の「測定値の再利用」）は、性能には当てない。性能は毎回採る。新側のばらつきは、`perf-stats.mjs compare` が採った分布から毎回判定する。
- `metadata.json` に `performance` が無いか `declared: false` なら、採らない（[`detect.md`](detect.md)「性能の比較」）。

## 新側の自己ノイズ測定（差分検出へ進む前のチェック）

ノイズの基準値（`metadata.json.noise_baseline`）は、現側の 1 つの環境で測った値である。新側の target にそのまま使えるとは限らない（CDN やフォントの読み込みなどで、環境のノイズは変わる）。

- 同じ条件で 2 回撮り、新側だけの撮り直しの差分を測る（page × state × viewport ごとの `pixel_diff`・`pixel_diff_strict`・`pixel_diff_strict_only`・`trait_diffs`）。測る組の決め方は、下の「測定値の再利用」にある。
  画素は、現側と同じ 2 つの値を測る。しきい値つきの値だけだと、現と新の比較で使う strict の値と比べる基準が無くなる（[`detect.md`](detect.md)「画素の量は 2 本で報告する」）
- 2 回の結果が一致しても、採取が決定論的であることの証明にはならない（2 つの値のどちらかになる採取は、1/2 の確率でノイズ 0 になる）。
  両方の回とも、操作アダプタの「撮る対象の矩形が落ち着くまで待つ」を通して撮る（原本は `parity-suite` の `references/baseline.md`「撮る対象が動かなくなるまで待つ」）。
  通したら、`noise_measurement.fingerprint.settle_wait: true` を記録する。コードを変えずに撮り直した現と新の差分が回ごとに大きく変わるなら、実装の差を追う前に、この待ちを疑う
- 測った結果を、`diff-metadata.json.noise_baseline_new` に記録する。組は現側の `noise_baseline` と同じにし、項目は現側の値に `source` と `measured_at` を加えた形にする。使い回した組も含めて、すべての組を書く
- 現側の `noise_baseline` との開きが大きいときは、差分を報告せずに止まり、ユーザーに判断を求める。
  新側のノイズが現側より大きいまま比べると、ノイズの基準値による吸収（[`normalize.md`](normalize.md) の、残りの差分へのまとめての適用）が、本物の回帰を警告なしに吸収してしまう。
  開きの原因（フォントが読み込まれていない・アニメーションが残っている・描画が遅れるなど）を取り除いてから、撮り直す
- 判定は、page × state × viewport の組ごとに行う。
  `noise_baseline_new` の `pixel_diff`・`pixel_diff_strict`・`pixel_diff_strict_only`・`trait_diffs` が、現側の同じ組の値を超えた組があれば止まる（超えた組と、超えた項目を挙げて報告する）。
  現側に strict の値が無い成果物（その項目を入れる前に測った `noise_baseline`）では、strict の値は比べず、その組を `diff.md` の未検証領域に挙げる（無い値を 0 と読んで、必ず超えたことにしない）
- 旧成果物をユーザーが承認した例外で続けたとき（上の「条件一致の先行検証」）は、現側と比べない。現側のノイズで吸収しないので、本物の回帰を吸収してしまうことが起きないからである。
  代わりに、新側の自己ノイズを同じく組ごとに測って `noise_baseline_new` に記録する。
  `pixel_diff`・`pixel_diff_strict`・`pixel_diff_strict_only`・`trait_diffs` が 0 でない組を、`diff.md` の未検証領域に挙げる（その組の差分は環境のノイズとして吸収せず、トリアージで 1 件ずつ分類する）
- 現側の基準値を、新側で測った値で上書きしない（`metadata.json` は書き換えない。ノイズの基準値を測るのは、現行のアプリを動かす `parity-suite` の仕事である）

### 2 回目の採取物は測定後に削除する

残すのは測った値だけで、2 回目（`new/<target>/noise-pass2/`）の採取物そのものは残さない。
チェックの判定も、使い回せるかの判定も、読むのは `diff-metadata.json` の `noise_baseline_new` と `noise_measurement` である。
記録した後の採取物は、どの工程も読まない（現と新の比較の相手は、1 回目の `baseline-new/`）。

- 消すことは、測る手順の一部である。`diff-metadata.json` へ書いた直後に `noise-pass2/` を消し、そこまで済ませて測定を終える
- commit しない（特性の JSON と aria はテキストだが、`baseline-new/` と同じ量の重複がリポジトリに入るので、保存先の区分を当てない）
- 無いことは、失効条件ではない。下の「失効条件」の判定の材料は、前の回の実行の記録値と `fingerprint` で、採取物ではない。
  そのため、採取物が無いことを理由に測り直さない（逆に、採取物が残っていることを、使い回してよい根拠にもしない）
- 中断して `noise-pass2/` が残っていても、入力ではないので捨ててよい。測り直す組は、同じ場所へ撮り直す
- 現側も同じように扱う（`parity-suite` が測るノイズの基準値の 2 回目。原本は `parity-suite` の `references/baseline.md`）

### 測定値の再利用（往復ループで毎反復撮り直さない）

ノイズの元は環境の特性（フォントの読み込み・アニメーションのタイミング・CDN など）で、`parity-replace` との往復ループの反復の間では、ほとんど変わらない。
そのため、同じ target の直前の実行の測定値を、組（page × state × viewport）ごとに使い回してよい（デフォルト）。
使い回した組は、2 回目の撮影を省く（1 回目、つまり新側のベースラインの撮影は毎回行う）。

- 使い回す元は、同じ target の `new/<target>/diff-metadata.json` の `noise_baseline_new` と `noise_measurement`（前の回の実行の記録）である。
  この実行で同じファイルを書き出す前に読む（この実行の成果物で上書きすると、前の回の記録は戻せない）。他の target の測定値は使わない（環境が違えば、ノイズも違う）
- チェックの判定（現側の `noise_baseline` との比較。承認した例外では、自己ノイズが 0 でない組を未検証にすること）は、使い回した組でも毎回行う。省くのは撮影で、判定ではない
- 使い回してよいかは、下の「失効条件」で判定する。判断の材料が無いとき・読めないとき・判定が付かないときは使い回さず、安全な側としてその組を測り直す
- 測った組と使い回した組の区別を、`diff-metadata.json.noise_measurement` と `diff.md` の前提確認の表に記録する（どの値がいつ測ったものかを追えるようにする）
- 撮影に使ったブラウザが同じであることを示す値は、雛形が書き出す（`new/<target>/browser-identity.<pass>.json`。`pass` は `baseline` か `noise`）。1 回目の値を、`fingerprint.capture_conditions.browser_identity` に入れる。
  2 回目を撮ったら 2 つを突き合わせ、違えば同じ環境で 2 回撮れていないので、測った値を記録せずに止まる（別の描画の環境の差を、自己ノイズとして数えない）。
  `noise-pass2/` と同じく、fingerprint に記録したら消し、commit しない

#### 失効条件（成立したら再測定を強制する）

「全組」の条件が 1 つでも成り立てば、すべての組を測り直す。成り立たなければ、組ごとの条件だけで判定する。

| 条件 | 失効する範囲 | 判定の材料 |
|---|---|---|
| `--remeasure-noise` を指定した | 全組 | 実行時のフラグ |
| 前の回の測定の記録（`noise_measurement`）が無い、不正な値である、`noise_baseline_new` と組が対応しない | 全組 | `new/<target>/diff-metadata.json` |
| 撮影の条件が変わった（`capture_conditions` の `viewports`・`full_page`・`scrollbars`・`display_axes`・`browser`・`states`・`masks`・`animations`・`popup_inventory`）。`browser: cdp` では、接続先が同じであること〈解決した `PARITY_NEW_CDP_URL` の sha256 と、CDP の `Browser.getVersion` の `product`・`userAgent`〉も含める。同じであることを確かめられなければ測り直す | 全組 | `noise_measurement.fingerprint.capture_conditions` と `metadata.json` の不一致 |
| 撮影に使ったブラウザが同じでなくなった（`launched`・`cdp` のどちらも）。比べるのは、ブラウザの名前・版〈`browser.version()`〉・撮影に使うページで読んだ `navigator.userAgent`・`channel`・`headless`・描画するブラウザの側の OS〈`browser_os`〉である。`browser_os` は現側と同じ読み方と正規化で読む〈`use` を当てない別のコンテキストの安全なページで読んだ `navigator.userAgentData` の `platform`・`platformVersion`・`architecture`〉。`cdp` ではランナーと別の機械なので、Node の `os` で代えない。ランナーや OS の移動、Playwright の更新による版の変化、`channel` や `headless` の変更が当たる | 全組 | 今回の 1 回目の `new/<target>/browser-identity.baseline.json` と、`fingerprint.capture_conditions.browser_identity` の不一致。今回の記録が無い・読めない・前の回の fingerprint に無いときは、使い回さない（同じであることを確かめられない状態を、一致として扱わない） |
| 差分ツールの種類やしきい値が変わった（`differ.{pixel_tool,pixel_threshold,align_tolerance,aria_compare,trait_compare}`・`traits.tool`） | 全組 | 同じく `fingerprint.differ` の不一致 |
| 前の回の測定に、静止を待つ処理を通した記録が無い（`fingerprint.settle_wait` が無いか、`true` でない） | 全組 | 同じく `fingerprint.settle_wait`（静止を待つ処理を入れる前に測った値は、2 つの値のどちらかになる採取を「ノイズ 0」として持ち越すことがある） |
| `fingerprint.dataset_version` より後に、対象の slug に影響するデータセットの変更がある | 全組 | `fingerprint.dataset_version` と、dataset の `changes[].affects`（判定の取り決めは `golden-dataset` の `references/versioning.md`） |
| 反復が飛んでいる（`loop.iterations` − `noise_measurement.loop_iteration` が 0 でも 1 でもない） | 全組 | `new/<target>/replace-metadata.json` の `loop.iterations`（間の反復で変えた範囲をたどれない） |
| 反復が進んでいない（差が 0）のに、`new.commit` が `noise_measurement.measured_at_commit` と違う | 全組 | 同じく `new.commit`（ループの外で新側を触っており、変えた範囲をたどれない） |
| `loop.changed_scope` が無いか、`null` である（範囲が決まっていない、または記録していない `parity-replace` の証跡） | 全組 | 同上（`null` は「範囲が分からない」であり、`pages: []`、つまり「描画に関わる変更は無い」という申告とは別のものである） |
| 前の反復で、共有の資産（テーマ・design token・共通のコンポーネント・グローバルの CSS・フォントの読み込みなど）に、変更宣言なしで触れた | 全組 | `loop.changed_scope.global` が真（`components` と一緒に書かれていても、全組を優先する） |
| 前の反復で、変更宣言のある共通の部品を直した | 宣言ごとに、この機能に影響する組（判定できなければ全組） | `loop.changed_scope.components[].change` を入力にした、`parity-suite` の `scripts/component-impact.mjs --feature <slug>` の出力（宣言を読めないときと、exit 2 のときも全組） |
| 部品の改修をまとめて再検証する手順（[`component-change.md`](component-change.md)）で実行している | この機能に影響する組 | 同じ手順の 1 の `component-impact.mjs` の出力。反復も `replace-metadata.json` の `new.commit` も改修の前のまま進まないので、反復・SHA・`changed_scope` の行からは範囲が出ない。この行が範囲を決める |
| `loop.changed_scope.pages` に、現側の `noise_baseline[].page` のどれとも一致しない値がある | 全組 | 同じく `pages` と `metadata.json.noise_baseline[].page`（語彙が合わず、範囲を突き合わせられない） |
| 前の反復で変えたページ | そのページの組 | `loop.changed_scope.pages` |
| 組の `measured_at` から 24 時間を超えている | その組 | `noise_baseline_new[].measured_at` と今の時刻（別のセッションの測定値を当てはめない。他の組を測り直しても、古い組は失効させる） |
| 前の回に測っていない組がある（ページ・状態・ビューポート〈表示の軸の変種の label を含む〉が増えた） | 増えた組 | `fingerprint.pairs` に無い組 |

- 新側の commit の SHA（`new.commit`）が変わったことを、それだけで失効の条件にしない。往復ループでは反復ごとに変わるので、それだけを条件にすると使い回せなくなる。
  反復が進んだ（差が 1）ときの SHA の変化は、`loop.changed_scope` で範囲を判定する。
  反復が進んでいないのに変わったときだけ（ループの外の変更で、範囲をたどれない）、上の表のとおりすべての組を測り直す。
  SHA は `noise_measurement.measured_at_commit` に記録する（`changed_scope` の記録の取り決めの原本は、`parity-replace` の `references/diff-loop.md`）
- `components` は `global` の代わりに書く範囲だが、`global` と同時に書いてもよい。両方あれば、`global` の全組を優先する。
  `components` に書かれた部品の影響は宣言から機械で導き、自分で読み替えて組を減らさない
- 現側の `noise_baseline` が更新されたことは、失効の条件にしない（新側で測った値は有効なままである）。新しい基準値で、チェックの判定だけをやり直す
- 測り直した組は、測った値と、その組の `measured_at` を更新する。使い回した組は、`measured_at` を含めて前の回の値をそのまま引き継ぐ（`noise_baseline_new[].source` で区別する）
