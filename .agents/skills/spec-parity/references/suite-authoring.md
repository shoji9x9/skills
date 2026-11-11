# スイートの書き方

`spec-parity suite` が書く e2e のスイートの置き場所・side の対応表・assertion の書き方・API の特性化を定める。
スイートは、現行と新側のどちらにも当てられる合否の基準である。合否はロケータと assertion で決定論的に書き、モデルに「差分があるか」を聞かない。

## 置き場所

| ファイル | 場所 | 雛形 |
|---|---|---|
| e2e の設定 | プロジェクトのルートの `e2e.config.ts`（既にあれば、targets・initScripts・reporters を足す） | `assets/e2e.config.template.ts` |
| side の対応表 | `tests/parity/sides.ts` | `assets/sides.template.ts` |
| スイートの基（操作中のエラーを取り出す fixture） | `tests/parity/test.ts` | `assets/test.template.ts` |
| 操作中のエラーの init script と reporter | `tests/parity/runtime-errors-init.js`・`tests/parity/runtime-errors-reporter.ts` | `assets/runtime-errors-init.template.mjs`・`assets/runtime-errors-reporter.template.ts` |
| スイート | `tests/<slug>/*.e2e.ts` | — |
| 横のはみ出しを測るテスト | `tests/<slug>/overflow.e2e.ts` | `assets/overflow.e2e.template.ts` |
| 故障注入のテスト | `tests/<slug>/strength/*.e2e.ts` | `assets/strength.e2e.template.ts` |

- 置き場所は、e2e の設定の `tests`（テストのファイルを集める glob。デフォルトは `tests/**/*.e2e.ts`。<https://e2e.com/docs/reference/config#tests>）で決まる。
  プロジェクトが既に `tests` の設定を持つなら、その範囲の中に置き、実際のパスを `metadata.json` の `suite` に記録する。
- 設定の `parity_suite_dir` は読まない。`parity_suite_dir` は Playwright のパリティスイートの置き場所で、`style_policy: free` でも横断 API とバッチのスイートを `parity-suite` がそこに置くからである。
  e2e のスイートを同じディレクトリに置かず、Playwright のスイートと分ける。
- `tests/parity/` の部品は、機能をまたいで 1 組だけ置く。既にあれば上書きせず、そのまま使う。
- スイートのすべてのテストは、`tests/parity/test.ts` の `test` を import する。`@e2e-dev/web` の `test` を直接使うテストは、操作中のエラーが記録されない。
- 横のはみ出しと故障注入のテストは、テストの本体の中の `test.skip()` で、決まった環境変数を渡した実行でだけ動かす。
  それ以外の実行（green の確認・操作中のエラーの記録）では、現行でも新側でもスキップされるので、収束の判定は比べない。

## side の対応表

- e2e の設定の targets は、`current` と `new` の 2 つにする。URL は、選んだ target の `url`・`api_url` を `PARITY_CURRENT_UI_URL`・`PARITY_CURRENT_API_URL`・`PARITY_NEW_UI_URL`・`PARITY_NEW_API_URL` に解決して渡す。
  解決の決まり（`url_command` の扱いと `"runtime"` の記録）は、`replace-strategy` の `references/project-config.md`「URL の引き渡し」に従う。
- テストの中では target の名前を読めない。側によって期待値を変えるときは、`sideOf(app.baseUrl)`（`app.baseUrl` は <https://e2e.com/docs/reference/app#baseurl>）で側を求める。側が決まらないときは、テストを止める（取り違えた側の期待値で通さない）。
- 側で期待値を変えるのは、仕様が同じでも値が実装で変わるもの（採番した id・URL の形）だけにする。見た目の違いで期待値を分けない。

## 認証

認証の規律のうち、ランナーに依らないものの原本は `parity-suite` の `references/auth.md` で、ここへ転記しない。
従うのは、資格情報の値を成果物（スイート・結果の JSON・画面の記録・ログ）に出さないこと、`auth.roles` のロールごとにログインの状態を分けること、ロール名を設定・スイート・`metadata.json` で同じにすること、認可をロールごとに特性化すること、である。
特性化に使ったロール名の一覧は、`parity-suite` と同じく `metadata.json` の `suite.auth_roles` に書く（認証が要らなければ空の配列）。
`parity-suite` の `references/auth.md` を読めないときは、ログインが要る画面のスイートを書かずに止まる。

e2e に固有の書き方は次のとおりである。出典は <https://e2e.com/docs/authentication> と <https://e2e.com/docs/reference/test#test-setup> で、e2e 0.23.0・`@e2e-dev/web` 0.15.5 で確かめた。

- ログインは、`test.setup(<名前>, { sessions: [<ロール名>...] }, ...)` の本体で 1 回だけ行い、ロールごとに `session.save(<ロール名>)` で保存する。
  `session.save()` はログインが成功したかを確かめないので、保存の前にログインした後の画面を assertion で確かめる。ロールを続けて保存するときは、ロールの間で `app.clearState()` を呼ぶ。
- ログインした状態を使うテストは、`test(<名前>, { session: <ロール名> }, ...)` で状態を戻す。戻した直後はページが開いていないので、最初に `app.open()` を呼ぶ。
  ランナーは、1 回の実行の中で target ごとに 1 回だけ setup を実行し、同じロールのテストは保存した状態を使い回す。保存した状態は暗号化され、実行の終わりに消える。
- `test.setup` はファイルの最上位に書く。`tests/parity/test.ts` の `test` から呼べる（`base.extend` で作った `test` も `test.setup` を持つ）。
- ロール名は、e2e のセッションの名前の規則（`/^[A-Za-z0-9_.-]{1,128}$/`）に合うものだけを使える。合わないロール名は読み替えずに止まり、利用者に確かめる（`parity-suite` の `references/auth.md` がロール名の読み替えを禁じているからである）。
- 資格情報は、`e2e.config.ts` の `credentials` にロール名で宣言し、テストでは `credentials.user(<ロール名>)` で読む（<https://e2e.com/docs/reference/config#credentials>）。パスワードは値を持たない `Secret` として渡り、結果の JSON とモデルへの入力には名前だけが出る。
- 値は、実行のたびに環境変数で渡す。e2e は、`E2E_USER_<ロール名を大文字にし、英数字以外を _ にしたもの>_USERNAME` と `..._PASSWORD` で `credentials` の値を置き換える。
  スキルは、選んだ target の `auth.roles.<ロール名>.{user_name_env,password_env}` が指す環境変数から、この 2 つを作って e2e を起動する。target ごとに資格情報が違うので、`current` と `new` を 1 回の実行で一緒に動かさない（`--target` で分ける）。
  値をコマンドの引数に書かない（`secrets.wrapper` があれば前に付ける）。2 つのロール名が同じ環境変数の名前になると、e2e は `INVALID_CONFIG` で止まる。
- 確かめた範囲は、ユーザー名とパスワードのフォームで Cookie を発行するログインである。2 つのロールの状態を 3 つのテストで使い回し、ログインが target ごとに 1 回であること、結果の JSON にパスワードが出ないこと、2 つの target でそれぞれ setup が動くことを確かめた。
  確かめていないのは、トークンを `localStorage` や IndexedDB に置くログイン、ワンタイムコードを使うログイン、ログインの状態の有効期限が実行の途中で切れる場合である。
  これらに当たるアプリでは、手順を推測で書かず、`gaps.md` に「認証範囲不明」として残す。

## 合否の書き方

- 合否は、ロケータ（`screen.getByRole` など。<https://e2e.com/docs/reference/screen>）と assertion（`expect(...).toBeVisible()`・`toHaveText()`・`toHaveCount()` など。<https://e2e.com/docs/reference/expect>）で書く。
- 操作は、ロケータの操作（`click`・`fill`）で書く。自然文の目的（`agent.act`）で書いてもよいが、使う前に [`e2e-runner.md`](e2e-runner.md)「外部へ送るデータと止め方」の承認を得る。
  `agent.act` の後には、操作の結果を確かめるロケータの assertion を置く。`agent.assert` と `agent.extract` を合否に使わない（モデルの判断で合否が決まる）。
- 行やセルのアクセシブルネームは、実装で空白の有無が変わる（`<table>` は「みかん 80」、role を付けた `<span>` は「みかん80」）。正規表現（`/^みかん\s*80$/`）で書く。
- 期待値は現行で観測した値から決め、新側に合わせて書き換えない。現行でも新側でも同じ値になるはずのものだけを assertion にする。

## role ごとの assertion

e2e には aria スナップショットが無い。parity 系のスキルが aria スナップショットで確かめていた構造は、role ごとの assertion で書く。

| 確かめるもの | 書き方の例 |
|---|---|
| ランドマーク | `screen.getByRole("navigation", "メイン")`・`screen.getByRole("main")` が見えている |
| 見出しの階層 | `screen.getByRole("heading", { name: "商品一覧", level: 1 })`、続く見出しは `level: 2` |
| 表 | `getByRole("table")`・`columnheader`・`rowheader` の名前、`getByRole("row")` の件数、行の名前（正規表現） |
| フォーム | `getByRole("textbox", "名前")` などのラベル、必須・不活性の状態 |
| 状態の表示 | `getByRole("status")`・`getByRole("alert")` の文言 |
| リンクとボタン | 名前と、押した後の行き先・状態 |

## 操作と状態

スクリーンショットと計算後スタイルは、比較のために採らない。見た目に出る状態の変化は、操作と assertion として書く。

- メニュー・ポップアップ・ダイアログが開くこと: 開く操作の後に、`menu`・`dialog` などの role が見えることと、閉じる操作の後に消えること
- 状態の切り替え: 不活性（`toBeDisabled`）・選択（`toBeChecked`・`aria-selected`）・展開（`aria-expanded`）が、操作の前後で変わること
- 状態表示: 0 件・取得の失敗・読み込み中の文言。応答の書き換え（`browser.route`。<https://e2e.com/docs/reference/web#route>）で状態を作ってから確かめる
- 送っている間の押し直し: 送信中に押しても 2 回送らないこと
- 行き先: 押した行の詳細が開くこと（押した行の値を、開いた先で確かめる）

## API

- API は、テストの中の `fetch` で特性化する。送り先は `apiOf(app.baseUrl)` で側から求める。
- 状態コード・`content-type`・本文の構造と値を assertion にする。現行と新側で値が変わる項目（時刻・採番した id）は、形だけを確かめる。
- 書き込みの API は、`parity-suite` の `references/data-discipline.md` に従い、テストが作ったデータだけを後始末で消す。`forbidden_actions` で書き込みを許していない target では実行せず、未検証として記録する。

### API の要求単位の根拠と未測定

API の特性化に入る前に、対象の slug の features.md で根拠が `推定` の口を拾い、確定できた口と確定できなかった口を、次のように扱う。
手順の原本は `parity-suite` の `references/api-batch.md`「要求単位を確定したら features.md へ書き戻す」で、ここへ転記しない。

- 特性化で要求単位まで確定できた口は、`replace-strategy evidence` に任せて features.md へ書き戻す（`推定` から `実測` にする）。
  このスキルは `.replace/features.md` を自分では書かない。`replace-strategy` を使えないときも、自分で書かずに、確定した口と根拠を報告する。
- 確定できなかった口は、`推定` のまま残す。測るまで機能を閉じさせないものは、`metadata.json` の `unmeasured` に `disposition: blocking` で宣言し、`gaps.md` にも同じ文言（`item` と `reason`）で残す。
  `endpoint` には、features.md の API 列の口を文字単位で一致させて書く。一致しないと、`replace-strategy` の `scripts/evidence-gap-check.mjs` が宣言として数えない。
- `unmeasured` の形と意味の原本は、`parity-suite` の `references/coverage.md`「未測定を機械可読にする」である。
  `blocking` が残る間、`verify` の `convergence-check.mjs` は収束させない（[`convergence.md`](convergence.md)）。

## 視覚の採取の代わりに assertion にするもの

`parity-suite` は、次のものを画素・計算後スタイル・aria の採取で比べている。`spec-parity` は見た目を比べないので、仕様に当たるものだけを assertion にする。

| parity-suite の採取 | spec-parity での扱い |
|---|---|
| aria スナップショット（構造） | role ごとの assertion（上の表） |
| 文言・placeholder・ラベル | `toHaveText`・アクセシブルネームの assertion |
| ドキュメントレベルの要素（`title`・`html[lang]`） | `browser.title()` と `browser.evaluate` で読んだ値の assertion |
| 開いたポップアップの中身 | 開く操作の後の role と文言の assertion |
| 押した後に残る状態（選択の印・並べ替えの向き） | 属性（`aria-selected`・`aria-sort`）と文言の assertion |
| 窓の寸法への追従・横のはみ出し | `verify` の横のはみ出しの判定（[`overflow.md`](overflow.md)） |
| 色・余白・フォント・罫線・角丸・操作したときの手応え | 確かめない。デザインの点検と人による確認で扱う（[`design-review.md`](design-review.md)） |
| 性能（LCP・CLS など） | 確かめない。`verify-metadata.json` の `unverified` に `performance` として書く |

## スイートを現行で通す

- スイートを `--target current` で実行し、すべてのテストが通ってから、結果の JSON を `.replace/parity/<slug>/suite-report.json` に保存する。
  結果の JSON は、e2e の出力先の `report.json`（デフォルトは `.e2e/report.json`。<https://e2e.com/docs/reference/config#output>）をコピーする。
- 保存した結果が、収束の判定で「現行で通ったテスト」の一覧になる。スイートを変えたら、現行で実行し直して保存し直す（新側の結果にだけあるテストは、収束の判定でやり直しになる）。
- 状態を変えるスイートは、2 回続けて通ることを確かめる（1 回目は初期状態から始まるので、後始末が機能しているかが結果に出ない）。
