# ファイル入出力（出力の捕捉・アップロード・解析ツール）

ファイル出力（CSV / Excel / 帳票・PDF）とファイル入力（アップロード）の**実現手段**を定める。**本ファイルが実現手段の正本**で、姉妹スキルは転記せず参照する。

役割の境界:

- **何を比較するか**（比較観点）: `parity-suite` の `references/coverage.md`「副作用出力の特性化」
- **対応範囲の判定**（対象／対象外／条件付き）: [`scope.md`](scope.md)
- **ストレージの設定スキーマ**: [`project-config.md`](project-config.md)「ファイルストレージ」
- **書き込みの規律**（復元・後始末・hermetic でない旨の明示）: `parity-suite` の `references/data-discipline.md`

## バイト列の取得経路

比較は**バイト列に到達できて初めて成立する**。到達できない出力は「対象」と判定できない（[`scope.md`](scope.md)）。経路は 3 つで、モードによって使うものが変わる。

| 経路 | 使う場面 | 手段 |
|---|---|---|
| ダウンロードイベント | 画面操作でダウンロードが発火する | `page.waitForEvent('download')` → `download.saveAs(<退避先>)` |
| ブラウザと同じ cookie jar の API 要求 | ダウンロードが発火しない・URL を直接叩ける | `page.request` / `browserContext.request` の `get()` → `response.body()`（`Buffer`） |
| ファイルシステム直読み | batch モード（ブラウザを経由しない） | 現行テスト環境の出力ディレクトリを読む（到達性は [`measurement.md`](measurement.md) の測定項目） |

- **`acceptDownloads` は既定 `true`** なので追加設定は要らないが、**ダウンロードしたファイルは browser context のクローズで削除される**。
  捕捉するなら `saveAs()` で**必ず退避する**（テスト終了後に読む前提で放置できない）。
  ただし**プロジェクト設定（`use`）で明示的に `false` にしていると download イベントは発火しない**ため、捕捉スペックを書く前に現在の設定値を確認する（既定に依存する記述をコードに残さない）。
  出典（2026-07-30 確認）: <https://playwright.dev/docs/downloads> ・ <https://playwright.dev/docs/api/class-browser#browser-new-context-option-accept-downloads> ・
  <https://playwright.dev/docs/api/class-testoptions#test-options-accept-downloads>（`browser.newContext()` と Playwright Test の `use` の双方が「Defaults to true」）
- **`Content-Disposition` が無い経路・ビューアでインライン表示される経路では download イベントが出ない。** その場合は API 要求経路を使う（発火を待って停まらない）
- **API 要求経路は `page.request` / `browserContext.request` を使う。** これは所属する BrowserContext と**同じ cookie jar** を使うため、UI でログインした状態のままファイルを取れる。
  **`@playwright/test` の `request` フィクスチャは各テストごとの Isolated APIRequestContext であり、`page` の cookie を共有しない**——
  UI 操作で得たセッションに依存する取得に使うと未認証で落ちる（設定の `storageState` で認証する API 特性化の用途とは別物）。
  出典（2026-07-30 確認）: <https://playwright.dev/docs/api/class-apirequestcontext> ・ <https://playwright.dev/docs/api/class-fixtures#fixtures-request> ・ <https://playwright.dev/docs/api/class-apiresponse#api-response-body>
- **batch モードはブラウザを経由しない**（サーバのファイルシステムへ書く）。そのため到達性——出力ディレクトリを読めるか、コンテナ内ならどう入るか、リモートならどう転送するか——を先に実測する
- 取得したバイト列の保存先は `artifacts` 設定に従う（テキストは Git、大きなバイナリは既定 `local`。正本は [`project-config.md`](project-config.md)「成果物の保存先」）

## 形式別の扱い

| 形式 | 比較の単位 | 理由 |
|---|---|---|
| CSV・固定長・テキスト | **バイト列（`Buffer`）比較** | 文字コード・BOM・改行コードがバイト列にそのまま残るため最も忠実。復号してから比べると差が消える |
| xlsx（OOXML） | **シート × セル値と構造**（バイト一致を取らない） | 実体は ZIP で、zip 内に生成日時等の**揮発項目**が入るため内容が同じでもバイト列が一致しない（`coverage.md`「揮発項目は意図的差異として除外する」の適用対象） |
| PDF・帳票 | **抽出テキストと構造**（バイト一致を取らない） | 生成器の版・生成日時・オブジェクト順で、見た目が同じでもバイト列が変わる |

- **レガシー encoding のテキストも復号して読める。** Node の `TextDecoder('shift_jis')` で復号できる（full ICU 同梱の Node で実測。
  2026-07-30 に Node v24.17.0（`process.config.variables.icu_small === false`）で `new TextDecoder('shift_jis')` が Shift_JIS バイト列を復号できることを確認）。
  **small-icu ビルドでは同じ呼び出しが失敗する**ため、比較を回す Node が full ICU かを先に確認する
- **判定はバイト列比較で行い、復号は差分の説明に使う**（どの文字がどう化けたかを人が読めるようにするため）。復号を判定に使うと encoding・BOM の差が消える
- xlsx / PDF は**抽出結果に落としてから比較する**。抽出結果を JSON 化すれば、既存の同梱ツール（`parity-diff` の `scripts/json-normalize-diff.mjs`）で正規化＋決定論的比較ができる
  （揮発項目は同ツールの `--ignore` で除外する。差分器を新たに書き起こさない）

## xlsx / PDF の解析ツール

**ツールはプロジェクトが選び、選んだツールとバージョンを `metadata.json` に記録する**（画素差分ツールと同じ形）。理由は 2 つ:

- 同梱スクリプトを**外部依存必須にしない**方針を崩さないため（同梱 `.mjs` は Node 標準のみを import し、外部依存は動的 import ＋未導入なら明示エラーで停止する）
- プラットフォーム別バイナリの有無・CI 導入コストがプロジェクトの CI 構成で変わるため（スキル側で決め打ちすると、決め打ちが通らない環境で工程が空回りする）

- **記録先**: `parity-suite` が生成する `.replace/parity/<slug>/metadata.json` の `differ.file_extract`（形式ごとにツール名とバージョン）。
  `parity-diff` は**記録値を使い、自分で選び直さない**（現側の抽出と新側の抽出が別ツールになると、差分がツール差か実装差か切り分けられない）
- **選定は [`dependency-selection.md`](dependency-selection.md) の判断材料で行い、決定・不採用理由を `.replace/dependencies.md` に記録する**（検証側の道具立ての依存も同じ基準・同じ記録先）
- **この用途ではバンドルサイズより「CI 導入コスト」と「出力の決定論性」を重く見る**——検証側の道具はブラウザへ配信されないため配布サイズの意味が薄い。代わりに次の 2 点が効く:
  1. プラットフォーム別ネイティブバイナリ／ランタイムの要否と、インストール時に取得が走るか（CI のネットワーク前提・供給網の確認が増える）
  2. 同じ入力に対し同じ抽出結果を返すか（抽出順・空白・改行の安定性）。ここが揺れると差分器のノイズになる
- **新側の実行基盤の制約（サーバレス／エッジで動くか）はこの用途には当たらない**——検証側の道具は CI・ローカルで動き、新側アプリのランタイムには載らないため。
  実行基盤との両立を見るのは**アプリに載る依存**（帳票・xlsx の**生成**ライブラリ等）のほうで、そちらは [`dependency-selection.md`](dependency-selection.md)「判断材料」の実行基盤の行に従う
- 閾値・可否の線引きはリポジトリ方針かユーザーが決める（スキル既定の拒否リスト・閾値を持ち込まない）

### 候補の判断材料（npm レジストリ実測値。2026-07-30 確認）

**採否はプロジェクトが決める。** 下表は判断材料の実測例であって推奨の固定リストではない。**値は確認日時点のもので陳腐化する**ため、導入時に [`dependency-selection.md`](dependency-selection.md) の確認手段で再測定する。

| 候補 | 用途 | ライセンス | 最終リリース | 月間 DL | 配布元の素性 | サイズ / 依存数 | 型定義 |
|---|---|---|---|---|---|---|---|
| `exceljs` | xlsx | MIT | 2023-10-19（4.4.0） | 46.9M | 上流公式（exceljs/exceljs）。メンテナー 2 | 21.8MB / 9 | 同梱 |
| `xlsx`（SheetJS） | xlsx | Apache-2.0 | 2022-03-24（0.18.5） | 48.4M | **npm 版は上流の現行配布ではない**（公式は自社 CDN の tarball 配布へ移行） | 7.5MB / 7 | 同梱 |
| `@officecli/officecli` | xlsx / docx / pptx（CLI） | Apache-2.0 | 2026-07-28（1.0.143） | 14.5K | 上流公式（iOfficeAI/OfficeCLI）。メンテナー 1 | 12.7KB / 0（**ネイティブバイナリは非同梱で `postinstall` が取得する**） | 無し |
| `pdfjs-dist` | PDF | Apache-2.0 | 2026-07-28（6.2.108） | 85.3M | 上流公式（mozilla/pdf.js）。メンテナー 5 | 34.5MB / 0 | 同梱 |
| `unpdf` | PDF | MIT | 2026-07-24（1.8.0） | 7.4M | 上流公式（unjs/unpdf。pdf.js の serverless ビルドを内包）。メンテナー 1 | 2.1MB / 0 | 同梱 |
| `pdf-parse` | PDF | Apache-2.0 | 2025-10-20（2.4.5） | 25.8M | 上流公式（mehmet-kozan/pdf-parse）。メンテナー 1 | 21.3MB / 2 | 同梱 |

出典（2026-07-30 確認）: 各値は `https://registry.npmjs.org/<pkg>/latest`（`license` / `dist.unpackedSize` / `types` / `repository`）・`https://registry.npmjs.org/<pkg>`（`time` / `maintainers`）・
`https://api.npmjs.org/downloads/point/last-month/<pkg>`（`downloads`）の実測値。
`xlsx` の配布経路は公式インストール手順 <https://docs.sheetjs.com/docs/getting-started/installation/nodejs/>（`npm rm --save xlsx` の後に CDN の tarball を入れる案内）で確認。
`@officecli/officecli` の `scripts.postinstall: node install.js` と「The native binary is fetched on install for your platform.」は上記 `latest` のレスポンスで確認。

- **記録すべき不採用理由の観点**（例。実測して自分の言葉で書く）: npm 上の版が上流の現行版と乖離している／パッケージ本体にバイナリが含まれずインストール時に取得が走る／
  メンテナーが 1 名・最終リリースが古い（単一障害点としてリポジトリ方針に照らす）／型定義が無い
- **表の値だけで決めない。** 要件（何が一致すれば現行と同じと言えるか）を先に書き、**現行アプリの実出力ファイルで抽出を 2 回試して同じ結果になるか**を確かめる（決定論性は実測項目）

## ファイル入力（アップロード）

操作自体は Playwright で完結する。難しいのは操作ではなく**周辺**（fixture の用意・書き込みの後始末・何を検証対象にするか）である。

### 操作

- `locator.setInputFiles()` に **パス／パスの配列／ディレクトリ／空配列（選択解除）／インメモリの `{ name, mimeType, buffer }`** を渡す
- input 要素を掴めない（動的生成される）場合は `page.waitForEvent('filechooser')` → `fileChooser.setFiles(...)`
- 出典（2026-07-30 確認）: <https://playwright.dev/docs/input>
- **ドラッグ & ドロップによる投入は対象外**（`setInputFiles` の射程外で、`DataTransfer` を `evaluate` で組む必要があり脆い。対象外の一覧は [`scope.md`](scope.md)）

### fixture は生成に寄せる

**アップロードするファイルを手書きでコミットしない。** インメモリ buffer を渡せるため、決定論的に**生成**する側へ寄せられる。
これは `golden-dataset` の「作るのはデータそのものではなく投入ツール」「手書きの静的データを直接コミットしてツールを省略しない」と同じ規律である。

- ただし**実アプリは中身の妥当性を検査する**（xlsx として開ける・画像としてデコードできる・サイズ上限・ウイルススキャン）。
  数バイトのダミーでは経路を通らないため、**本物として通るバイト列を生成する**（生成できない形式は `gaps` に未検証として残す）
- 生成ツールの置き場所は `golden-dataset` の投入ツール（`dataset_tool_dir`）に寄せる。現・新の両側で同じ入力を使う必要があり、論理データと同じ冪等・決定論の規律に乗るため

### 検証対象

| 対象 | 見るもの | 注意 |
|---|---|---|
| 保存されたバイト列 | 入力と保存結果の一致（変換を挟むなら変換後の一致） | 取得は上記「バイト列の取得経路」。ストレージ実体を直接読む必要があるなら `storage.env_vars` の宣言が前提 |
| 派生物 | サムネイル・変換後 PDF 等の生成物 | 生成器が変わると揮発項目・圧縮差が出る。上記「形式別の扱い」に従う |
| 保存ファイル名（path）の規則 | 命名規則（プレフィックス・連番・ハッシュ・拡張子） | **現新で規則が変わると path が変わる。** 意図的差異か回帰かの判断が要るため、宣言が無いまま「許容」にしない（`intentional_diffs`） |
| 見た目 | ネイティブ `<input type=file>` と新側のカスタムアップローダの構造差 | クラス/トークン単位に還元できるなら `component_diffs`、できないなら `gaps.md`「宣言できない構造差」 |

- **アップロードは書き込みである。** 復元 → 一意プレフィックス＋後始末 → 後始末できないなら「hermetic でない」と明示、の規律に従う（正本は `parity-suite` の `references/data-discipline.md`）。
  **アップロードしたファイルは UI から消せないことが多く、`gaps.md` の「hermetic でないテスト一覧」の常連になる**前提で計画する
- **ストレージ実体への事前配置（ゴールデンデータとしての投入）は v1 スコープ外**（正本: [`project-config.md`](project-config.md)「ファイルストレージ」）。
  **アップロード操作の特性化はスコープ内、ストレージへの投入はスコープ外**という線引きを混同しない
- **ブラウザで流していないアップロードを「確認済み」にしない**（操作が Playwright で可能であることは、その画面で通ったことの証拠にならない）
