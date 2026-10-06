# 実行フローの区切りと大きな成果物の書き方

文脈を自分では縮められない実行形態（subagent など）では、1 つの文脈で手順 1〜9 を最後まで進めない。
読んだ参照・スペック・書いた成果物の本文は文脈に積まれ続け、後のターンほど費用が高くなる。
費用はおおよそ `ターン数 × 文脈長` で、合計はターン数の 2 乗で増える。
実測では、そうした実行形態で 1 つの機能の手順 1〜9 を進めたところ、文脈長が 4.5 万から 68 万まで一度も縮まず、手順 9 の途中で止まった。

対策は 2 つある。区切りで止めて新しい文脈から再開すること（下の「区切り」）と、大きな JSON を本文ごと書かないこと（下の「大きな JSON 成果物は 1 行ずつ書く」）である。

## 区切り

区切りは、その時点でそろっている成果物だけから次の手順を始められる境目で、3 つある。

| 区切り | 位置 | そろっている成果物 | 次の手順 | 次の手順が読む参照 |
|---|---|---|---|---|
| `authored` | 手順 5 の後 | スイート（マッピング層・期待値解決層・操作アダプタ・手書きの aria・API の特性化）、`auto-wait-check.mjs` を通したこと。feature モードでは `component-coverage.json`（`coverage-expand.mjs --write` を通し、`visual_state_coverage.rows` の撮る／撮らないを決めたもの）と `reactions.json`（観測の記録） | 6 | [`baseline.md`](baseline.md)、[`locator-mapping.md`](locator-mapping.md)「side 専用スペックは相手側の project から `testIgnore` で除外する（両向き）」 |
| `captured` | 手順 6 の後 | 視覚ベースライン、`metadata.json` の `noise_baseline`・`capture_conditions`（`states`・`popup_inventory`・`overflow`・`scrollbars`・`display_axes`・`viewer_environment`・`browser`・`capture_scope`）、`dimension-samples.json`。`noise-pass2/` は削除済み | 7 | [`strength-gate.md`](strength-gate.md) |
| `gated` | 手順 7 の後 | `strength.md`（ポジティブコントロールの結果・故障カタログ・注入ごとの結果・素通りした故障の扱い）。手順 7 の中で書く。手順 8 まで持ち越すと、新しい文脈へ強度チェックの結果が渡らない | 8 | [`coverage.md`](coverage.md)「照合と宣言」「未測定を機械可読にする」、[`baseline.md`](baseline.md)「採取物の健全性」「状態を変えるスイートは 2 回続けて緑にする」 |

- 前の手順の参照を読み直さない。次の手順が読むのは、`SKILL.md`・このファイル・上の表の参照と、上の表の成果物だけである。前の手順で読んだ参照の中身は、成果物の形で引き継がれている
- 区切りに達したら、その場で記録する。`--until` を渡していなくても記録する。途中で止まった実行を再開できるようにするためである。

  ```bash
  node <skill>/scripts/checkpoint.mjs record --dir .replace/parity/<slug> --at authored \
    --include <parity_suite_dir>/parity/<slug> --include <この機能のマッピング層・期待値解決層のファイル>
  ```

  - cwd は対象のプロジェクトのルートにする（`verify` も同じ cwd で実行する）。スクリプトはコピーせず、スキルの中から実行する
  - `authored` の `--include` には、スイートのうちこの機能の置き場所（スペック・マッピング層・期待値解決層）を渡す。後の区切りは、前の区切りの `--include` を引き継ぐ。
    スイート全体（`<parity_suite_dir>/parity/`）を渡すと、別の機能の作業で共有のライブラリが変わっただけで、再開が止まる
  - 次の場合は止まる。判定は実パスで行う
    - `--include` が slug のディレクトリの中を指す
    - `--include` が slug のディレクトリを含む（祖先を渡した）
    - 2 つの `--include` が同じものを指す
    - 根の下のファイル・ディレクトリが、slug のディレクトリの中を指すシンボリックリンクである。slug のディレクトリの成果物をスイートとして数えると、スイートを 1 つも照合しないまま通るためである
  - ベースラインを `artifacts` の設定で `.replace/parity/<slug>/` の外へ置いたなら、`captured` でその置き場所を `--include` に足す
  - 前の区切りが記録されていなければ止まる。区切りは順に記録する。前の区切りに戻って記録し直すと、後の区切りの記録は消える
  - 前の区切りから、成果物が 1 つも足されず、書き換えられてもいなければ止まる。削除だけでは、進んだ証拠にしない。`--include` の根が空になっていても止まる
  - 状態を変えるスペック（書き込み系・アップロード・バッチ）を実行した手順では、[`data-discipline.md`](data-discipline.md) の後始末が終わったことを確かめてから記録する。
    後始末の途中の状態を区切りとして残すと、再開した文脈は汚れたデータの上で測ることになる

### `--until` と `--from`

- `--until <区切り>` を渡すと、その区切りを記録したら止まり、区切りの名前と次の手順を報告して返る。呼び出し側は、新しい文脈で `--from <区切り>` を渡して再開させる。
  文脈を縮められない実行形態で進めるなら、区切りごとに `--until` で分けるのをデフォルトにする。
  呼び出し側が文脈長を監視して途中で止めるより、成果物で引き継げる位置で止まるほうが、状態を確かめる手間が要らない
- `--from <区切り>` を渡すと、次の順で再開する
  1. `node <skill>/scripts/checkpoint.mjs verify --dir .replace/parity/<slug> --at <区切り>` を通す。
     exit 1 は、最後の区切りが違うか、記録の後に成果物が足された・消された・書き換えられたことを表す。
     どこまで済んだかを成果物から決められないので、再開しない。区切りの次の手順を最初からやり直し、区切りを記録し直す。手で差分を直して通さない。
     exit 2 は、記録そのものが `record` の作る形でないことを表す（前の区切りの欠け・スイートの根の欠け・`gated` に `strength.md` の指紋が無い、など）。`checkpoints.json` を手で直さず、`authored` から記録し直す
  2. 手順 1〜4 は通し直す（前提の判定・環境の稼働の判定と起動・対象の決定・保存先・データセットの照合）。
     どれも安く済み、区切りの間に環境やデータセットが変わりうるためである
  3. 書き込み系のスペックを持つスイートは、[`data-discipline.md`](data-discipline.md) の復元から始める
  4. 区切りの次の手順から進む
- `--until` と `--from` は、同じ実行で一緒に使える（`--from authored --until captured` で手順 6 だけを進める）。
  区切りの語彙に無い名前を渡したときと、`--until` が `--from` と同じかそれより前の区切りのときは止まる

## 大きな JSON 成果物は 1 行ずつ書く

網羅表（`component-coverage.json`）と反応の網羅表（`reactions.json`）は、Write で本文ごと書かない。
書いた本文は文脈に残り、測るたびに書き直すと全文が積み増される。実測では、Write を 31 回呼んで約 22 万字が文脈に載った。
表は骨格（最上位のキーと空の配列）を 1 回だけ書き、行は [`../scripts/table-upsert.mjs`](../scripts/table-upsert.mjs) で 1 件ずつ足すか差し替える。

```bash
node <skill>/scripts/table-upsert.mjs upsert --file .replace/parity/<slug>/reactions.json --array operations --from - <<'JSON'
{ "id": "copy", "name": "共有ダイアログの Copy を押す", "trigger": "clickButton(Copy)", "...": "..." }
JSON
```

| 表 | `--array` | `--key` |
|---|---|---|
| `reactions.json` | `operations` | `id`（デフォルト） |
| `reactions.json` | `feedback_calls.call_sites` | `file,line,column,pattern` |
| `reactions.json` | `side_effect_writes.sites` | `file,line,column,pattern` |
| `reactions.json` | `state_displays.pages` | `page` |
| `component-coverage.json` | `cells` | `component,item,instance` |
| `component-coverage.json` | `components` / `components[id=<部品 id>].instances`（id が `]` や `"` を含むなら `components[id="grid[mobile]"].instances` のように JSON の文字列で書く） | `id`（デフォルト） |
| `component-coverage.json` | `visual_state_coverage.rows`（行そのものは `coverage-expand.mjs --write` が作る。撮る／撮らないの判断だけを差し替える） | `component,instance,required_by,kind` |

- 表を読み返すときも、全文を読まない。1 行は `get --match '<鍵の JSON>'` で、鍵の一覧は `keys` で取得する。照合スクリプトの出力が名指しした行だけを取得して直す
- 表を書き換えると、最上位の `conformance` が消える。照合の結果は表の内容に対する記録なので、書き換えた後は照合スクリプト（`coverage-expand.mjs --write` / `reaction-check.mjs --tests <テスト一覧> --write`）を通し直す。
  `reactions.json` は、期待値か `covered_by` を変えると、監査の記録（`assertion_audit`）の指紋も合わなくなる。そのときは `--audit-sheet` から監査し直す。`covered_by` のスペックのファイルを書き換えた場合も同じである
- 鍵が欠けた行・空の行・重複した行があると、書き込まずに exit 2 で止まる（別の行を上書きしない）。表を直してから使う
- 機械的に作れる値は、ツールかスペックに書かせ、手で転記しない。
  寸法の採取値（`dimension-samples.json`）とスクロールバーの記録（`capture_conditions.overflow`）は測定のスペックが書く。
  網羅表の候補と撮影状態の行は `coverage-expand.mjs --write` が、寸法の式は `dimension-fit.mjs --write` が、照合の結果（`conformance`）は各照合スクリプトが書く
