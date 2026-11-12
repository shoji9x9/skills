# e2e の前提と外部への送信

`spec-parity` はスイートを e2e（<https://github.com/e2e-inc/e2e>、Apache-2.0。<https://tester.army/e2e> から転送される）で書く。
この文書は、e2e を入れて実行するまでの前提・外部へ送るデータと止め方・`agent.act` のキャッシュ・Playwright との共存・確かめていないことを定める。
e2e の仕様の出典は、公式のドキュメント（<https://e2e.com/docs/llms.txt> から各ページへたどれる）である。

## バージョンと導入

- 確かめたバージョンは、e2e 0.23.0・`@e2e-dev/web` 0.15.5・Node.js v26.13.0 である。雛形（`assets/`）と判定のスクリプトは、この組で実際に動かして確かめた。
- Node.js は 24.8 以上（Node.js 22 なら 22.22.3 以上）が要る（出典: <https://e2e.com/docs/quickstart>）。
- 入っているかは、プロジェクトの `package.json` の devDependencies に `e2e` と `@e2e-dev/web` があり、プロジェクトに入った e2e が `--version` に答えることで確かめる。
  起動には、レジストリから取得して実行しない、プロジェクトのパッケージマネージャのコマンドを使う。
  pnpm なら `pnpm exec e2e --version`、Yarn なら `yarn e2e --version`（Plug'n'Play で `node_modules/.bin` が無くても動く）、npm なら `npx --no -- e2e --version` である。
  どれにも `E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 E2E_UPDATE_CHECK_DISABLED=1` と `</dev/null` を付ける。
  `npx e2e --version` は使わない。e2e が入っていないと、非対話の実行ではレジストリから e2e を取得して実行し、終了コード 0 で通る。
  `--` を省いた `npx --no e2e --version` も使わない。npm 11.20.0 では、e2e が入っていなくても npm のバージョンを出して終了コード 0 になった。
  `pnpm exec`（pnpm 12.17.0）と `npx --no --`（npm 11.20.0）は、e2e が入っていないディレクトリで 0 以外で終わり、入っているディレクトリでは e2e のバージョンを出すことを実測で確かめた。Yarn は実測していない（出典: <https://pnpm.io/cli/exec>・<https://docs.npmjs.com/cli/commands/npx>・<https://yarnpkg.com/cli/run>）。
  どちらかが欠けていれば、成果物を作らずに止まり、導入を案内する。
  このスキルの文書の実行の例（`npx e2e run ...`）は、この確かめが通ったプロジェクトのルートで実行する形である。別のディレクトリで実行するときは、`npx --no -- e2e run ...` かパッケージマネージャのコマンドで起動する。導入は依存の追加なので、利用者の承認を得てから行う（`replace-strategy` の `references/dependency-selection.md`）。
- 導入は、プロジェクトのパッケージマネージャで `e2e` と `@e2e-dev/web` を devDependencies に足す。`npx e2e init` は設定と例のテストを書くので、既存の設定があるプロジェクトでは使わない。
  Chromium は、最初の実行が自動で取得する。取得の状態は `npx e2e doctor` で確かめる（出典: <https://e2e.com/docs/reference/cli>）。
- 確かめたバージョンより新しい e2e で、結果の JSON の `schemaVersion` が `report-1` でなくなったときは、判定のスクリプトが exit 2 で止まる。形が変わったので、スクリプトを直すまで判定しない。

## 外部へ送るデータと止め方

e2e の実行は、次の 3 つの宛先に接続しうる（出典: <https://e2e.com/docs/reference/security>・<https://e2e.com/docs/telemetry>）。

| 宛先 | 送るもの | 止め方 |
|---|---|---|
| テレメトリ（`eu.i.posthog.com`） | 匿名の利用状況。デフォルトで送る | `E2E_TELEMETRY_DISABLED=1` か `DO_NOT_TRACK=1` |
| 更新の確認（`registry.npmjs.org`） | 端末から実行したときの新しいリリースの確認（1 日に 1 回まで） | `E2E_UPDATE_CHECK_DISABLED=1`（`E2E_TELEMETRY_DISABLED=1` でも止まる） |
| モデルの提供元 | `agent.act` などの agent のステップの指示・画面のアクセシビリティツリー・URL。モデルが求めたときや `vision` を付けたステップでは、マスクしたスクリーンショットも送る | agent のステップを使わない（agent を使わないテストは、モデルの設定なしで通る） |

- このスキルが起動する e2e の実行には、必ず `E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 E2E_UPDATE_CHECK_DISABLED=1` を付ける。CI の設定にも同じ環境変数を書くよう案内する。
- agent のステップは、操作を自然文で書くためにだけ使ってよい。合否は、ロケータと assertion で決定論的に書く（[`suite-authoring.md`](suite-authoring.md)）。
  使うときは、モデルの提供元へ画面の内容を送ることを、判断の材料（送る内容・提供元）と一緒に利用者に確かめ、承認を `metadata.json` の `runner.agent_steps_approval` の場所に残す。
  承認が無い間は agent のステップを書かない。テストのデータに秘密の値を入れない（e2e は秘密の値を文字列で伏せるが、スクリーンショットで伏せるのは入力欄の一部だけである）。

## `agent.act` のキャッシュ

agent のステップを使う場合だけ関係する。次はドキュメントの記述で、このスキルでは再生を実測していない（出典: <https://e2e.com/docs/cache>）。

- 確かめが通った `agent.act` の操作は、`.e2e/cache/` に JSON で記録され、次の実行でモデルを呼ばずに再生される。記録はテスト・target・指示・引数ごとに分かれる。
  current と new は別の target なので、現行で記録した操作は新側で再生されない。
- 端末ではデフォルトで読み書きし、`CI` が設定された実行では読むだけになる。記録が無いステップをモデルで実行させずに失敗させるには、`--strict-cache` を付ける。
- 記録には、入力した値がそのまま残る（`Secret` で渡した値は名前だけが残る）。`.e2e/cache/` を commit しない（`npx e2e init` は `.gitignore` に足す）。
  キャッシュの再生は合否の根拠にしない。再生が失敗したステップはモデルに引き継がれるので、同じテストでも実行ごとにモデルを呼ぶかが変わる。

## Playwright との共存

- e2e は `e2e.config.ts` を読み、デフォルトで `tests/**/*.e2e.ts` を集める。Playwright（`*.spec.ts`・`*.test.ts`）と同じプロジェクトに置いても、互いのテストを集めない（実測で確かめた）。
- `@e2e-dev/web` は自分の `playwright-core` を固定して持つ。プロジェクトに `@playwright/test` があると、`playwright-core` と Chromium が 2 組になる（ディスクと取得の時間が増える）。
- 既存の Playwright のスイート（`parity-suite` のものを含む）は動かさない。`style_policy: free` の機能のスイートだけを e2e で書く。

## e2e の仕様で、雛形が前提にしていること

次は実測で確かめた。雛形と判定のスクリプトは、これを前提に書いている。

- fixture は `{ screen, app, browser, agent, platform, session }` を受け取る。`test.extend` で足した fixture は、名前を受け取らなくても、その test で登録したすべてのテストで動く。
- `targets` で同じテストを複数の URL に当て、`--target <name>` で選ぶ。テストの中では target の名前を読めないので、`app.baseUrl` から対応表で側を求める（`assets/sides.template.ts`）。
- `afterEach` と fixture は、テストの名前と状態を受け取らない。テストの名前と状態は、reporter の `test-finished` で受け取る。
- 結果の JSON（`.e2e/report.json` か `--reporter json`）は `{ schemaVersion, run: { results[], summary } }` で、選ばれなかったテストも `selected: false` で入る。
  結果の状態は `passed`・`flaky`・`failed`・`timed-out`・`interrupted`・`skipped` である。終了コードは、テストの失敗が 1、設定の誤りが 2 である。
- aria スナップショットと、console・pageerror のイベントは無い。前者は role ごとの assertion で、後者は init script で代わりにする。
- 幅は `web({ viewport })` か `browser.setViewport()` で決め、`browser.evaluate` で `scrollWidth` と `clientWidth` を読める。
- 故障注入には `browser.route(...)` の `fulfill` と `browser.evaluate` を使える。失敗したテストの最後の試行のエラーは、`attempts[].error.code` に `ASSERTION_FAILED` などで入る。
- テストが失敗すると、e2e は失敗した時点の画面のスクリーンショットを `.e2e/results/` に残す。これは失敗の調査のためのもので、比較には使わない。

## 確かめていないこと

次は実測していない。スイートがこれに当たるときは、`gaps.md` と `verify-metadata.json` の `unverified` に残し、確認済みにしない。

- リトライとタイムアウトのときの、操作中のエラーの記録。テストがタイムアウトして後始末が動かなければ、そのテストの記録は作られない（記録が欠けたテストとして比較で止まる）
- 別オリジンへの遷移。`sessionStorage` はオリジンごとなので、移った後のエラーと、移る前の記録を取り出せない
- iframe の中と XMLHttpRequest のエラー（init script が記録しない）
- Chromium 以外のブラウザ
- `agent.act` のキャッシュの再生
- 認証のうち、Cookie でログインする形のほか（トークンを localStorage や IndexedDB に置くログイン・ワンタイムコードを使うログイン・実行の途中でログインの状態の有効期限が切れる場合）。
  Cookie でログインする形だけを実測した。ほかの形でログインの状態を保てないと、ログインの後の画面のテストが通らないか、ログインの画面の記録で通る
- 性能（初期表示の読み込みの速さとレイアウトの揺れ）を e2e で採れるか。`parity-suite` の `perf-stats.mjs` の採取は Playwright のスペックを前提にしているので、`spec-parity` では性能を `unverified` の `performance` として残す
