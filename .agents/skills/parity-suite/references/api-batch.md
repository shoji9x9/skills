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
