# 収束の判定と差し戻し

`spec-parity verify` の収束は、同梱の [`../scripts/convergence-check.mjs`](../scripts/convergence-check.mjs) が判定する。
判定に使うのは、ツールの出力（e2e の結果・測定の記録・`compare` の結果）と、利用者の承認の記録だけである。モデルの主観を根拠にしない。

```bash
node <spec-parity>/scripts/convergence-check.mjs --slug-dir .replace/parity/<slug> --target <target> --write
```

- 終了コードは、0 が収束、1 が収束していない、2 が判定できない（前提の成果物が無い・形の誤り・結果が 0 件）である。
- `--write` は、`verify-metadata.json` の `converged` と `convergence` を書く。exit 2 のときも `converged: false` を書き、前の実行が残した `converged: true` を残さない。
  `converged` を手で `true` にしない。

## 収束の条件

次のすべてが成り立つときだけ収束する。

| 確かめること | 読むもの | 収束しない例 |
|---|---|---|
| 現行で通ったテストが、新側ですべて `passed` | `suite-report.json`（現行）と `new/<target>/suite-report.json`（新側） | 新側で `failed`・`timed-out`・`flaky`・`skipped`、新側の結果に無いテスト、現行の結果に無いテスト、新側の結果にある `suite.dir` の外のテスト |
| 記録した幅で横にはみ出さない | `metadata.json` の `capture_conditions` と `new/<target>/overflow.json` | はみ出し・未測定・幅の不一致 |
| 現行に無かった操作中のエラーが、要対応でも未説明でもない | `verify-metadata.json` の `runtime_errors`（`compare` の結果） | 要対応・未分類・承認の無い許容・根拠の無い環境ノイズ・記録の欠け・新側でスキップしたテスト（`skipped_tests`）・`tree` が無いか `new.tree` と違う |
| デザインの指摘がすべて「受け入れる」で承認がある | `design_review` と `approvals` | 「直す」が残る・承認が無い・点検の記録が無い・同じ承認が `approvals` に無い |
| 利用者が新側の画面を承認した | `human_review` と `approvals` | 承認の記録が無い・却下・同じ承認が `approvals` に無い |
| 未検証の一覧に、確かめないことが理由付きで載っている | `unverified` | `performance` が無い。現側で操作中のエラーを記録しなかった機能で `runtime_errors` が無い |
| `blocking` の未測定が無い | `metadata.json` の `unmeasured` | `disposition: blocking` が残る。語彙の外の値と、承認の記録が空の `accepted` も数える |
| 未解決の保留が無い | `pending_decisions` | `open`・`decided`（数え方の原本は `replace-strategy` の `references/autonomy.md`「保留の状態」） |

- スイート・横のはみ出し・操作中のエラーの比較・デザインの点検・人による確認の記録は、`verify-metadata.json` の `new.tree` と同じバージョンのものでなければ、古い記録として数える。
  比べるのは各記録の `tree` で、`tree` を持たない古い記録も、もう一度測る対象として数える。
  横のはみ出しの測定では `PARITY_COMMIT` で渡した値が入る `commit` を、操作中のエラーの比較では `compare --tree` で渡した値を比べる。
  `new.tree` の意味と取り方の原本は `replace-strategy` の `references/project-config.md`「新側のバージョンの記録」である。`new.commit` は人が追うための値で、比べない。
  `verify-metadata.json` の `new.tree` が無いときと `none` のときは、どの記録のバージョンも特定できないので、判定できないとして exit 2 にする。
  `parity-replace` が新側を green にした記録（`replace-metadata.json`）は、前提として確かめる。
  記録の鍵（`slug`・`new.target`・`new.tree`）のどれかが、`metadata.json` の `slug`・`--target`・`verify-metadata.json` の `new.tree` と違うとき（欠落と型の誤りを含む）は、判定できないとして exit 2 にする。
  `replace-metadata.json` の `new.dirty` が `false` でないときも同じである。どちらも、verify の手順をやり直しても直らない。
  その後で、`verify-metadata.json` の `new.dirty` が `false` でないとき（欠落・型の誤り・雛形の値のままを含む）も、記録が `new.tree` のバージョンのものと言えないので、判定できないとして exit 2 にする。
  `replace-metadata.json` の確認より後にするのは、commit しても直らない鍵の違いを先に示すためである。
  変更を退避して green にしたバージョンに戻せば、verify をやり直して直る。退避は `.replace/` を除いた pathspec で行う（形は同じ節にある）。
  変更を commit したなら、`new.tree` が green の記録と違うので、green を記録し直してから verify する。記録だけを commit したときは `new.tree` が変わらないので、そのまま判定できる。
  新側を直したら、これらをやり直す。操作中のエラーの記録（`run-<回>/` のファイル）は新側のバージョンを持たないので、verify のたびに記録のディレクトリを消してから採り直し、採ったときの `new.tree` を `compare --tree` に渡す。
- スイートの結果は、`metadata.json` の `suite.dir` の下のテストだけを数える。結果の `file` と書かれたままの字面で前方一致を比べるので、`suite.dir` は結果の `file` と同じ起点・同じ形（`tests/<slug>/`）で書く。
  書き方の揺れ（先頭の `./`・区切りの `\`・続いた `/`・`.` と `..` の区間・絶対パス）は正規化せず、`suite.dir` に書かれていれば exit 2 にする。強度の計画のテストの名前も、結果の `file` と同じ字面で書く。
  雛形のとおり設定（`e2e.config.ts`）をリポジトリのルートに置いた実行（e2e 0.23.0）では、`file` はルートからのパス（`tests/<slug>/...`）だった。設定を別の場所に置いたときの `file` の起点は確かめていない。新側の結果にその外のテスト（ほかの機能のテスト）があれば、スイートのパスで絞って採り直す（`remeasure`）。
  現行の結果にその外のテストがあるときと、`suite.dir` が無い・雛形の値のままのときは、判定できないとして exit 2 にする。
  同じテストの結果が 2 つある結果（`--repeat-each` や複数の agent で実行したもの）も、どちらかを採らずに exit 2 にする（`strength-check.mjs` と同じ扱い）。
- デザインの指摘を受け入れた承認と人による確認の承認は、`approvals` に同じ値（バージョン・承認した人・日時・理由か返事）の要素が積まれていなければ、承認として数えない（`approval`）。
  `approvals` の形と書き方は [`design-review.md`](design-review.md)「承認の記録」にある。`approvals` が縮んでいないかは、下の追記専用の成果物の確認が見る。
- `unmeasured` の扱いは、`parity-diff` の収束の判定（`artifact-health-check.mjs --stage diff`）と同じである。
  キーごと無い成果物と `declared: false`（理由が要る）は判定せず、`verify-metadata.json` の `convergence.checks.unmeasured` に `judged: false` と理由を残す。
- 保存された `ok` や件数は信じない。横のはみ出しは測定の記録から、操作中のエラーは署名ごとの分類から判定し直す。
  前提の強度の確認も、`metadata.json` の `strength.validated` を信じず、`strength-plan.json` と `strength-report.json` から判定し直す。通らなければ判定できないとして exit 2 にする。
- 雛形の値（`<...>`）のままの承認・日時は、書いていないものとして扱う。
- flaky（リトライで通った）は、新側で安定して通ったとは言えないので、通ったものとして扱わない。
- 現行でスキップしたテストは比べない。横のはみ出しと故障注入のテストは、決まった環境変数を渡した実行でだけ動くので、ここに当たる。
  現行の結果のテストがすべてスキップなら、比べるテストが 0 件なので、判定できないとして exit 2 にする。
- `convergence-check.mjs` が exit 0 でも、追記専用の成果物が縮んでいれば、収束として報告しない。
  確かめる対象は、`replace-strategy` の `assets/append-only-manifest.json` に項目があるものだけである。
  このスキルの成果物では、`.replace/parity/<slug>/` の `gaps.md`・`metadata.json` の `unmeasured.entries`・`new/<target>/verify-metadata.json` の `approvals` が当たる。
  ほかに、features.md・設定ファイル・`.replace/dataset/metadata.json` の `changes` など、スキル群で共通の成果物が当たる。
  `verify-metadata.json` のほかの欄（`design_review`・`human_review` の承認の欄を含む）と `verify.md` は、verify のたびに書き直すので一覧に無い。承認の欄の書き換えは、収束の判定が `approvals` との食い違いで検出する。
  `node <replace-strategy>/scripts/append-only-check.mjs --root . --base <機能に着手した時点のバージョン>` を実行し、exit 0 以外なら止めて、過去の決定を元に戻す。
  デフォルトの `HEAD` は使わない（書き直しを commit した後は作業ツリーと同じになり、失われた決定を検出できない）。一覧の原本は `replace-strategy` の `assets/append-only-manifest.json` である。
  `replace-strategy` のスクリプトに届かないときも、合格として扱わずに止まる。
- `convergence-check.mjs` が exit 0 でも、意図的差異の保留（設定の `intentional_diffs.pending`）の棚卸しが済んでいなければ、収束として報告しない。
  棚卸しの対象・記録の形・数え方の原本は、`parity-diff` の `references/convergence.md`「`intentional_diffs.pending` の棚卸し」である（ここへ転記しない）。
  `style_policy: free` の機能でも、この機能に帰属する保留・横断の保留（`cross-cutting`）・帰属不明の保留が残っていれば、ここで棚卸しする。棚卸しをしないと、すべての機能が `free` のプロジェクトでは、横断の保留を誰も棚卸ししない。
  記録は `verify-metadata.json` の `intentional_diffs_pending` に書き、`parity-diff` の `scripts/pending-triage-check.mjs` で数え直す。
  `node <parity-diff>/scripts/pending-triage-check.mjs --registries <registries.json> --metadata .replace/parity/<slug>/new/<target>/verify-metadata.json --features .replace/features.md` が exit 0 以外なら、棚卸しを済ませてから判定し直す。
  `registries.json` の組み立て方は、`parity-diff` の `references/normalize.md`「registries.json の組み立て」にある。`parity-diff` の文書かスクリプトに届かないときも、合格として扱わずに止まる。

## 理由の分類と次の工程

`convergence.reasons[]` の `category` で、次の工程を決める。

| category | 意味 | 次の工程 |
|---|---|---|
| `send-back` | 新側の実装に要対応が残る（通らないテスト・はみ出し・要対応のエラー・直すデザインの指摘・却下） | `verify.md` を差し戻しの入力にして、同じ `--target` の `parity-replace` へ渡す |
| `remeasure` | 記録が無い・古い・欠ける | `verify` の該当する手順をやり直す。新側は直さない |
| `approval` | 利用者の承認・判断を待っている | 利用者に確かめる（[`user-confirmation.md`](user-confirmation.md)）。自律実行では保留に記録する |

- 差し戻しの前に、`send-back` の理由を `verify.md` の差し戻す内容の表に並べる。ページ・論理名・測定値など、`parity-replace` が直す先を見つけられる情報を添える。
- 反復の回数の記録と上限の管理は、`parity-replace` がその target の `replace-metadata.json` の `loop.*` で行う。上限を超えていたら、差し戻さずに止まって利用者へ上げる。
- 選んだ target の `on_diff` のドキュメントが起票を指示するなら、差し戻さずに `issue-create` に要約を渡して起票し、止まる（`replace-strategy` の `references/project-config.md`「`on_diff`」）。
  従った `on_diff` のドキュメントのパスを、`verify.md` に書く。ガードレールは、同じ節の「ガードレール」に従う。`replace-strategy` の文書を読めないときは、`on_diff` に従わずに止まる。
- 収束したら、`parity-replace` が `later`（`owner` がこのスキル）で残した受け入れ条件の行を再取得するよう報告する。
  `issue-start <番号> --acceptance --out .replace/parity/<slug>/new/<target>/acceptance.json` で表を作り直す（このスキルは表を書かない）。
