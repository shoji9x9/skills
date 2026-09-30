# API の特性化・横断 API モード・バッチモード

同じ Playwright ランナーに寄せる（`request` フィクスチャで書けるため、2 baseURL の仕組みをそのまま流用できる）。

`request` フィクスチャの baseURL は、選択した target の `api_url`（省略時は `url`。`url_command` の target は解決後の UI URL）から解決した環境変数 `PARITY_CURRENT_API_URL` / `PARITY_NEW_API_URL` を参照する（UI と API が別 origin でも一貫する。本スキルが使うのは現側）。

## API の特性化（record/replay）

現行 API の実応答を record/replay して固定する。**画面が無くても仕様は確定する**ため、横断 API は消費側の機能を待たずに書ける。

- **時刻は固定値、乱数は既知の値に固定する**（非決定性の固定）
- 対象:

| 対象 | 内容 |
|---|---|
| リクエスト | パス・クエリ・ボディ |
| レスポンス | ステータス・ボディ |
| エラー応答 | エラー時のステータスとボディ |
| 応答ヘッダー | `.replace/survey.md`「7. 横断の応答ヘッダー」に載るものだけ（下記「応答ヘッダー」） |
| 認可 | 誰が何を参照・作成・更新できるか（[`auth.md`](auth.md)） |
| 並び順 | 現行の並び順を固定する |
| ページング | ページサイズ・境界・カーソル/オフセット |
| 副作用 | 関連テーブルへの伝播 |

- **record と assertion の範囲を authoring 時に突き合わせる。** 各シナリオで捕捉したステータスは assertion で確認する。レスポンスボディは全 JSON path を列挙し、各 path を次のいずれかへ分類する。record 全体を assertion に使う場合も、暗黙に全項目を見ているとして済ませず、比較前の正規化で除かれる path が無いか確認する。
  - 手書き assertion が直接検証する（親オブジェクト／配列の深い等値比較で覆う場合は、その assertion を根拠としてよい）
  - 揮発項目として record/replay と `parity-diff` の双方で同じ正規化・除外を行う
  - assertion にできず未検証として `gaps.md` の「API record / assertion の未被覆」へ、シナリオ・JSON path・理由を記録する
- **未分類の path を残して authoring を完了しない。** assertion を少数の代表項目へ狭めると、`parity-replace` は狭い範囲だけで green になり、record 全体を比較する `parity-diff` で初めて残りの差が出る。捕捉した path と assertion／正規化／gap の対応を同じ段階で確定し、この往復を前倒しで防ぐ
- `intentional_diffs.pending` は現新の差を観測した後の確認待ちであり、**まだ assertion に入れていないだけの path の退避先にしない。** 差を観測していない未検証項目は `gaps.md` に置く
- **並び順の検証には `references.db_semantics`（collation 等の意味論差）を読む。** 現行 DB と新 DB で並び順が変わりうる箇所を意図的差異として扱えるようにする

## 応答ヘッダー

サーバー・リバースプロキシの設定が全応答に付ける防御ヘッダーは画面の処理にも API の定義にも現れず、**スイートに assertion が無ければ新側が付けなくても両側で緑になる**（差は見た目にも機能にも出ず、安全性だけが後退する）。
一覧は `replace-strategy` の `setup` が 1 度だけ採った `.replace/survey.md`「7. 横断の応答ヘッダー」（採り方と分類の正本は `replace-strategy` の `references/security.md`「横断の応答ヘッダー」）。

- **対象 slug が駆動する応答のうち、一覧の「付く応答」に当たるものに assertion を置く**——API の特性化ではステータス・ボディと並べて、画面ではページへの遷移の応答（`page.goto` の戻り値の `allHeaders()`。`headers()` は `Set-Cookie` 等のセキュリティ関連ヘッダーを返さない。出典: <https://playwright.dev/docs/api/class-response#response-headers>）で。
  **`page.goto` はリダイレクトを追って最後の応答を返す**ので、一覧が採ったリダイレクトの応答（未ログインの 302 等）は `request` フィクスチャの `get(url, { maxRedirects: 0 })` で、
  ログインの成功（POST）の `Set-Cookie` は正規のログイン操作の要求を `page.waitForResponse` で捕まえて採る
  （複数の `Set-Cookie` は `headersArray()` で 1 つずつ読む。出典: <https://playwright.dev/docs/api/class-apirequestcontext#api-request-context-get> / <https://playwright.dev/docs/api/class-response#response-headers-array>）。
  採ったヘッダーは**下の項の正規化を通した後の値**で assertion にする（cookie の値・`nonce-` の値を assertion に書かない）。
  **防御**は有無と値を、**露出の抑止**は付かないことを assertion にする。一覧に載らないヘッダーは正規化の出力に残らないので record にも assertion にも入らない（`Date` 等の揮発と秘密の値を持ち込まない）
- **record にも秘密の値と要求ごとに変わる値を残さない**——録画は Git に入り、`parity-diff` の現側は録画から読むので、比べる前の変換では間に合わない。
  record するヘッダーは、同梱 [`../scripts/header-normalize.mjs`](../scripts/header-normalize.mjs) の `normalizeHeaders` を**通した出力だけ**を書く
  （規則の正本はスクリプト冒頭のコメント。ここへ転記しない。`parity-diff` も新側の応答を同じスクリプトで正規化してから比べるので、規則を 2 か所に書かない）。
  スイートからは `trait-capture.mjs` と同じく `suite.tools` のコピー専用ディレクトリ（既定 `<parity_suite_dir>/parity/lib/tools/vendor/`）へコピーして import し、
  一覧は `loadHeaderList(<リポジトリのルートから解決した .replace/survey.md の絶対パス>)` で読む（`.replace/` ごと見つからないパスは「一覧が無い」ではなく入力の誤りになる）
  （ファイルを自分で読んで `parseHeaderList` へ渡さない——survey.md が無いときの「一覧が無い」への変換を通らない）。受け取れる形は `allHeaders()`・`headersArray()`・HAR の `headers` のどれでもよい（取得経路で名前の表記が違っても同じ出力になる）。
  `parseHeaderList` が `NoHeaderListError` を投げたら下の「一覧が無い」の項へ進む（一覧を推測で作らない）。それ以外の例外（付け手の欄が空・語彙外）は一覧を直してから採る。
  **使ったコピーのパス・`VERSION`・録画に使った一覧（`--list` の出力）を `metadata.json.differ.header_normalize` に記録する**（`suite.tools` はスイートの指紋が読むパスなので版を混ぜない）——
  `parity-diff` は新側を同じ版・同じ一覧で正規化できるときだけヘッダーを比べる（版が違うと規則の差が、一覧が違うと足された・外されたヘッダーが現新の差分に化ける）。
  CLI は**記録したプロジェクト側コピーから**起動する（`node <differ.header_normalize.path> --survey .replace/survey.md <headers.json>` で正規化した JSON、`--list` で比べるヘッダー名の配列を出力。
  スキルディレクトリの同梱版から起動しない——`gh skill update` で同梱版だけ上がると、記録した版と実行した版が食い違う）。終了コード 0=出力 / 2=入力の誤り / 3=一覧が無い
- **付け手が `不明` の行は assertion にしない**（`current.origin: received-assets` で、再構築の既定値かもしれないもの）。固定すると再構築の既定値を現行の仕様として守ることになる。
  同じヘッダーに付け手の決まった行と `不明` の行が混ざる場合、正規化はそのヘッダーを録画に残さない（応答の種類を区別できないため）。決まった行の応答は、そのヘッダーの値を直接 assertion にする（`Set-Cookie` は同じスクリプトの `parseSetCookie`、CSP は `maskNonce` を通した値で書き、秘密を assertion に残さない）
  対象 slug の応答に当たる行を `gaps.md` に未検証として残し、先方の確認で付け手が確定したら assertion にする
- **所有者 slug が対象 slug の行**（どの機能にも属さない静的ファイル・404 の応答）は、その応答を採って同じく assertion にする。所有者が空欄の行は推測で引き受けない（所有者の確定は `replace-strategy` の `setup` の工程）
- **一覧が無い**（`.replace/survey.md` が無い・7 節が無い・本文が「未測定（理由）」の 1 行・テンプレートの例示行〈`（例）`〉が残る。`loadHeaderList` が `NoHeaderListError` を投げる）なら
  停止せず、対象 slug の応答のヘッダーを現行から採って防御ヘッダーの有無を `gaps.md` に未検証として記録し、`replace-strategy` の測定のやり直しを促す（一覧の代わりに自分で横断の一覧を作らない——付け手の判定と所有者の確定は `setup` の工程）
- 一覧の値と現行で採った値が食い違ったら（一覧の後に現行の設定が変わった等）、推測でどちらかに寄せず、現行で採った値で assertion を書き、食い違いを `gaps.md` に残して一覧の採り直しを促す

## 要求単位を確定したら features.md へ書き戻す

record/replay は現行 API の**要求と応答を実際に観測する**ため、`.replace/features.md` の「要求単位の根拠」列に `推定` で残った口を確定できる位置にいる。
**確定を観測した本人が書き戻さないと、その口は `status` の未検証領域に永久に残る**（採番は特性化より先に来るので、未実測の口は起票時点から `推定` で入っている）。

- **対象の口は特性化に入る前に features.md から拾う**——対象 slug の行で根拠が `推定` の口と、API 列にあるのに根拠のエントリが対応づかない口。
  拾わずに始めると、観測しているのに列が更新されない
- 確定できたら **`replace-strategy evidence --feature <slug> --endpoint <口> --evidence "実測: <観測した操作と条件>（母集合=… / 1 行=… または 1 要求が扱う対象=…。根拠: API の実動作）"`** を実行する。
  **本スキルは `.replace/features.md` を自分では書かない**（書き戻しの経路は 1 本だけにする。正本は `replace-strategy` の `references/evidence.md`）。
  **`replace-strategy` が未インストールで委譲先に到達できないときも自分で書かず**、確定した口と根拠を報告して導入を促す
- **観測が要求単位まで届かなかった口は `推定` のまま残す。** 書き込みの口は**1 要求が扱う対象と失敗時の巻き戻し範囲**まで観測して初めて確定する——
  成功応答を 1 本録っただけで `実測` へ上げると、その口は未検証領域から落ちたまま外部単位が未知で残る
- 残した口のうち**測るまで機能を閉じさせないもの**は `metadata.json` の `unmeasured` へ `disposition: blocking` で宣言し、`gaps.md` にも同じ文言で残す。
  **そのエントリの `endpoint` に口を完全一致で書く**——書かないと機械検査（`replace-strategy` の `scripts/evidence-gap-check.mjs`）が宣言として数えない
  （正本は [`coverage.md`](coverage.md)「未測定を機械可読にする」）。**宣言が無いと、`parity-replace` の完了判定は「確定できなかった」と「書き戻しを忘れた」を区別できない**
- 観測した要求単位が**API 列に書いた口と食い違う**場合は、根拠だけを直さず口の見直し（`replace-strategy issues` の再突き合わせ）へ回す——
  口の変更は Issue 本文・スイート・新側実装へ波及する

## 横断 API モード

横断 API Issue（リソース単位）から呼ばれた場合は、**画面を伴わない API のみの特性化**として動く。**スイートは一度だけ書いて共有する**（消費側の機能ごとに重複して書かない）。

## バッチモード

バッチ Issue から呼ばれた場合:

- ゴールデンデータセット（＋入力ファイル）を入力に**現行バッチを走らせ、出力（DB 状態・生成ファイル）を現行ベースラインとして捕捉する**
- **画面駆動の特性化は行わない。** 生成ファイルの捕捉観点は [`coverage.md`](coverage.md) の副作用出力に従う
- **バッチはブラウザを経由せずサーバのファイルシステムへ書く。** バイト列の取得経路（ファイルシステム直読み）と形式別の扱いは
  `replace-strategy` の `references/file-io.md` が正本。到達性は同スキルの `references/measurement.md` で実測済みの値を使う
- 書き込みを伴うため [`data-discipline.md`](data-discipline.md) の規律（復元 → 一意プレフィックス＋後始末 → hermetic でない旨の明示）に従う

## データの扱い

**正本は [`data-discipline.md`](data-discipline.md)**（feature / api-resource / batch の全モード共通）。ここへ転記しない。

- 要点: 読み取りを先に、書き込みは復元可能な環境で、復元できないなら一意プレフィックス＋後始末、後始末できないなら承認を得て「hermetic でない」と明示する
- **同ファイルを読めない場合は、書き込み系の特性化を実行せず停止する**（規律を思い出しで代替せず、参照先の所在をユーザーに確認する）
