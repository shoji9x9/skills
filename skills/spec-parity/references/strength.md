# 強度の確認（故障注入）

**この工程を飛ばすと、verify の収束の判定は意味を失う。**
assertion を弱めたテストも、assertion の無いテストも通る。スイートが現行で通ることは、新側の誤りを検出できる証拠にならない。
そこで、現行に既知の故障を注入し、スイートの assertion が赤くなることを確かめる。

考え方（ブラックボックスを前提にすること・注入しない状態で緑を確かめること・故障カタログを既知の回帰の分類から導くこと・「上流」の定義・カタログの外は射程外であること）は、
`parity-suite` の `references/strength-gate.md` に従う（ここへ転記しない）。
`parity-suite` の `references/strength-gate.md` を読めない場合は、強度の確認を通ったことにせず、`strength.validated` を `false` のまま止まる。
`spec-parity` が違うのは、次の 3 点である。

- 判定の単位は、スイートの assertion だけである。比べる差分ツール（画素・特性照合・aria の比較）とベースラインを持たないからである。
- スタイルの故障クラス（要素のスタイル・文字を持つ要素のスタイル・操作したときの手応え・コンテナのスクロールバー）は、カタログに入れない。
  `style_policy: free` では見た目の一致を確かめないので、スイートがそれを検出しないことは弱点ではない。`strength.md` の未検証の故障種別の表に、理由と一緒に書く。
- 注入には、e2e の `browser.route(...)` の `fulfill`（応答の書き換え。<https://e2e.com/docs/reference/web#route>）と `browser.evaluate`（DOM の書き換え。<https://e2e.com/docs/reference/web#evaluate>）を使う。

## カタログに入れる故障クラス

`parity-suite` の `references/strength-gate.md`「故障カタログ」の表のうち、スタイルに当たらないものを使う。機能が持たない故障クラスは、対象外として `strength.md` に書く。

| 故障クラス | 注入 |
|---|---|
| 値・件数・並び | 画面がデータを受け取る境界（API の応答。API が無ければ文書の応答）を `browser.route` で書き換える |
| 構造（role・見出しの階層・ランドマーク） | `browser.evaluate` で要素を置き換える・role を外す |
| 静的なラベル・placeholder | `browser.evaluate` で文言を書き換える |
| ドキュメントレベルの要素（`title`・`html[lang]`） | `browser.evaluate` で書き換える |
| 機能の在否 | コンテナを `hidden` にする・操作を結び付けない |
| 状態の切り替え・押した後に残るもの | 操作の後の属性（`aria-expanded`・`aria-selected`）と文言を、失敗する向きに書き換える |
| 操作の行き先 | 押した行のリンクの id を入れ替える・詳細の要求の行 id を書き換える |
| 状態表示・送っている間の押し直し | 応答の書き換えで状態を作ってから、表示を消す・足す |
| 待ちの欠落 | 応答を遅らせ、遅れて描画させる（ロケータの assertion が解決を待つことを確かめる） |

## 書き方と実行

- 故障ごとに、スイートの assertion をそのまま当てるテストを `tests/<slug>/strength/` に 1 つ書く。注入しない対照のテストも置く。雛形は `assets/strength.e2e.template.ts` である。
- 故障のテストを 2 件以上、同じ serial group（`describe(..., { serial: true })`）に入れない。e2e は、serial group のメンバーが 1 件失敗すると残りのメンバーを飛ばす（`serial-predecessor-failed`）ので、2 件目からの故障は `stopped` になる（<https://e2e.com/docs/reference/test#serial>）。
- 注入が描画まで届いたかを、assertion の前に確かめる。届いていなければ、`PARITY_INJECTION_NOT_APPLIED` を含むエラーを投げる。
  届かなかった注入は、弱い一式と同じ出力（緑）になるので、届いたことを確かめてから判定に進む。
- 計画（`.replace/parity/<slug>/strength-plan.json`。雛形は `assets/strength-plan-template.json`）に、対照と故障のテストの名前・故障クラス・注入が届いた観測を書く。
- 次の手順で実行し、`strength-check.mjs` に判定させる。テストのタイムアウトまで待たないよう、`--action-timeout` と `--assertion-timeout`（<https://e2e.com/docs/reference/cli#e2e-run>）を、現行が正常なら確実に解決する長さまで短くする。

```bash
E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 E2E_UPDATE_CHECK_DISABLED=1 PARITY_STRENGTH=1 \
PARITY_CURRENT_UI_URL=<現行の UI の URL> \
npx e2e run tests/<slug>/strength --target=current --action-timeout=5000 --assertion-timeout=5000 </dev/null
cp .e2e/report.json .replace/parity/<slug>/strength-report.json
node <spec-parity>/scripts/strength-check.mjs \
  --plan .replace/parity/<slug>/strength-plan.json \
  --report .replace/parity/<slug>/strength-report.json \
  --write .replace/parity/<slug>/metadata.json
```

`--write` なしで判定し直すとき（`verify` の手順 1）は、`--write` の代わりに `--metadata .replace/parity/<slug>/metadata.json` を渡す。書かずに、計画の slug が機能と同じかを照合する。

- 故障のテストが赤くなるので、e2e は exit 1 で終わる。判定に使うのは `strength-check.mjs` の終了コードである。
- `strength-check.mjs` は、最後の試行のエラーが `ASSERTION_FAILED`（assertion が時間内に成り立たなかったときのエラーの code。<https://e2e.com/docs/reference/expect>）の故障だけを検出（`red`）として数える。
  注入しても通った故障（`green`）は一式の弱点で、assertion を足して強めるか、`gaps.md` に送る。
  注入が届かなかった（`not-applied`）・実行が止まった（`stopped`。操作の失敗・タイムアウトを含む）・実行していない（`not-run`）故障は、弱さの証拠ではない。注入か実行を直して、もう一度実行する。
- exit 0 のときだけ、`metadata.json` の `strength.validated` が `true` になる。結果は `strength.md` にも人が読む形で書く（雛形は `assets/strength-template.md`）。
- assertion が変わるたびに実行し直す（抜けを埋めたとき・データセットを更新したときを含む）。
