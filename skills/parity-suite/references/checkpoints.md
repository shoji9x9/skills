# 実行フローの区切りと大きな成果物の書き方

**1 つの文脈で手順 1〜9 を最後まで回さない。** 読んだ参照・スペック・書いた成果物の本文は文脈に積まれ続け、
後半のターンほど高くなる（費用はおおよそ `ターン数 × 文脈長` で、合計はターン数の 2 乗で増える）。
文脈を自分では縮められない実行形態（subagent 等）では特に効く——実測では 1 機能の手順 1〜9 で文脈長が 4.5 万から 68 万まで一度も縮まず、
キャッシュ読み込みが約 2 億トークンに達し、それでも手順 9 の途中で止まった（Issue #468）。

塞ぎ方は 2 つ: **区切りで止めて新しい文脈から再開する**（下記「区切り」）、**大きな JSON を本文ごと書かない**（下記「大きな JSON 成果物は 1 行ずつ書く」）。

## 区切り

区切りは「その時点で揃っている成果物だけから次の手順を始められる境目」で、3 つある。

| 区切り | 位置 | 揃っている成果物 | 次の手順 | 次の手順が読む参照 |
|---|---|---|---|---|
| `authored` | 手順 5 の後 | スイート（マッピング層・期待値解決層・操作アダプタ・手書き aria・API 特性化）、`auto-wait-check.mjs` 通過、feature モードでは `component-coverage.json`（`coverage-expand.mjs --write` 通過・`visual_state_coverage.rows` の撮る／撮らない）と `reactions.json`（観測の記録） | 6 | [`baseline.md`](baseline.md)、[`locator-mapping.md`](locator-mapping.md)「side 専用スペックは相手側の project から `testIgnore` で除外する（両向き）」 |
| `captured` | 手順 6 の後 | 視覚ベースライン、`metadata.json` の `noise_baseline`・`capture_conditions`（`states`・`popup_inventory`・`overflow`・`scrollbars`・`capture_scope`）、`dimension-samples.json`。`noise-pass2/` は削除済み | 7 | [`strength-gate.md`](strength-gate.md) |
| `gated` | 手順 7 の後 | **`strength.md`**（ポジティブコントロールの結果・故障カタログ・注入ごとの結果・素通りした故障の扱い）。**手順 7 の中で書く**——手順 8 まで持ち越すと、新しい文脈へ強度ゲートの結果が渡らない | 8 | [`coverage.md`](coverage.md)「照合と宣言」「未測定を機械可読にする」、[`baseline.md`](baseline.md)「採取物の健全性」「状態を変えるスイートは 2 回続けて緑にする」 |

- **前の手順の参照を読み直さない。** 次の手順が読むのは `SKILL.md`・本ファイル・上表の参照と、上表の成果物だけ。前の手順で読んだ参照の中身は、成果物に落ちた形で引き継がれている
- **区切りに達したら、その場で記録する**（`--until` を渡していなくても記録する。途中で止まった実行を再開できるようにするため）:

  ```bash
  node <skill>/scripts/checkpoint.mjs record --dir .replace/parity/<slug> --at authored \
    --include <parity_suite_dir>/parity/<slug> --include <この機能のマッピング層・期待値解決層のファイル>
  ```

  - cwd は対象プロジェクトのルート（`verify` も同じ cwd で通す）。**コピーせずスキル配下から実行する**
  - `--include` は `authored` で**スイートのうちこの機能の置き場所**（スペック・マッピング層・期待値解決層）を渡す。後の区切りは前の区切りの `--include` を引き継ぐ。
    スイート全体（`<parity_suite_dir>/parity/`）を渡すと、別機能の作業で共有ライブラリが変わっただけで再開が止まる
  - ベースラインを `artifacts` の設定で `.replace/parity/<slug>/` の外へ置いたなら、`captured` でその置き場所を `--include` に足す
  - 前の区切りが記録されていなければ止まる（順に記録する）。前の区切りに戻って記録し直すと、後の区切りの記録は消える
  - **状態を変えるスペック（書き込み系・アップロード・バッチ）を走らせた手順では、[`data-discipline.md`](data-discipline.md) の後始末が効いたことを確かめてから記録する**——
    後始末の途中の状態を区切りとして残すと、再開した文脈は汚れたデータの上で測る

### `--until` と `--from`

- **`--until <区切り>`**: その区切りを記録したら止まり、区切りの名前と次の手順を報告して返る。呼び出し側は新しい文脈で `--from <区切り>` を渡して再開させる。
  文脈を縮められない実行形態で回すなら、区切りごとに `--until` で分けるのを既定にする（呼び出し側が文脈長を見張って途中で止めるより、成果物で引き継げる位置で止まる方が状態確認が要らない）
- **`--from <区切り>`**: 次の順で再開する
  1. `node <skill>/scripts/checkpoint.mjs verify --dir .replace/parity/<slug> --at <区切り>` を通す。exit 1 は「最後の区切りが違う」か「記録の後に成果物が足し引き・書き換えされた」で、
     **どこまで済んだかを成果物から決められない**ので再開しない。区切りの次の手順を最初からやり直し、区切りを記録し直す（手で差分を直して通さない）
  2. **手順 1〜4 は通し直す**（前提の判定・環境の稼働判定と起動・対象決定・保存先・データセットの照合）。安く、区切りの間に環境やデータセットが変わりうるため
  3. 書き込み系スペックを持つスイートは、[`data-discipline.md`](data-discipline.md) の復元から始める
  4. 区切りの次の手順から進む
- `--until` と `--from` は同じ実行に併用できる（`--from authored --until captured` で手順 6 だけを回す）。区切りの語彙に無い名前・`--until` が `--from` 以前の区切りなら停止する

## 大きな JSON 成果物は 1 行ずつ書く

**被覆表（`component-coverage.json`）・反応の被覆表（`reactions.json`）を Write で本文ごと書かない。** 書いた本文は文脈に残り、測るたびに書き直すと全文が積み増される
（実測では Write 31 回で約 22 万字が文脈に載った）。表は骨格（最上位のキー・配列は空）を 1 回だけ書き、行は [`../scripts/table-upsert.mjs`](../scripts/table-upsert.mjs) で 1 件ずつ足す・差し替える:

```bash
node <skill>/scripts/table-upsert.mjs upsert --file .replace/parity/<slug>/reactions.json --array operations --from - <<'JSON'
{ "id": "copy", "name": "共有ダイアログの Copy を押す", "trigger": "clickButton(Copy)", "...": "..." }
JSON
```

| 表 | `--array` | `--key` |
|---|---|---|
| `reactions.json` | `operations` | `id`（既定） |
| `reactions.json` | `feedback_calls.call_sites` | `file,line,column,pattern` |
| `component-coverage.json` | `cells` | `component,item,instance` |
| `component-coverage.json` | `components` / `components[id=<部品 id>].instances` | `id`（既定） |
| `component-coverage.json` | `visual_state_coverage.rows`（行そのものは `coverage-expand.mjs --write` が作る。撮る／撮らないの判断だけを差し替える） | `component,instance,required_by,kind` |

- **表を読み返すときも全文を読まない。** `get --match '<鍵の JSON>'` で 1 行、`keys` で鍵の一覧を引く。照合スクリプトの出力が名指した行だけを引いて直す
- **書き換えると最上位の `conformance` が消える。** 照合結果は表の内容に対する記録なので、書き換えた後は照合スクリプト（`coverage-expand.mjs --write` / `reaction-check.mjs --write`）を通し直す
- 鍵が欠けた・空・重複した行があると、書き込まずに exit 2 で止まる（別の行を上書きしない）。表を直してから使う
- **機械的に作れる値は、ツールかスペックに書かせて転記しない。** 寸法の採取値（`dimension-samples.json`）とスクロールバーの記録（`capture_conditions.overflow`）は測定スペックが、
  被覆表の候補と撮影状態の行は `coverage-expand.mjs --write` が、寸法の式は `dimension-fit.mjs --write` が、照合結果（`conformance`）は各照合スクリプトが書く
