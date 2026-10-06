# API の特性化・横断 API モード・バッチモード

API の特性化も、画面と同じ Playwright のランナーで行う。`request` フィクスチャで書けるので、2 つの baseURL の仕組みをそのまま使える。

`request` フィクスチャの baseURL は、環境変数 `PARITY_CURRENT_API_URL` / `PARITY_NEW_API_URL` を参照する。
値は、選択した target の `api_url` から解決する。`api_url` を省いたときは `url`（`url_command` の target では、解決した後の UI の URL）を使う。
こうすると、UI と API が別の origin でも一貫する。このスキルが使うのは現側である。

## API の特性化（record/replay）

現行の API の実際の応答を record/replay して固定する。画面が無くても仕様は確定するので、横断 API は、消費する側の機能を待たずに書ける。

- 時刻は固定の値に、乱数は既知の値に固定する（決まらない値を固定する）
- 対象は次の表のとおりである。

| 対象 | 内容 |
|---|---|
| リクエスト | パス・クエリ・ボディ |
| レスポンス | ステータス・ボディ |
| エラー応答 | エラーのときのステータスとボディ |
| 応答ヘッダー | `.replace/response-headers.json`（横断の応答ヘッダーの一覧）に載るものだけ（下の「応答ヘッダー」） |
| 認可 | 誰が何を参照・作成・更新できるか（[`auth.md`](auth.md)） |
| 並び順 | 現行の並び順を固定する |
| ページング | ページのサイズ・境界・カーソル/オフセット |
| 副作用 | 関連するテーブルへの伝播 |

- record と assertion の範囲は、スイートを書く時点で突き合わせる。各シナリオで捕捉したステータスは、assertion で確かめる。
  レスポンスのボディは、すべての JSON path を列挙し、各 path を次のどれかに分類する。
  record 全体を assertion に使う場合も、暗黙にすべての項目を見ていることにせず、比較の前の正規化で除かれる path が無いかを確かめる。
  - 手書きの assertion が直接確かめる。親のオブジェクトや配列を深い等値比較で確かめる場合は、その assertion を根拠にしてよい
  - 揮発する項目として、record/replay と `parity-diff` の両方で同じように正規化するか除外する
  - assertion にできず、未検証として `gaps.md` の「API record / assertion の未対応」に、シナリオ・JSON path・理由を記録する
- 分類していない path を残したまま、スイートを書き終えない。
  assertion を少数の代表の項目へ狭めると、`parity-replace` は狭い範囲だけで green になり、record 全体を比べる `parity-diff` で初めて残りの差が出る。
  捕捉した path と、assertion・正規化・gap の対応を同じ段階で確定し、この往復を先に防ぐ
- `intentional_diffs.pending` は、現新の差を観測した後の確認待ちの置き場所である。まだ assertion に入れていないだけの path を逃がす先にしない。
  差を観測していない未検証の項目は、`gaps.md` に置く
- 並び順を確かめるときは、`references.db_semantics`（照合順序などの意味論の差）を読む。現行の DB と新しい DB で並び順が変わりうる箇所を、意図的な差異として扱えるようにするためである

## 応答ヘッダー

サーバーやリバースプロキシの設定がすべての応答に付ける防御のヘッダーは、画面の処理にも API の定義にも現れない。
そのため、スイートに assertion が無ければ、新側が付けなくても両側で緑になる。差は見た目にも機能にも出ず、安全性だけが下がる。
一覧は、`replace-strategy` の `setup` が 1 度だけ採った `.replace/response-headers.json` である。
形式は `replace-strategy` の `assets/response-headers-template.json` で、採り方と分類は `replace-strategy` の `references/security.md`「横断の応答ヘッダー」で定義する。

- 対象の slug が起こす応答のうち、一覧の「付く応答」に当たるものに assertion を置く。
  API の特性化では、ステータス・ボディと並べて置く。画面では、ページへの遷移の応答に置く。
  ページの応答は `page.goto` の戻り値の `allHeaders()` で読む。`headers()` は `Set-Cookie` などのセキュリティに関わるヘッダーを返さない（出典: <https://playwright.dev/docs/api/class-response#response-headers>）。
  `page.goto` はリダイレクトを追って最後の応答を返す。
  そのため、一覧が採ったリダイレクトの応答（未ログインの 302 など）は、`request` フィクスチャの `get(url, { maxRedirects: 0 })` で採る。
  ログインの成功（POST）の `Set-Cookie` は、正規のログインの操作の要求を `page.waitForResponse` で捕まえて採る。
  複数の `Set-Cookie` は、`headersArray()` で 1 つずつ読む（出典: <https://playwright.dev/docs/api/class-apirequestcontext#api-request-context-get> / <https://playwright.dev/docs/api/class-response#response-headers-array>）。
  採ったヘッダーは、下の項の正規化を通した後の値で assertion にする（cookie の値・`nonce-` の値を assertion に書かない）。
  防御（`class: defense`）は有無と値を、露出の抑止（`class: exposure`）は付かないことを assertion にする。
  一覧に載らないヘッダーは正規化の出力に残らないので、record にも assertion にも入らない（`Date` などの揮発する値と、秘密の値を持ち込まない）
- record にも、秘密の値と要求ごとに変わる値を残さない。録画は Git に入り、`parity-diff` の現側は録画から読むので、比べる前の変換では間に合わない。
  record するヘッダーは、同梱の [`../scripts/header-normalize.mjs`](../scripts/header-normalize.mjs) の `normalizeHeaders` を通した出力だけを書く。
  規則はスクリプトの冒頭のコメントで定義する。ここへ転記しない。`parity-diff` も新側の応答を同じスクリプトで正規化してから比べるので、規則を 2 か所に書かない。
  - スイートからは、`trait-capture.mjs` と同じく、`suite.tools` のコピー専用のディレクトリ（デフォルトは `<parity_suite_dir>/parity/lib/tools/vendor/`）へコピーして import する。
    `VERSION` が `"1"` のコピーは `survey.md` の表を読む古い版で、`--header-list` を受け付けない。録り直す機能では、同梱の版をコピーし直す
  - 一覧は `loadHeaderList(<リポジトリのルートから解決した .replace/response-headers.json の絶対パス>)` で読む。
    `.replace/` ごと見つからないパスは、「一覧が無い」ではなく入力の誤りになる。
    ファイルを自分で読んで `parseHeaderList` へ渡さない。ファイルが無いときに「一覧が無い」へ変える処理を通らないからである。
    受け取れる形は、`allHeaders()`・`headersArray()`・HAR の `headers` のどれでもよい。取得の方法で名前の表記が違っても、同じ出力になる
  - `loadHeaderList` が `NoHeaderListError` を投げたら、下の「一覧が無い」の項へ進む（一覧を推測で作らない）。
    それ以外の例外は、一覧の形の誤りである。たとえば、語彙に無い値やキー・欠けた欄・未測定と行の併存・同じヘッダーの行どうしで付く応答が重なることである。
    `replace-strategy` の測定の 7 で一覧を直してから採る（自分で一覧を書き換えない）
  - 使ったコピーのパス・`VERSION`・録画に使った一覧（`--list` の出力）を、`metadata.json.differ.header_normalize` に記録する。
    `suite.tools` はスイートの指紋が読むパスなので、版を混ぜない。
    `parity-diff` は、新側を同じ版・同じ一覧で正規化できるときだけヘッダーを比べる。
    版が違うと規則の差が、一覧が違うと足された・外されたヘッダーが、誤って現新の差分と判定される
  - CLI は、記録したプロジェクト側のコピーから起動する。
    `node <differ.header_normalize.path> --header-list .replace/response-headers.json <headers.json>` は正規化した JSON を、`--list` は比べるヘッダー名の配列を出力する。
    スキルのディレクトリの同梱の版からは起動しない。`gh skill update` で同梱の版だけが上がると、記録した版と実行した版が食い違う。
    終了コードは、0 が出力、2 が入力の誤り、3 が一覧が無いことを表す
- 付け手が `unknown` の行は assertion にしない（`current.origin: received-assets` で、再構築のデフォルト値である可能性があるもの）。固定すると、再構築のデフォルト値を現行の仕様として守ることになる。
  同じヘッダーに付け手の決まった行と `unknown` の行が混在する場合、正規化はそのヘッダーを録画に残さない（応答の種類を区別できないため）。
  決まった行の応答では、そのヘッダーの値を直接 assertion にする。
  `Set-Cookie` は同じスクリプトの `parseSetCookie` を、CSP は `maskNonce` を通した値で書き、秘密を assertion に残さない。
  対象の slug の応答に当たる行は、`gaps.md` に未検証として残す。先方に確かめて付け手が確定したら、assertion にする
- `owner_slug` が対象の slug の行（どの機能にも属さない静的ファイル・404 の応答）は、その応答を採って同じく assertion にする。
  `owner_slug` が `null` の行は、推測で引き受けない（持ち主を確定するのは `replace-strategy` の `setup` の工程である）
- 一覧が無い場合は、停止しない。一覧が無いのは、`.replace/response-headers.json` が無いか `status: unmeasured` のときで、`loadHeaderList` が `NoHeaderListError` を投げる。
  7 節が表のままの `survey.md` しか無いプロジェクトも、これに当たる（表は読まない）。
  このときは、対象の slug の応答のヘッダーを現行から採り、防御のヘッダーの有無を `gaps.md` に未検証として記録して、`replace-strategy` の測定のやり直しを促す。
  一覧の代わりに、自分で横断の一覧を作らない。付け手の判定と持ち主の確定は `setup` の工程である
- 一覧の値と現行で採った値が食い違ったら（一覧の後に現行の設定が変わった、など）、推測でどちらかに寄せない。
  現行で採った値で assertion を書き、食い違いを `gaps.md` に残して、一覧の採り直しを促す

## 要求単位を確定したら features.md へ書き戻す

record/replay は、現行の API の要求と応答を実際に観測する。
そのため、`.replace/features.md` の「要求単位の根拠」の列に `推定` で残った口を、確定できる位置にいる。
確定を観測した本人が書き戻さないと、その口は `status` の未検証の領域にずっと残る。
採番は特性化より先に行うので、実測していない口は起票の時点から `推定` で入っている。

- 対象の口は、特性化に入る前に features.md から拾う。拾うのは、対象の slug の行で根拠が `推定` の口と、API の列にあるのに根拠のエントリが対応づかない口である。
  拾わずに始めると、観測しているのに列が更新されない
- 確定できたら、`replace-strategy evidence --feature <slug> --endpoint <口> --evidence "実測: <観測した操作と条件>（母集合=… / 1 行=… または 1 要求が扱う対象=…。根拠: API の実動作）"` を実行する。
  このスキルは `.replace/features.md` を自分では書かない。書き戻す方法を 1 つだけにするためで、手順は `replace-strategy` の `references/evidence.md` で定義する。
  `replace-strategy` がインストールされておらず委譲できないときも、自分で書かない。確定した口と根拠を報告し、導入を促す
- 観測が要求単位まで届かなかった口は、`推定` のまま残す。書き込みの口は、1 要求が扱う対象と、失敗したときに巻き戻す範囲まで観測して、初めて確定する。
  成功の応答を 1 本録っただけで `実測` に上げると、その口は未検証の領域から外れたまま、外部の単位がわからないまま残る
- 残した口のうち、測るまで機能を閉じさせないものは、`metadata.json` の `unmeasured` に `disposition: blocking` で宣言し、`gaps.md` にも同じ文言で残す。
  そのエントリの `endpoint` には、口を文字単位で一致させて書く。
  書かないと、機械の検査（`replace-strategy` の `scripts/evidence-gap-check.mjs`）が宣言として数えない（定義は [`coverage.md`](coverage.md)「未測定を機械可読にする」）。
  宣言が無いと、`parity-replace` の完了の判定は、「確定できなかった」と「書き戻しを忘れた」を区別できない
- 観測した要求単位が、API の列に書いた口と食い違う場合は、根拠だけを直さない。口の見直し（`replace-strategy issues` の再突き合わせ）に回す。
  口の変更は、Issue の本文・スイート・新側の実装に及ぶ

## 横断 API モード

横断 API の Issue（リソース単位）から呼ばれた場合は、画面を伴わない API だけの特性化として動く。
スイートは一度だけ書いて共有する（消費する側の機能ごとに重ねて書かない）。

## バッチモード

バッチの Issue から呼ばれた場合は、次のとおりに動く。

- ゴールデンデータセット（と入力ファイル）を入力にして現行のバッチを実行し、出力（DB の状態・生成したファイル）を現行のベースラインとして捕捉する
- 画面駆動の特性化は行わない。生成したファイルの捕捉の観点は、[`coverage.md`](coverage.md) の副作用の出力に従う
- バッチは、ブラウザを通さずにサーバーのファイルシステムへ書く。
  バイト列の取得の方法（ファイルシステムを直接読む）と、形式ごとの扱いは、`replace-strategy` の `references/file-io.md` で定義する。
  到達できるかは、`replace-strategy` の `references/measurement.md` で実測した値を使う
- 書き込みを伴うので、[`data-discipline.md`](data-discipline.md) の規律に従う（復元 → 一意のプレフィックスと後始末 → hermetic でない旨の明示）

## データの扱い

データの扱いは [`data-discipline.md`](data-discipline.md) で定義する（feature / api-resource / batch のすべてのモードで共通）。ここへ転記しない。

- 要点は次のとおりである。読み取りを先に行う。書き込みは復元できる環境で行う。復元できないなら、一意のプレフィックスを付けて後始末する。
  後始末できないなら、承認を得て「hermetic でない」と明示する
- `data-discipline.md` を読めない場合は、書き込み系の特性化を実行せずに停止する。規律を記憶で代わりにせず、参照先の場所をユーザーに確認する
