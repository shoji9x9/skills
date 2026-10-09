# ロケータマッピング層・期待値解決層・操作差分の吸収

パリティスイートは**論理名**（例:「保存ボタン」）で書き、マッピング層が現側・新側それぞれのロケータに解決する。論理名そのものが、現側と新側をまたぐ取り決めである。

スイート本体から切り出す層は 3 つあり、役割で分ける。混ぜると、片方の変更がもう片方を誤らせる。

| 層 | 受け持つこと | 片側ずつ埋まるか |
|---|---|---|
| ロケータマッピング層 | **どう取得するか**（論理名 → ロケータ） | 現側はこのスキル、新側の例外は `parity-replace` が埋める |
| 期待値解決層 | **何を期待するか**（論理名 → side 別の期待値） | 同上 |
| 操作アダプタ | **どう操作するか**（論理名 → 操作の実装の差） | 同上 |

## ロケータマッピング層

- 目的は、現行アプリのセマンティックでない箇所を隔離することである。これで、新側でアクセシビリティを改善しても、リントを off にせずに済む。
- 原則は role ＋アクセシブルネームで取得する。
  `getByRole`・`getByLabel` はマークアップの詳細ではなく意味で要素を取得する。そのため、フレームワークやコンポーネントライブラリが違っても、同じ記述が両方の実装に当たりうる。
- 取得と検証には、自動で待つ API だけを使う。要素は Locator で保持し、検証は `expect(locator).toBeVisible()`・`toHaveText()`・`toHaveCount()` などの自動リトライの assertion で行う。
  次のものは禁止する。
  - `page.$`・`page.$$`、`elementHandle()`・`elementHandles()`
  - 要素がそろうのを待たない `locator.all()`
  - assertion を通さずにすぐ読む `textContent()`・`innerText()`・`inputValue()`・`getAttribute()`・`count()`・`isVisible()` など
  - `waitForTimeout()` による固定の待ち

  現行のサーバー描画では安定していても、新側のクライアント描画では、描画が終わる前の値を読むからである。
  出典は、Locator と assertion の自動の待ち（<https://playwright.dev/docs/actionability#assertions>）と、`locator.all()` が待たないこと（<https://playwright.dev/docs/api/class-locator#locator-all>）。
  authoring の後は `node <skill>/scripts/auto-wait-check.mjs <parity_suite_dir>/parity/` を実行する。
  対象ファイルが 1 件以上、違反が 0 件、判定不能が 0 件であることを確かめる（チェックが届く範囲と免除は、下の「検査が受け側を解決できる書き方」にある）。
- 判定用のロケータと操作用のロケータは分けてよい。
  データグリッドなどは、`role="columnheader"` を画面の外のミラー要素に付けることがある。role では意味を判定できても、その要素の `boundingBox()` を使ったポインターの操作は画面の外に送られる。
  判定は role ＋アクセシブルネームのまま保ち、座標を使う操作は、実際に描画されている要素を操作アダプタで取得する
  （`boundingBox()` は要素の座標を返す。出典: <https://playwright.dev/docs/api/class-locator#locator-bounding-box>）。
- id・name を手がかりにしない。自動で生成された id は変わりうる。また、比べるときの手がかりにすると、id を変更できなくなる。
- 例外の割合を前もって決めない。
  role ＋アクセシブルネームで取得できる割合は、`replace-strategy` のセマンティクスの測定が実測で出す。
  実測では過半数が改造なしで両方の実装に解決したが、割合は現行アプリの実装によって決まり、例外が大半になることもありうる。

### 検査が受け側を解決できる書き方

`auto-wait-check.mjs` は、受け側（禁止した API を呼んでいるオブジェクト）を解決してから違反を判定する。
解決には同じファイルの中の情報だけを使うので、解決できたかどうかを出力に出す。
`ok:`・`error:` の行は、次の件数を必ず示す。

`走査 N ファイル / 禁止 API の呼び出し N 件 / 受け側を解決 N 件 / 判定不能 N 件 / Playwright 以外と確定 N 件 / 採取スペックで免除 N 件`

**違反が 0 件であることは、チェックが届いた証拠にならない。** 件数と合わせて読む。
それぞれの呼び出しは、「解決」「判定不能」「Playwright 以外と確定」のどれか 1 つに必ず数える（免除は解決の内数）。
内訳が呼び出しの数と合わないファイルがあれば、スキャナが呼び出しを数えずに捨てているので、exit 2 で止まる。

解決できる形は次のとおりである。

| 形 | 例 | 解決の根拠 |
|---|---|---|
| 引数・変数の `page`・`locator` | `page.getByRole(…)` | 名前と、`: Page`・`: Locator` の型注釈 |
| メンバー式（Page Object・画面オブジェクト） | `this.page.locator(…)`・`screen.page.waitForTimeout(…)` | チェーンの**各区間**の名前を照合する（起点が `this` や未知のオブジェクトでも、途中の `page`・`locator` で解決する） |
| 束ねた別名 | `const row = this.page.locator("tr")` の `row` | 代入の右辺の**先頭のチェーンの各区間**を照合する（起点だけを見ると `this` で止まる） |
| 同じファイルの中の関数・メソッド | `pagerValue(view).innerText()`・`this.gridRows().count()` | 戻り値の型注釈（`function f(…): Locator`・`const f = (…): Locator =>`・クラスやオブジェクトのメソッド `f(…): Locator {`。型引数 `f<T>(…)` と関数型の引数があっても読む）。**呼ばれている区間にだけ当てる**ので、同じ名前の呼ばれていないプロパティには影響しない |
| 括弧で包んだ await | `(await pagerValue(view)).innerText()` | 括弧の中身の末尾を受け側としてたどる（`Promise<Locator>` を返す関数は、この呼び方が型として正しい） |
| 型アサーション | `const row = raw as Locator`・`const row = <Locator>raw`（`.ts`・`.mts`・`.cts` だけ） | **型注釈と同じ宣言**として読む。角括弧の形は、JSX を持ちうる `.tsx` では TypeScript 自身が禁じているので読まない（`const el = <div>…</div>` を誤って読まないため）。`as` が括弧・角括弧・波括弧の**内側**にある形（`helper(x as Locator)`）は別名の宣言ではないので読まない |

名前で解決できない形が含まれていて、どの区間も `page`・`locator` に解決しなかったときは、`unresolved-receiver` として報告し、0 以外で終了する。
判定できないときは失敗として扱う分岐で、警告なしに違反 0 件として扱わないためにある。直し方は、理由ごとに出し分ける。

| 理由 | 例 | 直し方 |
|---|---|---|
| 関数呼び出しの戻り値がチェーンに含まれる（型注釈が同じファイルに無い。起点でも途中でも同じ） | `gridRows(view).count()`・`helpers.gridRows(view).count()` | その関数の戻り値に `Locator`・`Page` の型注釈を付ける（別のファイルの関数なら、そのファイルに注釈があっても読めないので、呼ぶ側で束ね直す） |
| 束ねた変数の由来を追えない | `const rows = importedHelper();`・`const rows = model.rows;` の `rows` | 右辺の関数の戻り値か、プロパティに型注釈を付ける（`{ rows: Locator }`）。ローカル変数に束ねても判定不能は消えない。束ねればチェックから外れる、という抜け道は作っていない |
| `Page`・`Locator` 以外に型アサーションした別名 | `const row = raw as Foo;`・`const row = <Foo>raw;` の `row` | アサートする先を `Locator`・`Page` にするか、右辺の由来に型注釈を付ける。型アサーションを挟んでも判定不能は消えない。挟めばチェックから外れる、という抜け道は作っていない |
| 名前の束縛を読めない（Page・Locator 以外の注釈を含む引数・分割代入・再代入・for-of・import・宣言されていない名前・`this` のプロパティ） | `function f(loc) { loc.count() }`・`const { rows } = make(page)`・`import { rows } from "./mapping"` | 束縛に `Locator`・`Page` の型注釈を付ける（`this` のプロパティなら、クラスのフィールドの宣言に付ける）。Playwright 以外の値は、`document`・`window` を起点にした式で直接読む（型注釈は根拠にしない） |
| 添字のアクセスでプロパティ名を読めない | `this["page"].textContent()`・`rows[0].count()` | プロパティ名で取得した値をローカル変数に束ねる（`const page = this.page;`） |
| 起点を確定できない（括弧の中身も解決しない・リテラル） | `(a + b).count()`・`[1, 2].count()` | `Page`・`Locator` に解決する式から取得する |

どれにも解決しない受け側は、起点の名前が Playwright 以外だと確定したときだけ、`Playwright 以外と確定 N 件` に数える。それ以外は判定不能にする。
確定の根拠は、次の閉じた集合に限る。「解決しなかったら対象外」にすると、読んでいない束縛の形が警告なしに消える。

- 同じファイルの `const`・`let`・`var x = <右辺>` で、右辺が次のどれかである。
  - リテラル
  - 起点がすべて確定済みの式（`limit + 1`。プロパティの参照・呼び出し・添字・括弧を含まない）
  - 閉じた JSX の要素
  - Page から取り出した、Page API の既知のプロパティ（`clock`・`keyboard`・`mouse`・`touchscreen`・`request`・`coverage`・`accessibility`。同じファイルで代入し直した名前は除く）

  対象外に数えるのはその名前そのもの（`x.count()`）だけである。プロパティをたどった先（`x.row.count()`）には後から Locator を代入できるので、確定にしない。
- 標準の組み込みの `Promise`・`console`・`document`・`window`（`Promise.all()`・`console.count()`・`evaluate` の中の DOM）。
  同じファイルでプロパティに書き込んだ組み込み（`window.row = …`・`Object.assign(window, …)`）は除く。

型注釈と関数値は根拠にしない。型の名前の中身はファイルの外にありうる（import した型エイリアス・型引数・構造的な interface）。
関数値は、呼び出しやタグ付きテンプレートの戻り値と見分けられない。
そのため、`(e: Element) => e.getAttribute(…)` のような、DOM を扱う callback の引数も判定不能になる。
Locator・Page なら束縛に型注釈（`loc: Locator`）を付け、Playwright 以外の値は `document`・`window` を起点にした式で直接読む。

名前はファイル全体で 1 つとして扱い、スコープを見ない。
そのため、同じ名前が根拠の無い形（引数・分割代入・再代入・import・2 つ目の宣言）でも束縛されていれば、確定にしない。

逆に、チェーンのどこかが `page`・`locator` に解決すれば、同じ形でも判定不能にはしない（`page["x"].locator("a").count()` は解決する）。
解決できた受け側は、規則の求める形と合わなくても `受け側を解決 N 件` に数える。
合ったものだけを数えると、「解決できた」と「規則が当たった」を区別できず、件数が測れた量を示さなくなる。

抑止のフラグは用意しない。チェックから外す方法を作ると、外したことが出力に現れない。

**`current-only/` の採取スペックだけは、`immediate-read` を免除する。**
採取は値を記録するための読み取りで、置き換える assertion を持たない（`SKILL.md` は採取物を参考資料と位置づけ、assertion にしないと定めている）。
免除はこの 1 つの規則と、この 1 つのディレクトリに限る。
同じ場所でも、`waitForTimeout()` による固定の待ち・`locator.all()`・`page.$`・`elementHandle()` は免除しない（採取したベースラインに欠けが出て、結果が毎回変わる）。
免除した件数は、`採取スペックで免除 N 件` として出力に出る。

### マッピングは片側ずつ埋まる

このスキルは新側の開発の前に動くので、論理名の定義と現側のマッピングだけを埋める。

| 段階 | 埋めるもの | 完了の証拠 |
|---|---|---|
| `parity-suite`（このスキル） | 論理名の定義と現側のマッピング | スイートが**現側で green** |
| `parity-replace` | 新側のマッピング（**例外だけ**） | スイートが**新側で green**（＝パリティの証拠） |

**新側に書くのは、論理名で解決できない例外だけである。** role ＋アクセシブルネームで取得できる要素は、同じ論理名がそのまま両方の実装に解決する。

### 脆弱なマッピングの記録

現側のマッピングが、`div` への CSS セレクタのような脆弱な形にならざるを得ない箇所は、その事実をマッピング層のコメントに記録する。
新側で改善が見込める箇所であり、`parity-replace` で新側のマッピングが要らなくなるかを判断する材料になる。記録はマッピング層のコメントでよく、`gaps.md` には書かなくてよい。

## 期待値解決層（side 別の期待値）

スイートは現側と新側の両方に当て、両方で green になる必要がある。
一方で、意図的差異レジストリ `intentional_diffs` は散文の宣言が中心で、期待値（現側の値・新側の値）を持たない。任意の `match` は差分を照合する鍵であって、期待値ではない。
そのため、「現側ではこの値、新側ではこの値を期待する」をスイートのどこかで解決する層が要る。
それが期待値解決層で、ロケータマッピング層とは別に置く（取得の方法と期待値を同じ場所に混ぜない）。

- デフォルトは side に共通の 1 つの値である。
  side 別に分けるのは、`intentional_diffs.may_change` に宣言済みの差に触れる assertion だけにする。
  宣言に無い差を勝手に side 別にしない。分けると、新側の不一致を期待値で吸収して緑にすることになる。レジストリに無い差は、`intentional_diffs.pending` に回してユーザーに確認する。
- 現行の弱点を「直す」と仕分けた行に触れる振る舞いは、side に共通の期待値に固定しない。
  対象は、`.replace/weaknesses.md` の `状態: 有効` で `仕分け: 直す` の行で、宣言は `may_change` にある。取り消した行は見ない。
  固定すると、スイートが現行の弱い振る舞いを正解として守り、新側で塞いだとたんに赤くなる（直すたびに期待値の書き換えが要る）。
  - 対象の slug の処理の流れに当たる行ごとに、弱点が成り立つ入力を 1 つ assertion にする（例: 書き込みの API に `text/plain` で送る）。
    現側の値には現行の振る舞いを書き、新側は未定として `parity-replace` に渡す。
  - 正規の使い方の assertion は、side に共通のまま残す。基準 3 で振る舞いが変わらないと決めたものなので、分けると、塞いだことの副作用を見逃す。
  - 特性化の途中で台帳に無い弱点に気づいたら、仕分けを空欄にした行を `.replace/weaknesses.md` に追記する（既存の行は変えない）。
    基準から導いた案の宣言は `pending` に回す。`未確認` の基準が残るなら、案を出さず、`pending` にも回さない。
    仕分けの原本は `replace-strategy` の `references/security.md` にある。
- side 別にした項目には、根拠になるレジストリの項目を隣にコメントで書く。これが無いと、後から「なぜ 2 つの値なのか」を復元できない。
- side は Playwright の `projects` の名前（`current`・`new`）から解決する。テストの中では `testInfo.project.name` で参照できる
  （出典: <https://playwright.dev/docs/api/class-testinfo#test-info-project>・<https://playwright.dev/docs/api/class-testproject#test-project-name>）。
  環境変数や `baseURL` の中身で side を判定しない。projects の名前が、このスキルで確定した取り決めである。
- このスキルが埋めるのは現側の値だけである（マッピング層と同じく、片側ずつ埋まる）。
  新側の値は `parity-replace` が埋める。現側だけの時点では新側の値を未定として置き、`new` プロジェクトを green にするときに埋まる。
- 置き場所のデフォルトは、後の「配置の指針」の表にある。実際のパスは `metadata.json` の `suite.expectations` に記録し、`parity-replace` はそれを推測せずに読む。
- 表示を切り替える軸（ロケールなど）で変わる文言・振る舞いは、期待値に軸の値の次元を足して持つ（論理名 → 軸の値 → side 別の期待値）。
  スイートは、軸の値ごとに `applyDisplayAxes` で値を当ててから assertion を実行する（見出しの文言をロケールごとに期待する、など）。
  デフォルトの値だけで書くと、スイートはデフォルトの値でしか緑を示さず、ほかの値での差は視覚のベースラインにしか記録されない。
  次元を足した層のパスは、軸ごとに `metadata.json` の `capture_conditions.display_axes.axes[].suite_expectations` に書く。
  軸の数え方の原本は [`baseline.md`](baseline.md)「表示を切り替える軸（掛け合わせずに撮る）」にある。

## 操作の実装差を吸収する層

ロケータを移植できても、操作は移植できない。
`getByRole('combobox')` が両方の実装で要素を見つけても、ネイティブの `<select>` でない実装では `selectOption()` が失敗する、といったずれが起きる。

- Select・Autocomplete・Date picker・Modal・Menu・Context menu（右クリック）は、実装ごとの分岐が必ず要る。
  操作は論理名の裏に操作アダプタとして隠し、スイート本体には論理名と操作の意図だけを書く。
- 右クリックは、イベントが発生するかを観測して送り方を決める。
  `locator.click({ button: 'right' })` で発生しない実装では、操作用のロケータで取得した、見えている要素の `boundingBox()` を取得する。
  `expect.poll` で、次の状態になるまで自動でリトライする。矩形が `null` でなく、幅と高さがどちらも正で、中心の座標の `document.elementFromPoint()` が操作用の要素かその子孫を返す状態である。
  この条件を満たした直後にだけ、その座標に `page.mouse.click(x, y, { button: 'right' })` を送る。
  出典は [Playwright `boundingBox`](https://playwright.dev/docs/api/class-locator#locator-bounding-box)・[`mouse.click`](https://playwright.dev/docs/api/class-mouse#mouse-click)・
  [`expect.poll`](https://playwright.dev/docs/test-assertions#expectpoll)・[CSSOM View `elementFromPoint`](https://drafts.csswg.org/cssom-view/#dom-document-elementfrompoint)。
  role が画面の外のミラー要素に付くことがあるので、判定用のロケータの座標を使い回さない。hit-test が別の要素を返す座標にも、操作を送らない。
- 表示の軸の値を当てる関数（`applyDisplayAxes(page, 値)`）も、操作アダプタに置く。
  受け取るのは「軸の名前 → 値」で、すべての軸の値を当ててから返す。
  当て方は、軸ごとに `display_axes.axes[].apply` に書いたとおりにする。再読み込みを伴うなら、再読み込みの後に落ち着くまで待つ。
  採取スペック・スイート・`parity-diff` の新側の採取が、同じ関数を呼ぶ（原本は [`baseline.md`](baseline.md)「表示を切り替える軸（掛け合わせずに撮る）」）。
- 撮影状態に遷移する関数（`applyState`）は、撮る対象の矩形が 2 回続けて同じ値になるまで待ってから返す。
  要素が現れるのを待つだけで止めない（要件と実装例の原本は [`baseline.md`](baseline.md)「撮る対象が動かなくなるまで待つ」）。
- このスキルで最も工数がかかる箇所である。見積もりで小さく見積もらない。

## 配置の指針

プロジェクトの規約があれば、そちらを優先する。実際のパスは `metadata.json` に記録する。
`parity-replace`・`parity-diff` はパスを推測せず、`metadata.json` から読む。
規約が無ければ、次をデフォルトとして使う。

| 種別 | デフォルトの置き場所 |
|---|---|
| スペック（現側・新側の両方に当てるもの） | `<parity_suite_dir>/parity/<slug>/` |
| **現側専用のスペック**（ベースラインの採取・ノイズの基準値の測定・強度チェック） | `<parity_suite_dir>/parity/<slug>/current-only/` |
| **新側専用のスペック**（新側のベースラインの採取・新側の自己ノイズの測定。置くのは `parity-diff`。このスキルは、場所・除外・`new-capture` プロジェクトだけを用意する） | `<parity_suite_dir>/parity/<slug>/new-only/` |
| **寸法の決まり方の測定スペック**（side に依存しない。`current`・`new` の両方で実行し、project の名前で出力先を分ける。原本は [`baseline.md`](baseline.md)「寸法の決まり方（窓への追従）」） | `<parity_suite_dir>/parity/<slug>/dimension/` |
| **性能の採取スペック**（side に依存しない。`current`・`new` の両方で実行し、project の名前で出力先を分ける。原本は [`baseline.md`](baseline.md)「性能のベースラインとノイズ基準値」） | `<parity_suite_dir>/parity/<slug>/perf/` |
| 現側のマッピング | `<parity_suite_dir>/parity/lib/locator-map/<slug>.ts` |
| 期待値解決層 | `<parity_suite_dir>/parity/lib/expectations/<slug>.ts` |
| 操作アダプタ | `<parity_suite_dir>/parity/lib/interactions/` |
| 共通のフィクスチャ（利用者環境のブラウザへ接続する target があるときだけ。後の「利用者環境のブラウザへ接続する」） | `<parity_suite_dir>/parity/lib/fixtures.ts` |
| プロジェクトが自分で書くツール（画素差分の呼び出し・aria 比較など） | `<parity_suite_dir>/parity/lib/tools/` |
| **決定論的なツール（同梱の scripts のコピー）** | `<parity_suite_dir>/parity/lib/tools/vendor/` |

同梱のスクリプトのコピーは、プロジェクトが自作したツールと同じディレクトリに置かない。
コピーは修正しない取り決めである（原本はスキルの側にあり、`gh skill update` の更新を取り込む）。一方、自作のツールは通常のコードとして扱う。
同じディレクトリに置くと、この 2 つをパスで分けられず、整形・リント・レビューの対象にコピーまで含まれる。
デフォルトとして `tools/vendor/` のようなコピー専用のサブディレクトリを作り、プロジェクトの整形・リントの設定からパスで除外できる状態にしておく。
除外するかどうかの規約はプロジェクトの側で決めることで、このスキルは決めない。

Playwright の `projects` には `current`・`new`・`new-capture` の 3 つを定義する。このスキルで実行するのは `current` だけである。
`new` は `parity-replace` が green の検証で実行し、`new-capture` は `parity-diff` が新側のベースラインの採取で実行する。

### side 専用スペックは相手側の project から `testIgnore` で除外する（両向き）

ベースラインの採取・ノイズの基準値の測定・強度チェックのスペックは、現側専用である。`projects` で分けないと、`new` プロジェクトの実行にも含まれる。
成果物を書き出すスペックは特に危険で、新側の実行が、現側の証跡（ベースライン・強度チェックの結果のファイル）を警告なしに上書きする（実際に上書きした事例がある）。

除外は両方の向きに要る。
`parity-diff` が後から `new-only/` に置く新側の採取スペックが `current` プロジェクトの実行に含まれると、現行アプリの画面が新側のベースラインとして書き出される。
その結果、差分が 0 件だと誤って判定される。現側の証跡が誤るのではなく、新側の証跡が偽物になる。
この時点で `new-only/` は空でよい。除外はディレクトリがあるかどうかに関係しないので、スイートを作るときに両方の向きとも設定しておく。

新側の採取スペックは、`new` ではなく専用の `new-capture` プロジェクトで実行する。
`new` は、`parity-replace` が green の検証で実行するプロジェクトである。
採取スペックは、採取専用の環境変数（slug・target・撮影のパス）をモジュールの読み込み時に要求する。
採取スペックを `new` に残すと、`parity-replace` の green の検証がテストの収集の時点で失敗し、往復のループが進まなくなる。
`new-capture` は `new` と同じ baseURL の設定を使い、`testDir` を `new-only/` に絞る（`new` の側は `new-only/` も `testIgnore` する）。

- 現側専用のスペックを、上の表の `current-only/` に集め、`new` プロジェクトに `testIgnore` を設定して除外する。`testIgnore` に一致したファイルは、テストとして実行されない。
  値は glob の文字列か正規表現で、照合は絶対パスに対して行われる（出典: <https://playwright.dev/docs/api/class-testproject#test-project-test-ignore>）。
- 除外は `projects` の側で行う。スペックの中の条件分岐に頼らない。分岐は書き忘れても検出されず、書き出したファイルは元に戻せない。
  この規則はファイル単位の除外についてのものである。
  [`coverage.md`](coverage.md) の「同じページに乗る他機能の在席」が使うテスト単位のスキップ（新側でまだ実装していない機能を `new` でだけ飛ばし、実装した後に外す）は対象外である。
  スキップは成果物を書き出さず、外し忘れは在席が緑にならないことで見える。
- 除外の対象は、現側のパスに成果物を書き出すスペックである。`parity-diff` が新側のベースラインを取得するのを止めるものではない。
  新側は環境ごとの `new/<target>/baseline-new/` に書く（手順の原本は `parity-diff` の `references/capture-new.md`）。
- `testIgnore` を設定したこと、対象のパターン、`new-capture` プロジェクトの名前を、`metadata.json` に記録する。現側専用は `suite.current_only` に、新側専用は `suite.new_only` に書く。
  前者は、`parity-replace` が新側を実行する前に読む。
  後者は、`parity-diff` が、新側の採取スペックの置き場所・除外の有無・実行するプロジェクトの名前を確かめるために読む。

```ts
// playwright.config.ts（抜粋。パスはプロジェクトの規約に合わせる）
// スクロールバーが場所を取る状態で撮る（capture_conditions.scrollbars のデフォルトの shown。ヘッドレス Chromium のデフォルトの --hide-scrollbars を外す）。
// 3 プロジェクトとも同じ扱いにする（片側だけ場所を取ると、見える幅と高さが厚みの分ずれる。原本は references/baseline.md「スクロールバーが場所を取る窓のはみ出し」）。
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
    // parity-replace の green 検証用。採取スペックは実行しない（収集時に採取用の環境変数を要求するため）
    // dimension/ は除外しない（PARITY_DIMENSION_CAPTURE=1 のときだけ新側の寸法を new/<PARITY_NEW_TARGET>/ へ採る）
    // perf/ も除外しない（PARITY_PERF_CAPTURE=1 のときだけ新側の性能を new/<PARITY_NEW_TARGET>/ へ採る）
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

`current`・`new` の baseURL は、環境変数を参照する形で書き、URL を config に直接書かない。
環境変数は、選んだ target から解決した `PARITY_CURRENT_UI_URL`・`PARITY_NEW_UI_URL`（API は `PARITY_CURRENT_API_URL`・`PARITY_NEW_API_URL`）である。
`url_command` を持つ target では、そのコマンドを実行して得た URL を環境変数に入れる（解決の規則の原本は `replace-strategy` の `references/project-config.md`）。
この環境変数の受け渡しは、このスキルで定義する。`parity-replace`・`parity-diff` は、新側の target から `PARITY_NEW_*` を解決して、同じ受け渡しに渡す。
実行するときは、選んだ target の URL を環境変数に解決して渡す。`<url>` はプレースホルダで、値は成果物に書かない。

```bash
# playwright の起動はプロジェクトのパッケージマネージャに読み替える（npx / pnpm exec / yarn 等）
PARITY_CURRENT_UI_URL=<url> PARITY_CURRENT_API_URL=<url> npx playwright test --project current
```

`new` の側の target の選択と green にする作業は `parity-replace` の段階で行うので、このスキルでは `PARITY_NEW_UI_URL` を設定しなくてよい。
`dimension/` の測定スペックは、`PARITY_DIMENSION_CAPTURE=1` を渡した実行でだけ書き出す。
`new` では、さらに `PARITY_NEW_TARGET`（選んだ新側の target の名前）で出力先の `new/<target>/` を決める。
設定していなければ、書き出さずに失敗する。別の target の samples を上書きしないためである。
通常の green の検証と強度チェックでは、`PARITY_DIMENSION_CAPTURE` を渡さない（測定スペックはスキップされる）。
性能の採取スペック（`perf/`）も同じ扱いで、`PARITY_PERF_CAPTURE=1` を渡した実行でだけ書き出す（[`baseline.md`](baseline.md)「性能のベースラインとノイズ基準値」）。

### 利用者環境のブラウザへ接続する（`browser.cdp_url`）

選んだ target が `browser.cdp_url` を宣言していれば、Playwright が起動したブラウザでは撮らない。
利用者環境で起動したブラウザ（デバッグのポートを開けた Chromium 系）に `connectOverCDP` で接続して撮る。
スキーマの原本は `replace-strategy` の `references/project-config.md`「実行対象環境」にある。
スイート・差分ツール・成果物は今の環境のままで、描画だけが利用者環境で行われる（理由は [`baseline.md`](baseline.md)「採取環境と利用者環境の乖離」）。

- 接続は、共通のフィクスチャ `<parity_suite_dir>/parity/lib/fixtures.ts` で、組み込みの `browser` フィクスチャを上書きして行う。
  スペックは、`@playwright/test` ではなくこのファイルから `test` を import する。上書きを通らないスペックは、宣言があっても、起動したブラウザで撮る。
  接続したらワーカーの環境変数 `PARITY_CDP_CONNECTED` に印を立て、採取スペックは撮る前にこの印を確かめる。
  環境変数 `PARITY_*_CDP_URL` があるかだけでは、import の差し替え忘れを見分けられない。
  接続先は side ごとの環境変数 `PARITY_CURRENT_CDP_URL`・`PARITY_NEW_CDP_URL` で、target の `browser.cdp_url` から解決する。値は成果物に書かない。
  設定していない実行では、Playwright がブラウザを起動する。
- `connectOverCDP` は Chromium 系にしか使えず、`browserType.connect` より忠実度が低い。
  接続したブラウザの `close()` は、こちらが作ったコンテキストを片付けて切断するだけで、利用者のブラウザは閉じない
  （出典: <https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp>・<https://playwright.dev/docs/api/class-browser#browser-close>・
  組み込みのフィクスチャの上書き <https://playwright.dev/docs/test-fixtures#overriding-fixtures>）。
- 現側と新側の両方に、同じ宣言を求める。片側だけ利用者環境で撮ると、環境の差がそのまま差分に出る。
  撮影に使ったブラウザは、`metadata.json` の `capture_conditions.browser`（`launched`・`cdp`）に残す。
  `cdp` では、接続先が同じであることを `capture_conditions.browser_identity` にも残す。
  中身は、`product`（`browser.version()`）、`user_agent`（`navigator.userAgent`）、`browser_os`（下の「描画するブラウザ側の OS」）である。
  `parity-diff` は、新側の target の宣言がこれと合わないか、接続したブラウザが同じでなければ、撮影せずに停止する
  （出典: <https://playwright.dev/docs/api/class-browser#browser-version>・起動と接続の選択肢 <https://playwright.dev/docs/api/class-testoptions>（`connectOptions` を含む）・<https://playwright.dev/docs/api/class-browsertype#browser-type-connect>）。
- 描画するブラウザの側の OS（`browser_os`）は、下の `readBrowserOs` と同じ読み方・同じ正規化で読む。
  `parity-diff` の新側の採取の雛形（`assets/capture-new.spec.template.ts`）が同じ関数を持ち、キーの集合と値のすべてが一致するかで照合する（読み方を変えるなら、両方を変える）。
  Chromium は UA の OS の版を固定の値に縮めて返す（reduced UA）。そのため、`product` と `user_agent` だけでは、OS の版やアーキテクチャが違う機械を見分けられない。
  - 撮影に使うコンテキストでは読まない。
    `use` の `userAgent`（デバイスの設定を含む）を当てると、Playwright は `userAgentData` もその文字列から作って上書きする。
    Linux の機械で Mac の UA を当てると、`platform` が `macOS` になる（実測）。同じブラウザに、設定を当てない別のコンテキストを作って読み、閉じる。
  - 安全なコンテキストのページで読む。
    `navigator.userAgentData` は安全なコンテキストにしか無く、Playwright が開いた直後の `about:blank` は安全なコンテキストではない（実測）。
    合成した https の URL を `route` で返したページで読む（ネットワークには出ない）。
  - 取得するのは `platform`・`platformVersion`・`architecture` の 3 つのキーだけである。
    `getHighEntropyValues` は `brands`・`mobile` も返す。版は `product` が持つ。
    Linux の Chromium は `platformVersion` を空文字で返す（実測）ので、空はそのまま残す。
  - `cdp` では、`navigator.platform` で代わりにすることを認めない。接続先は Chromium 系で、`navigator.platform` も縮められているので、同じ抜けが残る。
    `capture-scope-check.mjs` は、`cdp` なのに `browser_os` が無い記録（`browser-os-missing`）と、3 つのキーの文字列でない記録（`browser-os-invalid`）を失敗にする。
  （出典: <https://developer.mozilla.org/en-US/docs/Web/API/NavigatorUAData/getHighEntropyValues>・<https://developer.mozilla.org/en-US/docs/Web/API/Navigator/userAgentData>（安全なコンテキストだけ）・
  <https://playwright.dev/docs/api/class-route#route-fulfill>）

```ts
// 描画するブラウザ側の OS（browser_identity.browser_os）。現側の採取スペックで 1 回読み、metadata.json に書く
const BROWSER_OS_PROBE_URL = "https://parity-browser-os.invalid/";
async function readBrowserOs(browser: Browser): Promise<Record<string, string>> {
  const context = await browser.newContext(); // use の userAgent を当てない
  try {
    const probe = await context.newPage();
    await probe.route(BROWSER_OS_PROBE_URL, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>os</title>" }),
    );
    await probe.goto(BROWSER_OS_PROBE_URL); // 安全なコンテキスト
    return await probe.evaluate(async (): Promise<Record<string, string>> => {
      const data = (navigator as Navigator & {
        userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Record<string, string>> };
      }).userAgentData;
      if (!data) return { platform: navigator.platform }; // Firefox / WebKit（launched だけ。cdp では検査が失敗にする）
      const v = await data.getHighEntropyValues(["platform", "platformVersion", "architecture"]);
      return { platform: v.platform, platformVersion: v.platformVersion, architecture: v.architecture };
    });
  } finally {
    await context.close();
  }
}
```

```ts
// <parity_suite_dir>/parity/lib/fixtures.ts（抜粋）
import { test as base, chromium, firefox, webkit, type Browser } from "@playwright/test";

export const test = base.extend<{}, { browser: Browser }>({
  browser: [
    // 組み込みの browser に依存しない（依存すると cdp でもローカルのブラウザが先に起動し、無い環境ではそこで失敗する）。
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
      // 採取スペックはこの印を確かめて、起動したブラウザで撮ったものを cdp として記録しないようにする
      process.env.PARITY_CDP_CONNECTED = "1";
      await use(connected);
      await connected.close(); // 接続したブラウザでは切断だけ（利用者のブラウザは閉じない）
    },
    { scope: "worker" },
  ],
});
export { expect } from "@playwright/test";
```
