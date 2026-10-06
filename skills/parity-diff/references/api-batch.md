# 横断 API モードとバッチモード

`metadata.json.mode` が `api-resource` か `batch` のときは、画面を比べる 3 つの比較方法（画素・特性照合・aria）を使わない。
構造とバイト列を、決定論的に比べる。

## 横断 API モード（mode: api-resource）

`parity-suite` が record/replay で特性化した現行の応答（`metadata.json.suite.specs` のスイートと録画）を正とする。
同じリクエストを新側へ送り、応答を突き合わせる。

- 同じリクエスト（パス・クエリ・ボディ）を、選んだ target の API baseURL へ送る。
  送り先は `.replace/parity/<slug>/new/<target>/replace-metadata.json` の `new.api_url` である（target の `api_url`。省いたときは `new.ui_url`）。
  記録が `"runtime"` のときは、前提確認（preflight）で target を解決したときの値を使う。同じ実行の中で解決し直さない
- 突き合わせるもの: ステータス・ボディ・並び順・ページング・エラー応答と、応答ヘッダーのうち `.replace/response-headers.json`（横断の応答ヘッダーの一覧）に載るもの
  - 防御のヘッダーは有無と値を比べ、露出を抑えるヘッダーは付かないことを比べる。
  - `json-normalize-diff.mjs` はヘッダーの値の一部だけを伏せることができず、差分の両側の値を出力する。
    そのため、渡す前に新側の応答ヘッダーを正規化する。使うのは、現側の録画と同じ `parity-suite` の `header-normalize.mjs`（`metadata.json.differ.header_normalize.path` のコピー。版が録画とそろう）である。
  - 現側は、録画がすでに正規化されている。
  - 絞り込み（付け手が `unknown` の行は比べない）、名前の小文字化、`Set-Cookie` と `nonce-` の伏せ方の規則は、そのスクリプトで定義する。ここへ転記しない。
  - 一覧は、`.replace/response-headers.json` を `--header-list` で渡して読ませる。呼び方と終了コードの原本は、`parity-suite` の `references/api-batch.md`「応答ヘッダー」にある
- 次のどれかに当たれば、ヘッダーを比べず、差分にも数えない。
  - `metadata.json.differ.header_normalize` が無い（`null` を含む）。
  - 記録した `version` が、記録した `path` のコピーの `VERSION` と食い違う。
  - 記録した `version` が `"1"` である（一覧を `survey.md` の表から読む旧版で、`--header-list` を受け付けない）。
  - 記録した `headers` が、今の一覧（同じコピーの `--header-list .replace/response-headers.json --list` の出力）と食い違う。

  版が違うと、規則の差が「現新の差」として出る。一覧が違うと、録画の後に足したヘッダーや外したヘッダーが「現新の差」として出るか、外したヘッダーの後退を警告なしに見落とす。
  新側の正規化も、記録した `path` のコピーで行う（スキルのディレクトリに同梱した版を使わない）。
  比べなかったことを `diff.md` の未検証領域に残し、`parity-suite` で録り直すよう促す。
  一覧が無い（正規化が exit 3 で終わる）ときも、同じように比べずに未検証領域に残す
- 現側の機能を、`parity-suite` の手順の改訂 2 より前に特性化していた場合（`.replace/parity/<slug>/metadata.json` の `run.procedure_revision` が 2 未満か、キーが無い）は、次のように扱う。
  - 改訂番号で判定する。録画にヘッダーが無いことでは判定しない。改訂 2 でも、一覧のヘッダーが付かない応答の録画は空になるので、ヘッダーの有無で判定すると露出を抑えるヘッダーの後退を見落とす。
  - ヘッダーを比べず、差分にも数えない。比べると、新側が正しく付けた防御のヘッダーがすべて「現側に無い差」として出て、収束しなくなる。
  - 比べなかったことを `diff.md` の未検証領域に残す。当て直すかどうかは、`replace-strategy` の `.replace/procedure-changes.md` の判断に従う
- `references.db_semantics`（collation などの意味論の差）を、並び順の差を判断する材料として読む。現行の DB と新しい DB で並び順が変わりうる箇所を、意図的差異として扱えるようにする
- 揮発項目（生成日時・トークンなど）は、`intentional_diffs` で除いてから比べる
- 同梱の [`../scripts/json-normalize-diff.mjs`](../scripts/json-normalize-diff.mjs) で正規化し、決定論的に比べる

  ```text
  node <スキルディレクトリ>/scripts/json-normalize-diff.mjs <current.json> <new.json> [--ignore <ドット記法パス>...] [--sort-arrays <パス>...]
  ```

  - `--ignore` で揮発項目を除く。`*` のセグメントは、配列の要素とオブジェクトの値をすべてたどる（例: `data.*.updated_at`）
  - `--sort-arrays` は、並び順が意図的差異として宣言されているときだけ指定する。宣言なしに順序の差を消さない
  - 出力は、差分のパスと両側の値を並べた JSON 配列である。終了コードは、0 が差分なし、1 が差分あり、2 が入力の誤りである

## バッチモード（mode: batch）

画面を比べる方法は使わない。
現行のベースライン（`parity-suite` が取得した DB の状態と生成ファイル）と、新側のバッチの出力を、決定論的に構造とバイト列で比べる。

- ファイル: 文字コード・BOM・改行・列順・書式を比べる。CSV・固定長・テキストは、バイト列（`Buffer`）で比べるのが最も忠実である。復号してから比べると、encoding と BOM の差が消える
- xlsx: 実体が ZIP で、zip の中に揮発項目が入る。そのためバイト列の一致は求めず、シート × セルの値と構造で比べる
- 帳票・PDF: 抽出したテキストと構造を比べる（バイト列の一致は求めない）
- 解析ツールは、`metadata.json.differ.file_extract` に記録した値を使う。自分で選び直さない。
  現側と新側で抽出ツールが変わると、差分がツールの差か実装の差かを切り分けられない。
  記録が無い（現側を取得したときに選んでいない）ときは、推測で導入せず、`parity-suite` へ戻す。
  取得方法・形式ごとの扱い・選び方の原本は、`replace-strategy` の `references/file-io.md` にある
- バイト列は、現側と同じ方法で取得する（batch はファイルシステムから直接読む。画面の操作で得るものは、ダウンロードのイベントか `page.request` で得る）。
  方法が違うと、`Content-Disposition` から決まるファイル名や、内容の変換の差が含まれる
- 揮発項目（生成日時など）は、意図的差異のレジストリで除いてから比べる
- メールと外部連携は対象外である（対象と対象外の一覧の原本は、`replace-strategy` の `references/scope.md`）
- 構造化したデータ（xlsx や PDF から抽出した結果を JSON にしたものを含む）は、`json-normalize-diff.mjs` でも比べられる（揮発項目は `--ignore` で除く）

## データが原因の差の扱い

- 新側の DB への投入は、`golden-dataset` のフェーズ B が済んでいることが前提である（[`preflight.md`](preflight.md)「データセットバージョンの三者整合」）
- データが原因の差のうち、`.replace/dataset/verification.md` のフェーズ B の節で説明済みのものは許容する
- 説明されていないデータの差は、`golden-dataset`（フェーズ B）へ差し戻す。差分ツールの問題ではなく、データの問題として扱う
