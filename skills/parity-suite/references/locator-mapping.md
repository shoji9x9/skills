# ロケータマッピング層と操作差分の吸収

パリティスイートは**論理名**（例:「保存ボタン」）で書き、マッピング層が現・新それぞれのロケータへ解決する。論理名そのものが**現・新をまたぐ契約**である。

## ロケータマッピング層

- **目的は現行アプリの非セマンティックな箇所を隔離すること。** これにより、新側でアクセシビリティを改善してもリントを off にせずに済む
- **原則は role ＋アクセシブルネーム。** `getByRole` / `getByLabel` はマークアップの詳細ではなく意味で要素を引くため、フレームワークやコンポーネントライブラリが違っても同じ記述が両実装に当たりうる
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

## 操作の実装差を吸収する層

**ロケータが移植可能でも、操作は移植可能ではない。** `getByRole('combobox')` が両実装で要素を見つけても、`selectOption()` はネイティブ `<select>` でない実装では落ちる、という類のずれが起きる。

- **Select / Autocomplete / Date picker / Modal / Menu は実装ごとの分岐が必須**。操作は論理名の裏に操作アダプタとして隠し、スイート本体は論理名と操作意図だけを書く
- **本スキルで最も工数を食う箇所**であり、見積もりで過小評価しない

## 配置の指針

プロジェクト規約があればそちらを優先し、**実際のパスを `metadata.json` に記録する**（`parity-replace` / `parity-diff` はパスを推測せず `metadata.json` から引く）。規約が無ければ既定として:

| 種別 | 既定の配置 |
|---|---|
| スペック（現・新の両方に当てるもの） | `<parity_suite_dir>/parity/<slug>/` |
| **現側専用スペック**（ベースライン採取・ノイズ基準値測定・強度ゲート） | `<parity_suite_dir>/parity/<slug>/current-only/` |
| 現側マッピング | `<parity_suite_dir>/parity/lib/locator-map/<slug>.ts` |
| 操作アダプタ | `<parity_suite_dir>/parity/lib/interactions/` |
| 決定論的ツール（同梱 scripts のコピー） | `<parity_suite_dir>/parity/lib/tools/` |

Playwright の `projects` は `current` / `new` の 2 つを定義し、**本スキルでは `current` のみ実行する**。

### 現側専用スペックは `new` から `testIgnore` で除外する

**ベースライン採取・ノイズ基準値測定・強度ゲートのスペックは現側専用**であり、`projects` で分けないと `new` プロジェクトの実行にも含まれる。
**成果物を書き出すスペックは特に危険で、新側の実行が現側の証跡（ベースライン・強度ゲートの結果ファイル）を静かに上書きする**（実際に上書きした事例がある）。

- 現側専用スペックを上表の `current-only/` に集め、`new` プロジェクトに `testIgnore` を設定して除外する。`testIgnore` に一致したファイルはテストとして実行されない
  （glob 文字列または正規表現。照合は絶対パスに対して行われる。出典: <https://playwright.dev/docs/api/class-testproject#test-project-test-ignore>）
- **除外は `projects` 側で行う**（スペック内の条件分岐に頼らない。分岐は書き忘れが検出されず、書き出し済みのファイルは戻せない）。
  この規則は**ファイル単位の除外**に対するもので、[`coverage.md`](coverage.md) の「同じページに乗る他機能の在席」が使う**テスト単位のスキップ**（新側未実装の機能を `new` でだけ飛ばし、実装後に外す）は対象外——成果物を書き出さず、外し忘れは在席が緑にならないことで見える
- **除外の対象は「現側パスへ成果物を書き出すスペック」**であり、`parity-diff` の新側ベースライン取得を止めるものではない（新側は環境別の `new/<target>/baseline-new/` へ書く。手順の正本は `parity-diff` の `references/capture-new.md`）
- `testIgnore` を設定したことと対象パターンを `metadata.json` の `suite.current_only` に記録し、`parity-replace` が新側実行前に確認できるようにする

```ts
// playwright.config.ts（抜粋。パスはプロジェクト規約に合わせる）
projects: [
  { name: 'current', use: { baseURL: process.env.PARITY_CURRENT_UI_URL } },
  {
    name: 'new',
    use: { baseURL: process.env.PARITY_NEW_UI_URL },
    testIgnore: '**/current-only/**',
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
