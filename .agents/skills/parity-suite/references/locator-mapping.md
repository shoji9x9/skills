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
- **引き方と検証は自動で待つ API に限る。** 要素は Locator で保持し、検証は `expect(locator).toBeVisible()` / `toHaveText()` / `toHaveCount()` 等の自動リトライ assertion で行う。
  `page.$` / `page.$$`、`elementHandle()` / `elementHandles()`、要素が揃うのを待たない `locator.all()`、assertion を通さない
  `textContent()` / `innerText()` / `inputValue()` / `getAttribute()` / `count()` / `isVisible()` 等の即時読み取り、`waitForTimeout()` による固定待機は禁止する。
  現行のサーバー描画で安定しても、新側のクライアント描画では描画完了前の値を読むためである（Locator と assertion の自動待機: <https://playwright.dev/docs/actionability#assertions>、`locator.all()` は待たない: <https://playwright.dev/docs/api/class-locator#locator-all>）。
  authoring 後は `node <skill>/scripts/auto-wait-check.mjs <parity_suite_dir>/parity/` を実行し、対象ファイル数が 1 件以上・違反 0 件・判定不能 0 件であることを確認する（検査の届く範囲と免除は下の「検査が受け側を解決できる書き方」）
- **判定用と操作用のロケータを分けてよい。** データグリッド等は `role="columnheader"` を画面外のミラー要素に付けることがあり、role では意味を判定できても、
  その要素の `boundingBox()` を使ったポインター操作は画面外へ送られる。判定は role ＋アクセシブルネームを保ち、座標を使う操作は実際に描画されている要素を操作アダプタで引く
  （`boundingBox()` は要素の座標を返す。出典: <https://playwright.dev/docs/api/class-locator#locator-bounding-box>）
- **id / name をアンカーにしない。** 自動生成された id は変更対象になりうるうえ、比較の足がかりにすると id を変更できなくなる
- **例外率を決めてかからない。** role ＋アクセシブルネームで引ける割合は `replace-strategy` のセマンティクス測定が実測で出す。実測では過半が無改造で両実装に解決したが、割合は現行アプリの実装次第であり、例外が大半を占めることもありうる

### 検査が受け側を解決できる書き方

`auto-wait-check.mjs` は**受け側**（禁止 API を呼んでいるオブジェクト）を解決してから違反を判定する。
解決は同一ファイル内の情報だけで行うため、**解決できたか否かを出力に出す**——
`ok:` / `error:` の行が `走査 N ファイル / 禁止 API の呼び出し N 件 / 受け側を解決 N 件 / 判定不能 N 件 / Playwright 以外と確定 N 件 / 採取スペックで免除 N 件` を必ず示す。
**違反 0 件は「検査が届いた」ことの証拠にならない**ので、件数と合わせて読む。
各呼び出しは「解決」「判定不能」「Playwright 以外と確定」のどれか 1 つに必ず数える（免除は解決の内数）。
内訳が呼び出し数と合わないファイルがあれば、走査器が呼び出しを数えずに捨てているので exit 2 で止まる。

解決できる形:

| 形 | 例 | 解決の根拠 |
|---|---|---|
| 引数・変数の `page` / `locator` | `page.getByRole(…)` | 名前と `: Page` / `: Locator` の型注釈 |
| メンバー式（Page Object・画面オブジェクト） | `this.page.locator(…)` / `screen.page.waitForTimeout(…)` | チェーンの**各区間**の名前を照合する（起点が `this` や未知のオブジェクトでも、途中の `page` / `locator` で解決する） |
| 束ねた別名 | `const row = this.page.locator("tr")` の `row` | 代入の右辺の**先頭チェーンの各区間**を照合する（起点だけを見ると `this` で止まる） |
| 同一ファイル内の関数・メソッド | `pagerValue(view).innerText()` / `this.gridRows().count()` | 戻り値の型注釈（`function f(…): Locator` / `const f = (…): Locator =>` / クラス・オブジェクトのメソッド `f(…): Locator {`。型引数 `f<T>(…)` と関数型の引数があっても読む）。**呼ばれている区間にだけ当てる**ので、同名の未呼び出しプロパティは影響しない |
| 括弧で包んだ await | `(await pagerValue(view)).innerText()` | 括弧の中身の末尾を受け側として辿る（`Promise<Locator>` を返す関数はこれが型的に正しい呼び方） |
| 型アサーション | `const row = raw as Locator` / `const row = <Locator>raw`（`.ts` / `.mts` / `.cts` のみ） | **型注釈と同じ宣言**として読む。角括弧の形は JSX を持ちうる `.tsx` では TypeScript 自身が禁じているので読まない（`const el = <div>…</div>` を誤読しないため）。`as` が括弧・角括弧・波括弧の**内側**にある形（`helper(x as Locator)`）は別名の宣言ではないので読まない |

**名前で解決できない形が混じっていて、どの区間も `page` / `locator` に解決しなかったときは
`unresolved-receiver` として報告し、非ゼロ終了する（fail-closed）。** 黙って違反 0 件へ倒さないための分岐で、
理由ごとに直し方を出し分ける。

| 理由 | 例 | 直し方 |
|---|---|---|
| 関数呼び出しの戻り値が経路に混じる（型注釈が同一ファイルに無い。起点でも途中でも同じ） | `gridRows(view).count()` / `helpers.gridRows(view).count()` | その関数の戻り値へ `Locator` / `Page` の型注釈を付ける（別ファイルの関数なら、そのファイルに注釈があっても読めないので呼ぶ側で束ね直す） |
| 束ねた変数の由来を追えない | `const rows = importedHelper();` / `const rows = model.rows;` の `rows` | 右辺の関数の戻り値、またはプロパティへ型注釈を付ける（`{ rows: Locator }`）。**ローカル変数へ束ねても消えない**——束ねれば検査から外れる抜け道は作っていない |
| `Page` / `Locator` 以外へ型アサーションした別名 | `const row = raw as Foo;` / `const row = <Foo>raw;` の `row` | アサート先を `Locator` / `Page` にするか、右辺の由来へ型注釈を付ける。**型アサーションを挟んでも消えない**——挟めば検査から外れる抜け道は作っていない |
| 名前の束縛を読めない（Page / Locator 以外の注釈を含む引数・分割代入・再代入・for-of・import・未宣言の名前・`this` のプロパティ） | `function f(loc) { loc.count() }` / `const { rows } = make(page)` / `import { rows } from "./mapping"` | 束縛へ `Locator` / `Page` の型注釈を付ける（`this` のプロパティならクラスのフィールド宣言へ）。Playwright 以外の値は `document` / `window` を起点にした式で直接読む（型注釈は根拠にしない） |
| 添字アクセスでプロパティ名が読めない | `this["page"].textContent()` / `rows[0].count()` | プロパティ名で引いた値をローカル変数へ束ねる（`const page = this.page;`） |
| 起点が確定できない（括弧の中身も解決しない・リテラル） | `(a + b).count()` / `[1, 2].count()` | `Page` / `Locator` に解決する式から引く |

**どれにも解決しない受け側は、起点の名前が Playwright 以外と確定したときだけ `Playwright 以外と確定 N 件` に数え、
それ以外は判定不能にする。** 確定の根拠は次の閉じた集合に限る（「解決しなかったら対象外」にすると、読んでいない束縛の形が黙って消える）。

- 同一ファイルの `const` / `let` / `var x = <右辺>` で、右辺がリテラル・起点が全て確定済みの式（`limit + 1`。プロパティ参照・
  呼び出し・添字・括弧を含まない）・閉じた JSX 要素、または Page から取り出した Page API の既知のプロパティ（`clock` / `keyboard` / `mouse` / `touchscreen` / `request` / `coverage` / `accessibility`。同じファイルで代入し直した名前は除く）。
  対象外に数えるのはその名前そのもの（`x.count()`）だけで、プロパティを辿った先（`x.row.count()`）は後から Locator を
  代入できるので確定にしない
- 標準の組み込み `Promise` / `console` / `document` / `window`（`Promise.all()` / `console.count()` / `evaluate` の中の DOM）。同じファイルでプロパティへ書き込んだ組み込み（`window.row = …` / `Object.assign(window, …)`）は除く

**型注釈と関数値は根拠にしない。** 型名の中身はファイルの外にありうる（import した型エイリアス・型引数・構造的な interface）、
関数値は呼び出し・タグ付きテンプレートの戻り値と見分けられない。そのため `(e: Element) => e.getAttribute(…)` のような
DOM を扱う callback の引数も判定不能になる。Locator / Page なら束縛へ型注釈（`loc: Locator`）を付け、
Playwright 以外の値は `document` / `window` を起点にした式で直接読む。

名前はファイル全体で 1 つとして扱う（スコープを見ない）ので、同じ名前が根拠の無い形でも束縛されていれば
（引数・分割代入・再代入・import・2 つ目の宣言）確定にしない。

**逆に、チェーンのどこかが `page` / `locator` に解決すれば、同じ形でも判定不能にはしない**
（`page["x"].locator("a").count()` は解決する）。**解決できた受け側は、規則の要求と合わなくても
`受け側を解決 N 件` に数える**——合致だけを数えると「解決できた」と「規則が当たった」が区別できず、
件数が測れた量を示さなくなる。

抑止フラグは用意しない——検査から外す道を作ると、外したことが出力に現れない。

**`current-only/` の採取スペックだけは `immediate-read` を免除する。** 採取は値を記録するための読み取りで、
置き換える assertion を持たない（`SKILL.md` は採取物を参考資料と位置づけ、assertion にしないことを定めている）。
免除は**この 1 規則・この 1 ディレクトリに閉じる**——同じ場所でも `waitForTimeout()` による固定待機・
`locator.all()`・`page.$` / `elementHandle()` は免除しない（採取したベースラインが不完全・非決定的になる）。
免除した件数は `採取スペックで免除 N 件` として出力に出る。

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

**スイートは現・新の両方に当てて両方で green である必要がある。** 一方で意図的差異レジストリ `intentional_diffs` は散文の宣言が主で、期待値（現側・新側の値）を持たない（任意の `match` は差分を照合する鍵であって期待値ではない）ため、「現側ではこの値、新側ではこの値を期待する」を**スイートのどこかで解決する層**が要る。それが期待値解決層で、ロケータマッピング層とは別に置く（引き方と期待値を同じ場所に混ぜない）。

- **既定は side 共通の 1 値**。side 別に分けるのは、`intentional_diffs.may_change` に**宣言済みの差**に触れる assertion だけ。宣言に無い差を勝手に side 別にしない（＝新側の不一致を期待値で吸収して緑にすることになる。レジストリに無い差は `intentional_diffs.pending` へ回してユーザー確認）
- **現行の弱点を「直す」と仕分けた行（`.replace/weaknesses.md` の `仕分け: 直す`、宣言は `may_change`）に触れる振る舞いは、side 共通の期待値に固定しない**——
  固定すると、スイートが現行の弱い振る舞いを正解として守り、新側で塞いだ瞬間に赤くなる（直すたびに期待値の書き換えが要る）。
  対象 slug の経路に当たる行ごとに、**弱点が成立する入力を 1 つ assertion にし**（例: 書き込みの API へ `text/plain` で送る）、現側の値に現行の振る舞いを書き、新側は未定として `parity-replace` に渡す。
  正規の使い方の assertion は side 共通のまま残す（基準 3 で振る舞いが変わらないと決めたものなので、分けると塞いだ副作用を見逃す）。
  特性化の途中で台帳に無い弱点に気づいたら、仕分けを空欄にした行を `.replace/weaknesses.md` へ非破壊追記し、宣言の案を `pending` へ回す（仕分けの正本は `replace-strategy` の `references/security.md`）
- **side 別にした項目には、根拠となるレジストリの該当項目を隣にコメントで書く**。これが無いと後から「なぜ 2 値なのか」を復元できない
- **side の解決は Playwright の `projects` 名（`current` / `new`）から行う**。テスト内では `testInfo.project.name` で参照できる
  （出典: <https://playwright.dev/docs/api/class-testinfo#test-info-project> / <https://playwright.dev/docs/api/class-testproject#test-project-name>）。
  環境変数や `baseURL` の中身で side を判定しない（projects 名が本スキルの確定契約）
- **本スキルが埋めるのは現側の値だけ**（マッピング層と同じく片側ずつ埋まる）。新側の値は `parity-replace` が埋める。現側だけの時点では、新側の値は未定として置き、`new` プロジェクトの green 化時に埋まる
- 配置の既定は後述の「配置の指針」の表（実際のパスは `metadata.json` の `suite.expectations` に記録し、`parity-replace` が推測せず引く）
- **表示を切り替える軸（ロケール等）で変わる文言・振る舞いは、期待値に軸の値の次元を足して持つ**（論理名 → 軸の値 → side 別の期待値）。
  スイートは軸の値ごとに `applyDisplayAxes` で値を当ててから assertion を回す（見出しの文言をロケールごとに期待する等）。
  既定の値だけで書くと、スイートは既定の値でしか緑を示さず、他の値での差は視覚ベースラインにしか写らない。
  次元を足した層のパスは軸ごとに `metadata.json` の `capture_conditions.display_axes.axes[].suite_expectations` に書く（軸の数え方の正本は [`baseline.md`](baseline.md)「表示を切り替える軸（掛け合わせずに撮る）」）

## 操作の実装差を吸収する層

**ロケータが移植可能でも、操作は移植可能ではない。** `getByRole('combobox')` が両実装で要素を見つけても、`selectOption()` はネイティブ `<select>` でない実装では落ちる、という類のずれが起きる。

- **Select / Autocomplete / Date picker / Modal / Menu / Context menu（右クリック）は実装ごとの分岐が必須**。操作は論理名の裏に操作アダプタとして隠し、スイート本体は論理名と操作意図だけを書く
- **右クリックは発火を観測して送り方を決める。** `locator.click({ button: 'right' })` で発火しない実装では、操作用ロケータで引いた可視要素の `boundingBox()` を取得する。
  `expect.poll` で矩形が `null` でなく幅・高さがともに正、かつ中心座標の `document.elementFromPoint()` が操作用要素または子孫を返す状態まで自動リトライし、その条件を満たした直後だけ、
  その座標へ `page.mouse.click(x, y, { button: 'right' })` を送る（出典: [Playwright `boundingBox`](https://playwright.dev/docs/api/class-locator#locator-bounding-box)・
  [`mouse.click`](https://playwright.dev/docs/api/class-mouse#mouse-click)・[`expect.poll`](https://playwright.dev/docs/test-assertions#expectpoll)・
  [CSSOM View `elementFromPoint`](https://drafts.csswg.org/cssom-view/#dom-document-elementfrompoint)）。
  role が画面外のミラー要素に付く場合があるため判定用ロケータの座標を流用せず、hit-test が別要素を返す座標にも操作を送らない
- **表示の軸の値を当てる関数（`applyDisplayAxes(page, 値)`）も操作アダプタに置く**。受け取るのは「軸の名前 → 値」で、全軸の値を当ててから返す
  （当て方は軸ごとに `display_axes.axes[].apply` に書いたとおり。再読み込みを伴うなら、再読み込み後に落ち着くまで待つ）。
  採取スペック・スイート・`parity-diff` の新側採取が同じ関数を呼ぶ（正本は [`baseline.md`](baseline.md)「表示を切り替える軸（掛け合わせずに撮る）」）
- **撮影状態へ遷移する関数（`applyState`）は、撮る対象の矩形が 2 回続けて同じ値になるまで待ってから返す**（出現待ちで止めない。要件と実装例の正本は [`baseline.md`](baseline.md)「撮る対象が動かなくなるまで待つ」）
- **本スキルで最も工数を食う箇所**であり、見積もりで過小評価しない

## 配置の指針

プロジェクト規約があればそちらを優先し、**実際のパスを `metadata.json` に記録する**（`parity-replace` / `parity-diff` はパスを推測せず `metadata.json` から引く）。規約が無ければ既定として:

| 種別 | 既定の配置 |
|---|---|
| スペック（現・新の両方に当てるもの） | `<parity_suite_dir>/parity/<slug>/` |
| **現側専用スペック**（ベースライン採取・ノイズ基準値測定・強度ゲート） | `<parity_suite_dir>/parity/<slug>/current-only/` |
| **新側専用スペック**（新側ベースライン採取・新側の自己ノイズ測定。置くのは `parity-diff`。本スキルは場所・除外・`new-capture` プロジェクトだけ用意する） | `<parity_suite_dir>/parity/<slug>/new-only/` |
| **寸法の決まり方の測定スペック**（side 非依存。`current` / `new` の両方で走り、project 名で出力先を分ける。正本は [`baseline.md`](baseline.md)「寸法の決まり方（窓への追従）」） | `<parity_suite_dir>/parity/<slug>/dimension/` |
| 現側マッピング | `<parity_suite_dir>/parity/lib/locator-map/<slug>.ts` |
| 期待値解決層 | `<parity_suite_dir>/parity/lib/expectations/<slug>.ts` |
| 操作アダプタ | `<parity_suite_dir>/parity/lib/interactions/` |
| 共通のフィクスチャ（利用者環境のブラウザへ接続する target があるときだけ。後述「利用者環境のブラウザへ接続する」） | `<parity_suite_dir>/parity/lib/fixtures.ts` |
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
// スクロールバーが場所を取る状態で撮る（capture_conditions.scrollbars の既定 shown。ヘッドレス Chromium の既定の --hide-scrollbars を外す）。
// 3 プロジェクトとも同じ扱いにする（片側だけ場所を取ると見える幅と高さが厚みの分ずれる。正本は references/baseline.md「スクロールバーが場所を取る窓のはみ出し」）。
// hidden で撮ると決めた（scrollbars_reason を書いた）ときだけ launchOptions を外す
projects: [
  {
    name: 'current',
    use: { baseURL: process.env.PARITY_CURRENT_UI_URL, launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } },
    testIgnore: '**/new-only/**',
  },
  {
    name: 'new',
    use: { baseURL: process.env.PARITY_NEW_UI_URL, launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } },
    // parity-replace の green 検証用。採取スペックは走らせない（収集時に採取用の環境変数を要求するため）
    // dimension/ は除外しない（PARITY_DIMENSION_CAPTURE=1 のときだけ新側の寸法を new/<PARITY_NEW_TARGET>/ へ採る）
    testIgnore: ['**/current-only/**', '**/new-only/**'],
  },
  {
    name: 'new-capture',
    use: { baseURL: process.env.PARITY_NEW_UI_URL, launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } },
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
`dimension/` の測定スペックは `PARITY_DIMENSION_CAPTURE=1` の実行でだけ書き、`new` ではさらに `PARITY_NEW_TARGET`（選択した新側 target 名）で出力先 `new/<target>/` を決める（未設定なら書かずに落ちる。別 target の samples を上書きしないため）。
通常の green 検証・強度ゲートでは `PARITY_DIMENSION_CAPTURE` を渡さない（スキップされる）。

### 利用者環境のブラウザへ接続する（`browser.cdp_url`）

選択した target が `browser.cdp_url` を宣言していれば（スキーマの正本は `replace-strategy` の `references/project-config.md`「実行対象環境」）、
Playwright が起動したブラウザではなく、**利用者環境で起動したブラウザ（デバッグのポートを開けた Chromium 系）へ `connectOverCDP` で接続して撮る**。
スイート・差分器・成果物は今の環境のまま、描画だけが利用者環境で行われる（理由は [`baseline.md`](baseline.md)「採取環境と利用者環境の乖離」）。

- **接続は共通のフィクスチャ `<parity_suite_dir>/parity/lib/fixtures.ts` で、組み込みの `browser` フィクスチャを上書きして行う**。
  スペックは `@playwright/test` ではなくこのファイルから `test` を import する（上書きを通らないスペックは、宣言があっても起動したブラウザで撮る）。
  **接続したらワーカーの環境変数 `PARITY_CDP_CONNECTED` に印を立て、採取スペックは撮る前にこの印を確かめる**（環境変数 `PARITY_*_CDP_URL` の有無だけでは、import の差し替え漏れを見分けられない）
  接続先は side ごとの環境変数 `PARITY_CURRENT_CDP_URL` / `PARITY_NEW_CDP_URL`（target の `browser.cdp_url` から解決する。値を成果物に書かない）で、未設定の実行は Playwright がブラウザを起動する
- `connectOverCDP` は Chromium 系だけに使え、`browserType.connect` より忠実度が低い。接続したブラウザの `close()` はこちらが作ったコンテキストを片付けて切断するだけで、利用者のブラウザは閉じない
  （出典: <https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp> / <https://playwright.dev/docs/api/class-browser#browser-close> /
  組み込みフィクスチャの上書き <https://playwright.dev/docs/test-fixtures#overriding-fixtures>）
- **現・新の両側に同じ宣言を要求する**——片側だけ利用者環境で撮ると、環境の差がそのまま差分に出る。撮影に使ったブラウザは `metadata.json` の `capture_conditions.browser`（`launched` / `cdp`）に残し、
  `cdp` では接続先の同一性を `capture_conditions.browser_identity`（`product`: `browser.version()`、`user_agent`: `navigator.userAgent`）にも残す。
  `parity-diff` は新側 target の宣言がこれと合わない、または接続したブラウザの同一性が違えば撮影せず停止する
  （出典: <https://playwright.dev/docs/api/class-browser#browser-version> / 起動・接続の選択肢 <https://playwright.dev/docs/api/class-testoptions>（`connectOptions` を含む）/ <https://playwright.dev/docs/api/class-browsertype#browser-type-connect>）

```ts
// <parity_suite_dir>/parity/lib/fixtures.ts（抜粋）
import { test as base, chromium, firefox, webkit, type Browser } from "@playwright/test";

export const test = base.extend<{}, { browser: Browser }>({
  browser: [
    // 組み込みの browser に依存しない（依存すると cdp でもローカルのブラウザが先に起動し、無い環境ではそこで落ちる）。
    // CDP で接続しない分岐は組み込みと同じく、use.connectOptions があれば connect()、無ければ launchOptions / headless / channel で launch()
    async ({ browserName, launchOptions, headless, channel, connectOptions }, use, workerInfo) => {
      const side = workerInfo.project.name === "current" ? "CURRENT" : "NEW";
      const cdpUrl = process.env[`PARITY_${side}_CDP_URL`];
      if (!cdpUrl) {
        const browserType = { chromium, firefox, webkit }[browserName];
        const opened = connectOptions
          ? await browserType.connect(connectOptions.wsEndpoint, connectOptions)
          : await browserType.launch({ ...launchOptions, headless, channel });
        await use(opened);
        await opened.close();
        return;
      }
      const connected = await chromium.connectOverCDP(cdpUrl);
      // 接続した印。上書きを通らないスペック（@playwright/test から test を import したもの）はこれを立てられないので、
      // 採取スペックはこの印を確かめて、起動したブラウザで撮ったまま cdp として記録する経路を落とす
      process.env.PARITY_CDP_CONNECTED = "1";
      await use(connected);
      await connected.close(); // 接続したブラウザでは切断だけ（利用者のブラウザは閉じない）
    },
    { scope: "worker" },
  ],
});
export { expect } from "@playwright/test";
```
