# 横断 API モード・バッチモード

`metadata.json.mode` が `api-resource` / `batch` のとき、**画面系 3 経路（画素・特性照合・aria）は動かさない**。構造・バイト比較を決定論的に行う。

## 横断 API モード（mode: api-resource）

`parity-suite` が record/replay で特性化した現行応答（`metadata.json.suite.specs` のスイートと録画）を**正**とし、同一リクエストを新側へ発行して応答を突き合わせる。

- 同一リクエスト（パス・クエリ・ボディ）を新側 `replace-metadata.json.new.url` へ発行する
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

- ファイル: 文字コード・BOM・改行・列順・書式を比較する
- 帳票 / PDF: 抽出テキストと構造を比較する（バイト一致は求めない）
- **揮発項目（生成日時等）は意図的差異レジストリで除外してから比較する**
- **メール・外部連携はスコープ外**（`replace-strategy` の測定スコープに従う）
- 構造化データの比較には `json-normalize-diff.mjs` を流用できる

## データ起因の差の扱い

- 新側 DB への投入は `golden-dataset` フェーズ B 済みが前提（三者一致は [`preflight.md`](preflight.md)）
- データ起因の差で `.replace/dataset/verification.md` のフェーズ B 節に説明済みのものは**許容**する
- **説明されていないデータ差は `golden-dataset`（フェーズ B）へ差し戻す**（差分器の問題ではなくデータの問題として扱う）
