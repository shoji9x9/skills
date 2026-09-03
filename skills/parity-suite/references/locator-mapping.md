# ロケータマッピング層・期待値解決層・操作差分の吸収

パリティスイートは**論理名**（例:「保存ボタン」）で書き、マッピング層が現・新それぞれのロケータへ解決する。論理名そのものが**現・新をまたぐ契約**である。

スイート本体から切り出す層は 3 つあり、**役割で分ける**（混ぜると片方の変更がもう片方を壊す）。

| 層 | 担うこと | 片側ずつ埋まるか |
|---|---|---|
| ロケータマッピング層 | **どう引くか**（論理名 → ロケータ） | 現側は本スキル、新側の例外は `parity-replace` |
| 期待値解決層 | **何を期待するか**（論理名 → side 別の期待値） | 同上 |
| 操作アダプタ | **どう操作するか**（論理名 → 操作の実装差） | 同上 |

## ロケータマッピング層

- **目的は現行アプリの非セマンティックな箇所を隔離すること。** これにより、新側でアクセシビリティを改善してもリントを off にせずに済む
- **原則は role ＋アクセシブルネーム。** `getByRole` / `getByLabel` はマークアップの詳細ではなく意味で要素を引くため、フレームワークやコンポーネントライブラリが違っても同じ記述が両実装に当たりうる
- **判定用と操作用のロケータを分けてよい。** データグリッド等は `role="columnheader"` を画面外のミラー要素に付けることがあり、role では意味を判定できても、
  その要素の `boundingBox()` を使ったポインター操作は画面外へ送られる。判定は role ＋アクセシブルネームを保ち、座標を使う操作は実際に描画されている要素を操作アダプタで引く
  （`boundingBox()` は要素の座標を返す。出典: <https://playwright.dev/docs/api/class-locator#locator-bounding-box>）
- **id / name をアンカーにしない。** 自動生成された id は変更対象になりうるうえ、比較の足がかりにすると id を変更できなくなる
- **例外率を決めてかからない。** role ＋アクセシブルネームで引ける割合は `replace-strategy` のセマンティクス測定が実測で出す。実測では過半が無改造で両実装に解決したが、割合は現行アプリの実装次第であり、例外が大半を占めることもありうる

### マッピングは片側ずつ埋まる

本スキルは新の開発前に動くため、**論理名の定義と現側のマッピングだけ**を埋める。

| 段階 | 埋めるもの | 完了の証拠 |
|---|---|---|
| `parity-suite`（本スキル） | 論理名の定義と現側のマッピング | スイートが**現に対して green** |
| `parity-replace` | 新側のマッピング（**例外のみ**） | スイートが**新に対して green**（＝パリティの証拠） |

**新側に書くのは論理名で解決できない例外だけ。** role ＋アクセシブルネームで引ける要素は同じ論理名がそのまま両実装に解決する。

### 脆弱なマッピングの記録

現側のマッピングが `div` への CSS セレクタなど脆弱な形にならざるを得ない箇所は、**その事実をマッピング層のコメントに記録する**。新側で改善される見込みの箇所であり、`parity-replace` で新側マッピングが不要になるか否かの porting 判断材料になる（`gaps.md` ではなくマッピング層のコメントで良い）。

## 期待値解決層（side 別の期待値）

**スイートは現・新の両方に当てて両方で green である必要がある。** 一方で意図的差異レジストリ `intentional_diffs` は散文の配列であり機械可読ではないため、「現側ではこの値、新側ではこの値を期待する」を**スイートのどこかで解決する層**が要る。それが期待値解決層で、ロケータマッピング層とは別に置く（引き方と期待値を同じ場所に混ぜない）。

- **既定は side 共通の 1 値**。side 別に分けるのは、`intentional_diffs.may_change` に**宣言済みの差**に触れる assertion だけ。宣言に無い差を勝手に side 別にしない（＝新側の不一致を期待値で吸収して緑にすることになる。レジストリに無い差は `intentional_diffs.pending` へ回してユーザー確認）
- **side 別にした項目には、根拠となるレジストリの該当項目を隣にコメントで書く**。これが無いと後から「なぜ 2 値なのか」を復元できない
- **side の解決は Playwright の `projects` 名（`current` / `new`）から行う**。テスト内では `testInfo.project.name` で参照できる
  （出典: <https://playwright.dev/docs/api/class-testinfo#test-info-project> / <https://playwright.dev/docs/api/class-testproject#test-project-name>）。
  環境変数や `baseURL` の中身で side を判定しない（projects 名が本スキルの確定契約）
- **本スキルが埋めるのは現側の値だけ**（マッピング層と同じく片側ずつ埋まる）。新側の値は `parity-replace` が埋める。現側だけの時点では、新側の値は未定として置き、`new` プロジェクトの green 化時に埋まる
- 配置の既定は後述の「配置の指針」の表（実際のパスは `metadata.json` の `suite.expectations` に記録し、`parity-replace` が推測せず引く）

## 操作の実装差を吸収する層

**ロケータが移植可能でも、操作は移植可能ではない。** `getByRole('combobox')` が両実装で要素を見つけても、`selectOption()` はネイティブ `<select>` でない実装では落ちる、という類のずれが起きる。

- **Select / Autocomplete / Date picker / Modal / Menu / Context menu（右クリック）は実装ごとの分岐が必須**。操作は論理名の裏に操作アダプタとして隠し、スイート本体は論理名と操作意図だけを書く
- **右クリックは発火を観測して送り方を決める。** `locator.click({ button: 'right' })` で発火しない実装では、操作用ロケータで引いた可視要素の `boundingBox()` を取得し、
  中心座標へ `page.mouse.click(x, y, { button: 'right' })` を送る（`button` は `left` / `right` / `middle`。出典: <https://playwright.dev/docs/api/class-mouse#mouse-click>）。
  role が画面外のミラー要素に付く場合があるため、判定用ロケータの座標を流用しない
- **本スキルで最も工数を食う箇所**であり、見積もりで過小評価しない

## 配置の指針

プロジェクト規約があればそちらを優先し、**実際のパスを `metadata.json` に記録する**（`parity-replace` / `parity-diff` はパスを推測せず `metadata.json` から引く）。規約が無ければ既定として:

| 種別 | 既定の配置 |
|---|---|
| スペック（現・新の両方に当てるもの） | `<parity_suite_dir>/parity/<slug>/` |
| **現側専用スペック**（ベースライン採取・ノイズ基準値測定・強度ゲート） | `<parity_suite_dir>/parity/<slug>/current-only/` |
| **新側専用スペック**（新側ベースライン採取・新側の自己ノイズ測定。置くのは `parity-diff`。本スキルは場所・除外・`new-capture` プロジェクトだけ用意する） | `<parity_suite_dir>/parity/<slug>/new-only/` |
| 現側マッピング | `<parity_suite_dir>/parity/lib/locator-map/<slug>.ts` |
| 期待値解決層 | `<parity_suite_dir>/parity/lib/expectations/<slug>.ts` |
| 操作アダプタ | `<parity_suite_dir>/parity/lib/interactions/` |
| プロジェクトが自分で書くツール（画素差分の呼び出し・aria 比較等） | `<parity_suite_dir>/parity/lib/tools/` |
| **決定論的ツール（同梱 scripts のコピー）** | `<parity_suite_dir>/parity/lib/tools/vendor/` |

**同梱スクリプトのコピーは、プロジェクト自作のツールと同じディレクトリに置かない。** コピーは修正しない規約（正本はスキル側で、`gh skill update` の更新を取り込む）である一方、自作ツールは通常のコードとして扱う。同居させるとこの 2 つを**パスで分けられず**、整形・リント・レビューの対象をコピー側にも巻き込む。既定として `tools/vendor/` のようなコピー専用のサブディレクトリを切り、プロジェクトの整形・リント設定からパスで除外できる状態にしておく（除外するか否かの規約自体はプロジェクト側の判断であり、本スキルは決めない）。

Playwright の `projects` は `current` / `new` / `new-capture` の 3 つを定義し、**本スキルでは `current` のみ実行する**（`new` は `parity-replace` の green 検証、`new-capture` は `parity-diff` の新側ベースライン採取が実行する）。

### side 専用スペックは相手側の project から `testIgnore` で除外する（両向き）

**ベースライン採取・ノイズ基準値測定・強度ゲートのスペックは現側専用**であり、`projects` で分けないと `new` プロジェクトの実行にも含まれる。
**成果物を書き出すスペックは特に危険で、新側の実行が現側の証跡（ベースライン・強度ゲートの結果ファイル）を静かに上書きする**（実際に上書きした事例がある）。

**除外は両向きに要る。** `parity-diff` が後から `new-only/` へ置く新側採取スペックが `current` プロジェクトの実行に混ざると、
**現行アプリの画面が新側ベースラインとして書き出され、差分ゼロに化ける**（現側の証跡が壊れるのではなく、新側の証跡が偽物になる）。
`new-only/` はこの時点では空でよい——**除外はディレクトリの存在に依らない**ので、スイート構築時に両向きとも設定しておく。

**新側採取スペックは `new` ではなく専用の `new-capture` プロジェクトで走らせる。** `new` は `parity-replace` が green 検証で回すプロジェクトであり、
採取スペックは採取専用の環境変数（slug・target・撮影パス）をモジュール読み込み時に要求する。`new` に残すと **`parity-replace` の green 検証がテスト収集の時点で落ち**、往復ループが進まなくなる。
`new-capture` は `new` と同じ baseURL 配線を使い、`testDir` を `new-only/` に絞る（`new` 側は `new-only/` も `testIgnore` する）。

- 現側専用スペックを上表の `current-only/` に集め、`new` プロジェクトに `testIgnore` を設定して除外する。`testIgnore` に一致したファイルはテストとして実行されない
  （glob 文字列または正規表現。照合は絶対パスに対して行われる。出典: <https://playwright.dev/docs/api/class-testproject#test-project-test-ignore>）
- **除外は `projects` 側で行う**（スペック内の条件分岐に頼らない。分岐は書き忘れが検出されず、書き出し済みのファイルは戻せない）。
  この規則は**ファイル単位の除外**に対するもので、[`coverage.md`](coverage.md) の「同じページに乗る他機能の在席」が使う**テスト単位のスキップ**（新側未実装の機能を `new` でだけ飛ばし、実装後に外す）は対象外——成果物を書き出さず、外し忘れは在席が緑にならないことで見える
- **除外の対象は「現側パスへ成果物を書き出すスペック」**であり、`parity-diff` の新側ベースライン取得を止めるものではない（新側は環境別の `new/<target>/baseline-new/` へ書く。手順の正本は `parity-diff` の `references/capture-new.md`）
- `testIgnore` を設定したことと対象パターン、および `new-capture` プロジェクト名を、現側専用は `metadata.json` の `suite.current_only`、新側専用は `suite.new_only` に記録する
  （前者は `parity-replace` が新側実行前に、後者は `parity-diff` が新側採取スペックの置き場所・除外の有無・実行するプロジェクト名を確認するために読む）

```ts
// playwright.config.ts（抜粋。パスはプロジェクト規約に合わせる）
projects: [
  {
    name: 'current',
    use: { baseURL: process.env.PARITY_CURRENT_UI_URL },
    testIgnore: '**/new-only/**',
  },
  {
    name: 'new',
    use: { baseURL: process.env.PARITY_NEW_UI_URL },
    // parity-replace の green 検証用。採取スペックは走らせない（収集時に採取用の環境変数を要求するため）
    testIgnore: ['**/current-only/**', '**/new-only/**'],
  },
  {
    name: 'new-capture',
    use: { baseURL: process.env.PARITY_NEW_UI_URL },
    // parity-diff の新側ベースライン採取専用。testDir を new-only/ に絞る
    testDir: 'e2e/parity/<slug>/new-only',
  },
],
```

`current` / `new` の baseURL は、選択した target から解決した環境変数 `PARITY_CURRENT_UI_URL` / `PARITY_NEW_UI_URL`（API は `PARITY_CURRENT_API_URL` / `PARITY_NEW_API_URL`）を参照する形で書く（URL を config に直書きしない）。
`url_command` を持つ target は、そのコマンドを実行して得た URL を環境変数へ入れる（解決規則の正本は `replace-strategy` の `references/project-config.md`）。
**この環境変数の配線が本スキルの正本**であり、`parity-replace` / `parity-diff` は新側 target から `PARITY_NEW_*` を解決して同じ配線に流す。
実行は選択した target の URL を環境変数に解決して渡す（`<url>` はプレースホルダ。値を成果物に書かない）:

```bash
# playwright の起動はプロジェクトのパッケージマネージャに読み替える（npx / pnpm exec / yarn 等）
PARITY_CURRENT_UI_URL=<url> PARITY_CURRENT_API_URL=<url> npx playwright test --project current
```

`new` 側の target 選択と green 化は `parity-replace` 段階で行われるため、本スキルでは `PARITY_NEW_UI_URL` は未設定でよい。
