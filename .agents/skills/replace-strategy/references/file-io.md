# ファイル入出力（出力の捕捉・アップロード・解析ツール）

ファイル出力（CSV・Excel・帳票や PDF）とファイル入力（アップロード）を、どの方法で実現するかを定める。
**実現の方法はこのファイルで定義する。** 姉妹スキルはここへ転記せず、このファイルを参照する。

役割の分担は次のとおりである。

- 何を比べるか（比較の観点）: `parity-suite` の `references/coverage.md`「副作用出力の特性化」
- 対応範囲の判定（対象・対象外・条件付き）: [`scope.md`](scope.md)
- ストレージの設定のスキーマ: [`project-config.md`](project-config.md)「ファイルストレージ」
- 書き込みの規律（復元・後始末・hermetic でないことの明示）: `parity-suite` の `references/data-discipline.md`

## バイト列を取得する方法

比較は、バイト列に到達できて初めて成り立つ。到達できない出力は「対象」と判定できない（[`scope.md`](scope.md)）。
取得の方法は 3 つあり、モードによって使うものが変わる。

| 方法 | 使う場面 | 手段 |
|---|---|---|
| ダウンロードのイベント | 画面の操作でダウンロードが起きる | `page.waitForEvent('download')` → `download.saveAs(<退避先>)` |
| ブラウザと同じ cookie jar の API 要求 | ダウンロードが起きない・URL を直接呼べる | `page.request` / `browserContext.request` の `get()` → `response.body()`（`Buffer`） |
| ファイルシステムから直接読む | batch モード（ブラウザを経由しない） | 現行のテスト環境の出力ディレクトリを読む（到達できるかは [`measurement.md`](measurement.md) の測定項目） |

- `acceptDownloads` はデフォルトで `true` なので、設定を足す必要は無い。ただし、ダウンロードしたファイルは browser context を閉じると削除される。
  捕捉するなら、`saveAs()` で必ず退避する。テストが終わった後に読むつもりで、そのまま置いておくことはできない。
  プロジェクトの設定（`use`）で明示的に `false` にしていると、download イベントは起きない。捕捉のスペックを書く前に、今の設定値を確かめる。デフォルトに依存した書き方をコードに残さない。
  出典は <https://playwright.dev/docs/downloads> ・ <https://playwright.dev/docs/api/class-browser#browser-new-context-option-accept-downloads> ・
  <https://playwright.dev/docs/api/class-testoptions#test-options-accept-downloads> である（`browser.newContext()` と Playwright Test の `use` の両方が「Defaults to true」）。
- `Content-Disposition` が無い場合や、ビューアでインライン表示される場合は、download イベントが起きない。そのときは API 要求の方法を使う（イベントを待って止まらない）。
- API 要求には `page.request` か `browserContext.request` を使う。これらは所属する BrowserContext と同じ cookie jar を使うので、UI でログインした状態のままファイルを取得できる。
  `@playwright/test` の `request` フィクスチャは、テストごとに独立した APIRequestContext で、`page` の cookie を共有しない。
  UI の操作で得たセッションに依存する取得にこれを使うと、未認証で失敗する（設定の `storageState` で認証する API の特性化とは別の用途である）。
  出典は <https://playwright.dev/docs/api/class-apirequestcontext> ・ <https://playwright.dev/docs/api/class-fixtures#fixtures-request> ・
  <https://playwright.dev/docs/api/class-apiresponse#api-response-body> である。
- batch モードはブラウザを経由せず、サーバのファイルシステムへ書く。そのため、到達できるかを先に実測する。
  出力ディレクトリを読めるか、コンテナの中ならどう入るか、リモートならどう転送するかを確かめる。
- 取得したバイト列の保存先は、`artifacts` の設定に従う。テキストは Git に、大きなバイナリはデフォルトで `local` に置く（[`project-config.md`](project-config.md)「成果物の保存先」で定義する）。

## 形式ごとの扱い

| 形式 | 比較の単位 | 理由 |
|---|---|---|
| CSV・固定長・テキスト | **バイト列（`Buffer`）の比較** | 文字コード・BOM・改行コードがバイト列にそのまま残るので、最も忠実に比べられる。復号してから比べると差が消える |
| xlsx（OOXML） | **シート × セルの値と構造**（バイト列の一致は取らない） | 実体は ZIP で、ZIP の中に生成日時などの揮発項目が入る。内容が同じでもバイト列は一致しない（`parity-suite` の `references/coverage.md`「副作用出力の特性化」の揮発項目の除外を当てる） |
| PDF・帳票 | **抜き出したテキストと構造**（バイト列の一致は取らない） | 生成するツールの版・生成日時・オブジェクトの順で、見た目が同じでもバイト列が変わる |

- レガシーの文字コードのテキストも、復号して読める。Node の `TextDecoder('shift_jis')` で復号できる。
  full ICU を同梱した Node v24.17.0（`process.config.variables.icu_small === false`）で、`new TextDecoder('shift_jis')` が Shift_JIS のバイト列を復号できることを実測した。
  small-icu のビルドでは同じ呼び出しが失敗するので、比較に使う Node が full ICU かを先に確かめる。
- 判定はバイト列の比較で行い、復号は差分の説明に使う。どの文字がどう文字化けしたかを人が読めるようにするためである。復号した結果で判定すると、文字コードと BOM の差が消える。
- xlsx と PDF は、内容を抜き出してから比べる。抜き出した結果を JSON にすれば、同梱のツール（`parity-diff` の `scripts/json-normalize-diff.mjs`）で正規化と決定論的な比較ができる。
  揮発項目はこのツールの `--ignore` で除く。差分ツールを新しく書かない。

## xlsx / PDF の解析ツール

**ツールはプロジェクトが選び、選んだツールと版を `metadata.json` に記録する**（画素差分ツールと同じ形）。理由は 2 つある。

- 同梱のスクリプトに外部の依存を必須にしない方針を変えないためである。
  同梱の `.mjs` は Node の標準のモジュールだけを import する。外部の依存は動的に import し、入っていなければ明示的なエラーで止まる。
- プラットフォームごとのバイナリが要るか、CI に入れるコストがどれくらいかは、プロジェクトの CI の構成で変わるためである。スキルの側で決めると、それが通らない環境で工程が先に進まない。

扱いは次のとおりである。

- 記録先は、`parity-suite` が生成する `.replace/parity/<slug>/metadata.json` の `differ.file_extract` である（形式ごとに、ツールの名前と版）。
  `parity-diff` は記録された値を使い、自分で選び直さない。現側と新側を別のツールで抜き出すと、差分がツールの差か実装の差かを切り分けられないからである。
- 選定は [`dependency-selection.md`](dependency-selection.md) の判断材料で行い、決定と採らなかった理由を `.replace/dependencies.md` に記録する。
  検証の側で使うツールの依存も、同じ基準で選び、同じ場所に記録する。
- この用途では、バンドルサイズよりも、CI に入れるコストと出力の決定論性を重く見る。検証の側のツールはブラウザに配信されないので、配布するサイズの意味は薄い。
  代わりに、次の 2 点が影響する。
  1. プラットフォームごとのネイティブのバイナリやランタイムが要るか。インストールのときに取得が起きるか（CI のネットワークの前提と、供給網の確認が増える）
  2. 同じ入力に対して、同じ抜き出し結果を返すか（抜き出す順・空白・改行が安定しているか）。ここが揺れると、差分ツールのノイズになる
- 新側の実行基盤の制約（サーバレスやエッジで動くか）は、この用途には当てはまらない。検証の側のツールは CI とローカルで動き、新側のアプリのランタイムには載らないからである。
  実行基盤と両立するかを見るのは、アプリに載る依存（帳票や xlsx を生成するライブラリなど）のほうで、[`dependency-selection.md`](dependency-selection.md)「判断材料」の実行基盤の行に従う。
- しきい値と可否の線引きは、リポジトリの方針かユーザーが決める。スキルのデフォルトの拒否リストやしきい値を持ち込まない。

### 候補の判断材料（npm レジストリの実測値）

**採るかどうかはプロジェクトが決める。** 下の表は判断材料を実測した例で、推奨の固定の一覧ではない。
値は測った時点のもので、時間がたつと古くなる。導入するときに、[`dependency-selection.md`](dependency-selection.md) の確認の手段で測り直す。最終リリースの日付も、そのときに確かめる。

| 候補 | 用途 | ライセンス | 測ったときの最新版 | 月間 DL | 配布元の素性 | サイズ / 依存数 | 型定義 |
|---|---|---|---|---|---|---|---|
| `exceljs` | xlsx | MIT | 4.4.0 | 46.9M | 上流の公式（exceljs/exceljs）。メンテナー 2 | 21.8MB / 9 | 同梱 |
| `xlsx`（SheetJS） | xlsx | Apache-2.0 | 0.18.5 | 48.4M | **npm の版は上流の現行の配布ではない**（公式は自社の CDN の tarball での配布へ移った） | 7.5MB / 7 | 同梱 |
| `@officecli/officecli` | xlsx / docx / pptx（CLI） | Apache-2.0 | 1.0.143 | 14.5K | 上流の公式（iOfficeAI/OfficeCLI）。メンテナー 1 | 12.7KB / 0（**ネイティブのバイナリは同梱せず、`postinstall` が取得する**） | 無し |
| `pdfjs-dist` | PDF | Apache-2.0 | 6.2.108 | 85.3M | 上流の公式（mozilla/pdf.js）。メンテナー 5 | 34.5MB / 0 | 同梱 |
| `unpdf` | PDF | MIT | 1.8.0 | 7.4M | 上流の公式（unjs/unpdf。pdf.js の serverless ビルドを含む）。メンテナー 1 | 2.1MB / 0 | 同梱 |
| `pdf-parse` | PDF | Apache-2.0 | 2.4.5 | 25.8M | 上流の公式（mehmet-kozan/pdf-parse）。メンテナー 1 | 21.3MB / 2 | 同梱 |

出典は次のとおりである。

- 各値は、`https://registry.npmjs.org/<pkg>/latest`（`license` / `dist.unpackedSize` / `types` / `repository`）、`https://registry.npmjs.org/<pkg>`（`time` / `maintainers`）、
  `https://api.npmjs.org/downloads/point/last-month/<pkg>`（`downloads`）を実測した値である。
- `xlsx` の配布の方法は、公式のインストールの手順 <https://docs.sheetjs.com/docs/getting-started/installation/nodejs/>（`npm rm --save xlsx` の後に CDN の tarball を入れる案内）で確かめた。
- `@officecli/officecli` の `scripts.postinstall: node install.js` と「The native binary is fetched on install for your platform.」は、上の `latest` の応答で確かめた。

候補を比べるときは、次のことに気をつける。

- 採らなかった理由として記録する観点には、たとえば次のものがある（実測して自分の言葉で書く）。
  npm の版が上流の現行の版とずれている。パッケージにバイナリが含まれず、インストールのときに取得が起きる。
  メンテナーが 1 人で、最終リリースが古い（単一障害点として、リポジトリの方針に照らす）。型定義が無い。
- 表の値だけで決めない。要件（何が一致すれば現行と同じと言えるか）を先に書く。
  そのうえで、現行のアプリが実際に出力したファイルで抜き出しを 2 回試し、同じ結果になるかを確かめる（決定論性は実測する項目である）。

## ファイル入力（アップロード）

操作そのものは Playwright で完結する。難しいのは操作ではなく、その周り（fixture の用意・書き込みの後始末・何を検証の対象にするか）である。

### 操作

- `locator.setInputFiles()` には、パス、パスの配列、ディレクトリ、空の配列（選択の解除）、インメモリの `{ name, mimeType, buffer }` を渡せる。
- input 要素を取得できない（動的に作られる）場合は、`page.waitForEvent('filechooser')` → `fileChooser.setFiles(...)` を使う。
- 出典は <https://playwright.dev/docs/input> である。
- ドラッグ & ドロップによる投入は対象外である。`setInputFiles` では扱えず、`DataTransfer` を `evaluate` で組み立てる必要があり、不安定になる。対象外の一覧は [`scope.md`](scope.md) にある。

### fixture は生成する

**アップロードするファイルを手書きで commit しない。** インメモリの buffer を渡せるので、決定論的に生成できる。
これは、`golden-dataset` の「作るのはデータそのものではなく投入ツール」「手書きの静的なデータを直接 commit して、ツールを省略しない」と同じ規律である。

- ただし、実際のアプリは中身が正しいかを検査する（xlsx として開けるか、画像としてデコードできるか、サイズの上限、ウイルススキャン）。
  数バイトのダミーでは検査を通らないので、本物として通るバイト列を生成する。生成できない形式は、`gaps` に未検証として残す。
- 生成するツールは、`golden-dataset` の投入ツール（`dataset_tool_dir`）に置く。現側と新側の両方で同じ入力を使う必要があり、論理データと同じ冪等と決定論の規律に従わせるためである。

### 検証の対象

| 対象 | 見るもの | 注意 |
|---|---|---|
| 保存されたバイト列 | 入力と保存結果が一致するか（変換を挟むなら、変換した後が一致するか） | 取得は上の「バイト列を取得する方法」に従う。ストレージの実体を直接読む必要があるなら、`storage.env_vars` を宣言していることが前提になる |
| 派生物 | サムネイル・変換した後の PDF などの生成物 | 生成するツールが変わると、揮発項目や圧縮の差が出る。上の「形式ごとの扱い」に従う |
| 保存するファイル名（path）の規則 | 命名の規則（プレフィックス・連番・ハッシュ・拡張子） | **現側と新側で規則が変わると、path が変わる。** 意図的な差異か回帰かの判断が要るので、宣言が無いまま「許容」にしない（`intentional_diffs`） |
| 見た目 | ネイティブの `<input type=file>` と、新側の独自のアップローダの構造の差 | クラスやトークンの単位に還元できるなら `component_diffs`、できないなら `gaps.md`「宣言できない構造差」 |

- アップロードは書き込みである。
  復元する、一意のプレフィックスを付けて後始末する、後始末できないなら「hermetic でない」と明示する、という規律に従う（`parity-suite` の `references/data-discipline.md` で定義する）。
  アップロードしたファイルは UI から消せないことが多いので、`gaps.md` の「hermetic でないテスト一覧」に頻繁に載る前提で計画する。
- ストレージの実体へ事前に置く（ゴールデンデータとして投入する）ことは、スコープ外である（[`project-config.md`](project-config.md)「ファイルストレージ」で定義する）。
  アップロードの操作の特性化はスコープ内で、ストレージへの投入はスコープ外である。この線引きを混同しない。
- ブラウザで実行していないアップロードを「確認済み」にしない。Playwright で操作できることは、その画面で通ったことの証拠にならない。
