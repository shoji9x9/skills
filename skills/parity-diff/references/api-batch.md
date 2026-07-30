# 横断 API モード・バッチモード

`metadata.json.mode` が `api-resource` / `batch` のとき、**画面系 3 経路（画素・特性照合・aria）は動かさない**。構造・バイト比較を決定論的に行う。

## 横断 API モード（mode: api-resource）

`parity-suite` が record/replay で特性化した現行応答（`metadata.json.suite.specs` のスイートと録画）を**正**とし、同一リクエストを新側へ発行して応答を突き合わせる。

- 同一リクエスト（パス・クエリ・ボディ）を選択 target の API baseURL へ発行する——`.replace/parity/<slug>/new/<target>/replace-metadata.json` の `new.api_url`（target の `api_url`。省略時は `new.ui_url`）。
  記録が `"runtime"` の場合は前提確認（preflight）の target 解決時に解決済みの値を使う（同一実行内で再解決しない）
- 突き合わせ対象: ステータス・ボディ・並び順・ページング・エラー応答
- **`references.db_semantics`（collation 等の意味論差）を並び順差の判断材料に読む。** 現行 DB と新 DB で並び順が変わりうる箇所を意図的差異として扱えるようにする
- **揮発項目（生成日時・トークン等）は `intentional_diffs` で除外してから比較する**
- 同梱 [`../scripts/json-normalize-diff.mjs`](../scripts/json-normalize-diff.mjs) で正規化＋決定論的比較を行う

  ```text
  node <スキルディレクトリ>/scripts/json-normalize-diff.mjs <current.json> <new.json> [--ignore <ドット記法パス>...] [--sort-arrays <パス>...]
  ```

  - `--ignore` で揮発項目を除外する（`*` セグメントで配列要素・オブジェクト値の全走査に効く。例 `data.*.updated_at`）
  - `--sort-arrays` は**並び順が意図的差異として宣言されている場合のみ**指定する（宣言なしに順序差を潰さない）
  - 出力は差分パスと both 値の JSON 配列。終了コード 0=差分なし / 1=差分あり / 2=入力エラー

## バッチモード（mode: batch）

視覚経路は使わない。現行ベースライン（`parity-suite` が捕捉した DB 状態・生成ファイル）と新側バッチの出力を決定論的に構造・バイト比較する。

- ファイル: 文字コード・BOM・改行・列順・書式を比較する。**CSV・固定長・テキストはバイト列（`Buffer`）比較**が最も忠実（復号してから比べると encoding・BOM の差が消える）
- xlsx: 実体が ZIP で zip 内に揮発項目が入るため**バイト一致を取らず**、シート × セル値と構造で比較する
- 帳票 / PDF: 抽出テキストと構造を比較する（バイト一致は求めない）
- **解析ツールは `metadata.json.differ.file_extract` の記録値を使う。** 自分で選び直さない——現側と新側で抽出ツールが変わると、差分がツール差か実装差か切り分けられない。
  記録が無い（現側の捕捉時に選定されていない）場合は推測で導入せず、`parity-suite` へ戻す。取得経路・形式別の扱い・選定の正本は `replace-strategy` の `references/file-io.md`
- **バイト列の取得は現側と同じ経路で行う**（batch はファイルシステム直読み、画面駆動はダウンロードイベントまたは `page.request`）。経路が違うと `Content-Disposition` 由来のファイル名・内容変換の差が混ざる
- **揮発項目（生成日時等）は意図的差異レジストリで除外してから比較する**
- **メール・外部連携はスコープ外**（対象・対象外の一覧は `replace-strategy` の `references/scope.md` が正本）
- 構造化データ（xlsx / PDF の抽出結果を JSON 化したものを含む）の比較には `json-normalize-diff.mjs` を流用できる（揮発項目は `--ignore` で除外する）

## データ起因の差の扱い

- 新側 DB への投入は `golden-dataset` フェーズ B 済みが前提（三者一致は [`preflight.md`](preflight.md)）
- データ起因の差で `.replace/dataset/verification.md` のフェーズ B 節に説明済みのものは**許容**する
- **説明されていないデータ差は `golden-dataset`（フェーズ B）へ差し戻す**（差分器の問題ではなくデータの問題として扱う）
