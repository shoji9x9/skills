# ツールとチェック

`AGENTS.md`「技術スタック」の詳細。ツールの使い方と、pre-commit・CI で実行するチェックをまとめる。

## 技術スタック

- スキルは GitHub CLI（`gh skill`、v2.90.0 以上）と Agent Skills 仕様で管理する。
- パッケージマネージャは pnpm で、バージョンは mise で管理する。
  バージョンは `mise.toml`、`package.json` の `packageManager` と `devEngines.packageManager`、`pnpm-lock.yaml` の 4 か所に書く。
  npm は使わず、`package-lock.json` を作らない。誤って別のパッケージマネージャを使うと、`devEngines` が警告する。
  4 か所をそろえてバージョンを上げる手順と、不具合のあるバージョンを避ける方法は [`docs/package-manager.md`](package-manager.md) にある。
- フォーマッタとリンタは「リントと整形」の表のとおりである。prettier は使わない。
- テストは skill-creator で行う。eval viewer には Python 3.8 以上が要る。結果の集計は `scripts/eval/build-skill-eval-benchmark.ts`（Node）で行う。
- 実行環境は mise で管理する。

### ツールの起動

スクリプト・lefthook・CI からツールを起動するときは、`./node_modules/.bin/<tool>` のパスを直接書かず、`pnpm exec <tool>` か mise の shim で起動する。

1 回の実行で同じツールを多数回（数十以上）起動するスクリプトは例外とする。`pnpm exec` の起動にかかる時間（実測で 1 回約 0.6 秒）が、実行時間の大半を占めるためである。
この場合は、Node のモジュール解決（`createRequire(...).resolve("<pkg>/package.json")` の `bin`）でエントリを求め、`node` で起動してよい。
`scripts/mutation/check-mutation-proof.ts` は、子プロセスの vitest をこの方法で起動する。この場合も `.bin` のパスは直接書かない。

mise の shim は、cwd の設定の階層からツールのバージョンを決める。
リポジトリの外の cwd（`/tmp` など）からコマンド名だけで起動すると、`No version is set for shim` で失敗する。グローバルのデフォルトが無いためで、untrusted とは別の失敗である。
リポジトリの外で動かす検証では、`mise which <tool>` で実体のパスを取得して渡すか、cwd をリポジトリの中に保つ。

### リントと整形

| 対象 | リント | 整形 | 補助のチェック |
| --- | --- | --- | --- |
| Markdown（`*.md`） | `markdownlint-cli2` | `markdownlint-cli2` | `scripts/gates/prose/lint-prose.ts` が人が読む文章を textlint でチェックする |
| JavaScript・TypeScript（`*.js`、`*.mjs`、`*.ts` など） | `oxlint`（1 ファイルの中で完結する検査）と `fallow`（ファイルの間の関係。下の「ファイルの間の関係（fallow）」） | `oxfmt` | `tsc`（`pnpm run typecheck`）が `.ts`・`.tsx` の型を検査する（下の「型の検査」）。`scripts/gates/prose/lint-prose.ts` がコメントの文章を textlint で、文字列（テスト名・メッセージ）を使わない語の規則でチェックする |
| JSON（`*.json`） | `jsonlint` | `oxfmt` | 重複したキーもチェックする。`scripts/gates/prose/lint-prose.ts` が `evals/<name>/evals.json` の文字列を使わない語の規則でチェックする |
| JSONC（`*.jsonc`。スキルの設定ファイル） | `jsonlint -C -T`（コメントと末尾のカンマを受け付けて読む） | `oxfmt` | 重複したキーもチェックする。CI は整形されていないファイルも検出する（`JSONC format check`） |
| YAML（`*.yml`、`*.yaml`） | `js-yaml`（`scripts/gates/code/lint-yaml.ts` が API で 1 つのプロセスにまとめて読む） | `oxfmt` | `scripts/gates/prose/lint-prose.ts` がコメントの文章を textlint でチェックする |
| シェル（`*.sh`） | `shellcheck` | `shfmt` | `scripts/gates/prose/lint-prose.ts` がコメントの文章をチェックする |
| GitHub Actions（`.github/workflows/*.{yml,yaml}`） | `actionlint` と `ghalint` | `oxfmt` | `pinact` が SHA の固定を確かめる |
| 重複したコード（JavaScript・TypeScript・シェル・Markdown） | `jscpd`（下の「重複したコード（jscpd）」） | | |

表のうち `shellcheck`・`shfmt`・`actionlint`・`pinact`・`ghalint`・`gitleaks` は、mise でインストールし（`mise.toml`）、コマンド名だけで起動する。
それ以外は pnpm の devDependencies に入れ、`pnpm exec` で起動する。

`oxlint` と `oxfmt` の対象は、JS・TS の拡張子すべて（`js`・`mjs`・`cjs`・`jsx`・`ts`・`tsx`・`mts`・`cts`）である。
CI は引数なしで実行する（`pnpm run lint:js`）ので、この範囲を自動で拾う。
lefthook の glob と `format:js*` スクリプトの glob も、この範囲にそろえる。片方だけが狭いと、その拡張子は手元でチェックされず、CI でだけ失敗する。

GitHub Actions は、`actionlint` で構文を、`ghalint` で `permissions`・`timeout-minutes`・`persist-credentials` などの方針をチェックする。
`ghalint` はリポジトリ全体を読むので pre-commit に入れず、CI の `GitHub Actions lint` だけで実行する。

#### 関数の大きさ

大きく分岐の多い関数は、テストとミューテーションテストで振る舞いを確かめにくく、レビューでも読みにくい。
そこで、`oxlint.config.ts` で関数の大きさを制限する。閾値は oxlint のデフォルトをそのまま使う。

| ルール | 閾値 |
| --- | --- |
| `max-lines-per-function` | 50 行（空行とコメントも数える） |
| `max-depth` | 4 |
| `max-params` | 3 |
| `max-nested-callbacks` | 10 |

テストのファイル（`scripts/**/*.test.ts`）では、vitest から import した `describe` のコールバックだけを行数の上限から外す。
`suite`・名前空間の import（`v.describe`）・vitest の修飾（`describe.skip`・`describe.each(表)` など）も `describe` として扱う。`describe` はファイルの大半を包むので、長くなってもよいとする。
組み込みの `max-lines-per-function` は `describe` だけを外すオプションを持たないので、テストのファイルでは JS プラグインのルール `skills-repo/max-lines-per-function-except-describe` に替える。
数え方は組み込みのルールと同じで、`test` のコールバックとヘルパー関数は 50 行を上限にする。
テストを書く関数は `test` にそろえ、`vitest/consistent-test-it` が `it` を失敗にする。
vitest プラグインの correctness のルールのうち、このリポジトリのテストが違反するもの（`valid-expect` など）は外す。`consistent-test-it` を使うためにプラグインを有効にしただけで、これらのルールは対象にしていないからである。採るときは、そのルールの違反を直してから、`off` の行を消す。

本体の関数を Playwright の `evaluate` へそのまま渡す page ファイルがある。parity-suite と parity-component の `scripts/page/*.page.mjs` である。
これらでは、`max-lines-per-function` を JS プラグインのルール `skills-repo/max-lines-per-function-except-page-entry` に替える。
`evaluate` は関数のソースだけを送るので、本体が呼ぶ関数は本体の中に入れ子で書くしかなく、組み込みのルールでは本体が必ず上限を超えるからである。
このルールは、export した本体を、入れ子の関数とコメントを除いてコードの残る行の数で数え、入れ子の関数は全体の行数で数える。どちらも上限は 50 行である。
CLI が本文を関数式で包む replace-strategy の page ファイルは、本体が呼ぶ関数を最上位に置けるので、組み込みのルールのまま当てる。
同じ形の page ファイルを別のスキルに足すときは、`oxlint.config.ts` の一覧にそのスキルの `scripts/page/*.page.mjs` を足す。

複雑度・参照の向き・循環参照は、ファイルの間の関係を見る fallow が検査する（「ファイルの間の関係（fallow）」）。

ルールを足したり厳しくしたりしたときに、既にある違反をすぐに直せなければ、`scripts/gates/code/oxlint-pending.ts` の一覧に、ファイルとルールの組で載せて外す。
一覧は後で直すものだけで、新しいファイルと一覧に無いルールは外さない。
行の disable コメントで外さないのは、配布スキルのファイルが利用者のプロジェクトへ入り、そこでは使われない disable になるためである。
直したら、そのルールを一覧から消す。直したのに一覧に残った組は、`oxlint-pending.test.ts` が pre-commit と CI で失敗にする。
残すと、そのファイルに新しく入った同じ種類の違反を見逃すからである。
直さずに一覧から組を消した commit も、同じテストが失敗にする。一覧の外し方やルールの判定を変えるファイル（`oxlint.config.ts` とプラグインから import をたどったファイルと、`package.json`・`pnpm-lock.yaml`）が staged なら、リポジトリ全体を検査するからである。
pre-commit の検査は、他のジョブと同じく作業ツリーの内容に oxlint を当てる。直したファイルを stage せずに一覧だけを commit すると pre-commit は通り、CI で失敗する。

これらのルールは、pre-commit と CI の両方で実行し、CI だけで実行するルールは置かない。

#### 型の情報を使うルール

`oxlint.config.ts` の `options.typeAware` で、型の情報を使うルールを有効にする（`oxlint-tsgolint` が要る）。
`correctness` の分類の型のルール（`restrict-template-expressions`・`no-base-to-string` など）と、依存するパッケージの非推奨の API の利用を見る `typescript/no-deprecated` である。
型が `unknown` の値をメッセージに埋め込むときは、`String(x)` で包む（`restrict-template-expressions`）。
`??` や真偽の判定で絞った値は型が `{}` になり、`String(x)` も `no-base-to-string` が検出する。`scripts/**` では `scripts/lib/show-value.ts` の `showValue` を使い、配布スキルでは `typeof` で文字列に絞るか `JSON.stringify` を使う。
すぐに直せない既存の違反は、ほかのルールと同じく `oxlint-pending.ts` の一覧に載せて外す。

#### ファイルの間の関係（fallow）

1 ファイルの中で完結しない検査は、fallow が行う。
設定は `.config/fallow/base.jsonc` で手で書く。fallow が読む `.fallowrc.json` は、`scripts/gates/packaging/copies/generate-fallow-config.ts` がこのファイルと `identical-copies.json` から生成するので、手で直さない。
pre-commit が生成し直して stage し、CI の `Lint` ジョブが生成し忘れを確かめる。

配布スキルの間のコピー（`identical-copies.json` の組）は、テストが import する 1 つのコピーだけで export が使われる。
fallow はコピーどうしの関係を知らないので、ほかのコピーの export を使われていないと判定する。
そのため、生成するときに、組の最初のファイル（基準）以外のコピーの export を `ignoreExports` に挙げる。ファイル全体の組はすべての export を、範囲（`region`）の組は印の間で export する名前だけを外す。
基準のコピーは検査に残るので、どのコピーでも使われていない export は基準のコピーで検出される。テストが import するコピーを、組の最初に置く。
export を手で外すときは、`base.jsonc` の `ignoreExports` に理由を添えて書く。生成した設定は、これにコピーの分を足す。

配布スキル（`skills/**`）の export は、すべて `ignoreExports` で外す。
利用者のプロジェクトにコピーした先のテストと手順が使う（コピーした script の `VERSION` を読む、references に書いた関数を呼ぶ）ので、fallow はその利用を追えない。
export を外しても、このリポジトリの typecheck とテストは失敗しない。
基準のコピーも `skills/**` にある組は、基準のコピーの export も外れるので、どのコピーでも使われていない export を fallow は検出しない。
基準のコピーで検出されるのは、基準が `skills/` の外にある組だけである。
`scripts/` のテストは、対象を静的な `import` で読む。`await import(<変数>)` で読むと、fallow は使われている export を使われていないと判定する。

| 検査 | 内容 |
| --- | --- |
| 使われていないコード | どこからも使われないファイル・export・型・クラスのメンバー。同じファイルの中でだけ使う export も対象にする（export を外せば、呼び出し元が無くなったときに oxlint の `no-unused-vars` が検出する） |
| 依存 | 使われていない依存、`package.json` に無い依存、解決できない import |
| 同じ名前の export | 同じ名前の export を持つ別のモジュール |
| 非推奨の export | `@deprecated` を付けた自分の export を、まだ使っている箇所 |
| 複雑度 | 循環的複雑度 20・認知的複雑度 15。oxlint の `complexity` は循環的複雑度しか数えないので使わない |
| 参照の向き | 配布スキル（`skills/<name>/`）は自分のディレクトリの外を import しない（利用者のプロジェクトには `skills/<name>/` だけが入る）。`scripts/` の各分類は、自分の分類と `scripts/lib/` と配布スキルのほかを import しない。雛形（`skills/<name>/assets/`）はそのスキルの一部として扱う。`scripts/skills/` は対象にしない |
| 循環参照 | import と `require()` をたどった循環 |

1 つのファイルの変更が、変更していないファイルの判定を変える（最後の呼び出し元を消すと、変更していないファイルの export が使われなくなる）。
そのため、pre-commit と CI の `Lint` ジョブで、リポジトリ全体を検査する（`pnpm run lint:fallow`）。
fallow はドットで始まるディレクトリを走査しないので、インストール済みのコピーは除外を書かなくても対象外になる。private skill の実体（`.ts`）は、`ignorePatterns` の `!` で含め直し、`entry` に挙げて対象にする。`entry` に挙げるだけでは走査されない。
`scripts/` の分類を足したら、`base.jsonc` の `entry` と境界のゾーンにも足す。足し忘れると、その分類の CLI が使われていないファイルとして失敗する。
境界のゾーンと許可する向きは、`scripts/gates/code/fallow-boundaries.test.ts` が実物の fallow を一時ディレクトリに当てて確かめる。向きを変えたら、このテストも直す。

参照の向きは、fallow の構文の解析が読む参照（`import`・`export from`・`import()`・`require()`・`import type`・JSDoc の `{import("…")}`・`vi.mock`・`new URL`）で判定する。
次の書き方は検出しないので、相対パスのモジュールを読むときは使わない。`createRequire` の戻り値を別名で呼ぶ、`vi.importActual`、`/// <reference path>`、相対パスの文字列を任意の関数に渡して読む、である。

`pnpm run lint:fallow` と CI の CRAP（`pnpm run lint:crap`）は、`fallow health` の出力のうち、関数ごとの複雑度の指摘（`--complexity`）だけを検査する。
ほかの出力（ファイルの点数・hotspot・一緒に変更されたファイルの組・リファクタリングの候補）は、`--fail-on-issues` を付けても失敗にならないので実行しない（全体の要約の数行だけは毎回出る）。
これらは git の履歴や依存するファイルの数から計算し、コードを直しても値を下げられないものを含むので、ベースラインで外す対象にもしない。

fallow の更新や閾値の変更で、変更していないファイルに循環的複雑度や認知的複雑度の指摘が出たら、その変更と同じ PR で関数を分けて直す。
CRAP のベースラインの扱いは、下の CI の検査の項にある。
すぐに直せない既存の指摘（使われていないコード・依存など）は、`.config/fallow/dead-code-baseline.json` に載せて外す。
直したら、`pnpm exec fallow dead-code --save-baseline .config/fallow/dead-code-baseline.json` で作り直す。
保存したファイルは `pnpm exec oxfmt .config/fallow/dead-code-baseline.json` で整形する。
使われていない export は、`fallow fix --dry-run` で提案を確かめてから `fallow fix` で直す。`fallow fix` は `export` を外し、依存を消すので、pre-commit と CI では自動に適用しない。
誤検知は、`base.jsonc` で理由を書いて外す。配布スキルには `fallow-ignore` のコメントを置かない。

CI だけで実行する検査が 2 つある。

- `Unit tests` ジョブの CRAP（`pnpm run lint:crap`）: 複雑なのにテストが通っていない関数。カバレッジは、`pnpm run test:coverage` が残す V8 の記録（`node_modules/.cache/coverage/v8/`）を渡す。
  `coverage-final.json` は名前の無い関数（コールバックなど）を持たないので、渡すと fallow がそれらのカバレッジを推定する。
  カバレッジが無いと値を推定して誤検知が多くなるので、pre-commit には入れない。既存の指摘は `.config/fallow/crap-baseline.json`。
  作り直すときは、`pnpm run test:coverage` を全体で実行してから、次のコマンドを実行する。
  `pnpm exec fallow health --complexity -c .config/fallow/crap.jsonc --coverage node_modules/.cache/coverage/v8 --save-baseline .config/fallow/crap-baseline.json`
  保存したファイルは `pnpm exec oxfmt` で整形する。
  `pnpm run lint:fallow` が通る状態で作り直す。循環的複雑度と認知的複雑度の指摘が残っていると、その件数もベースラインに入る。
  `--complexity` を外すと、判定に使わないリファクタリングの候補（`target_keys`）もベースラインに入る。
  ブラウザでだけ実行する関数（Playwright の spec の雛形 `skills/*/assets/*.spec.template.ts` と、eval の fixture をブラウザで作るジェネレータ）は、ユニットテストで実行できないので、ベースラインに載せたままにする
- `Lint` ジョブの `Test weakening`（`fallow audit`）: PR が増やした、テストを弱める変更（`.skip`・`.only` の追加、テストのケースや assertion の減少、カバレッジの閾値の引き下げ）。PR のベースとの差分を見るので、PR でだけ実行する。
  意図して弱めるときは、理由を付けた `fallow-ignore-next-line weakened-tests` を書く

#### 重複したコード（jscpd）

同じ処理を複数の箇所にコピーすると、片方だけを直して食い違う。`scripts/gates/code/check-duplicates.ts` が jscpd（設定は `.jscpd.json`）で、JavaScript・TypeScript・シェル・Markdown の重複を検出する。テストも対象にする。
閾値は、テストのコードどうしの重複（次の段落）を除き、5 行（jscpd のデフォルト）・50 トークン（`.jscpd.json` の `minTokens`）にする。pre-commit と CI の `Lint` ジョブで、リポジトリ全体を検査する（`pnpm run lint:duplicates`）。

テストのコード（`scripts/` の `*.test.ts`・`scripts/skills/`・`scripts/lib/testing/`。定義は `check-duplicates.ts` の `isTestCode`）どうしの重複は、閾値を 100 トークンに上げて判定する。
`scripts/skills/` の外でテストの隣に置いたヘルパー（`*-helpers.ts`）は、名前からテスト用か決められないので、テストのコードに含めない。
テストは準備と assertion を各テストに書くので、50 トークンでは `expect(r.status).toBe(1)` が続くような短い並びも重複として数える。
テストとテスト以外の間の重複は、デフォルトの閾値で数える。
jscpd は閾値によって断片の切り方を変えるので、1 回の走査の結果をトークン数で絞っても、閾値を上げた走査と同じ結果にならない。
そのため、全体をデフォルトの閾値で走査する 1 回目からテストどうしの重複を除き、テストのコードだけを 100 トークンで走査する 2 回目の重複を数える。

`identical-copies.json` に登録した意図したコピーどうしの重複は数えない（配布スキルの間のように共通化できないコピーは、ここに登録する）。
範囲（`region`）を持つ組は、両方の断片がそれぞれの範囲と重なる重複を外す。
範囲の組に並べたファイルと同じファイル全体の組に入っているファイルも、範囲の組に入っているものとして扱う。そのため、範囲の組には、ファイル全体の組のファイルを 1 つ（どれでもよい）だけ並べればよい。
既存の重複は `.config/jscpd/baseline.json` と、テストどうしの `.config/jscpd/baseline-tests.json`（どちらも jscpd の指紋）に載せて外す。
新しい重複が見つかったら、内容を見て扱いを決める。共通化する・意図したコピーとして登録する・残す、のどれかである。残すなら `node scripts/gates/code/check-duplicates.ts --update-baseline` でベースラインに載せる。
`--update-baseline` は登録済みのコピーの重複もベースラインに載せる（jscpd のレポートは指紋を出さないので、ベースラインから除けない）。
そのため、そのときの組を `.config/jscpd/declared-groups.json` に控え、後で組を宣言から外したら、その組のファイルの間の重複はベースラインにあっても失敗にする。
jscpd は 3 か所以上の重複を 2 つずつの組で報告するので、1 か所を直すと、残りの組が新しい重複として報告されることがある。そのときもベースラインを作り直す。

ファイルの種類に依らない横断のチェックは、pre-commit と CI の `Lint` ジョブで実行する。どのチェックも、対象が 0 件のときは成功にしない。

| スクリプト（`scripts/gates/` からのパス） | チェックする内容 |
| --- | --- |
| `packaging/copies/check-rule-symlinks.ts` | rule を各エージェントから読むためのシンボリックリンクと、Copilot のレビューに読ませる文書（`skills/writing-style/references/rules.md` と `docs/writing-style.md`）へのシンボリックリンク。その文書が applyTo を持つことと、レビューで確かめる節が Copilot の読む先頭 4,000 文字に収まることも確かめる |
| `code/check-control-chars.ts` | テキストの拡張子のファイルに入った制御文字 |
| `packaging/check-eval-reachability.ts` | eval の assertion と prompt の対応 |
| `packaging/copies/check-skills-sync.ts` | `skills/<name>/` とインストール済みのコピー `.agents/skills/<name>/` の一致 |
| `code/check-js-extensions.ts` | JavaScript の拡張子（「JavaScript の拡張子」の節） |
| `code/check-skill-lint-directives.ts` | 配布スキルの、このリポジトリの lint の設定を前提にした抑止コメント（`.agents/rules/distributed-skill-stack-independence.md`） |
| `types/check-jsdoc-types.ts` | 配布スキルの `.mjs` で、型の検査を外す JSDoc の書き方（「型の検査」の節） |
| `packaging/check-skill-frontmatter.ts` | `SKILL.md` の frontmatter |
| `packaging/copies/check-identical-copies.ts` | 同じ内容であるべきコピー。組は `scripts/gates/packaging/copies/identical-copies.json` に書く。`region` を持つ組は、印 `// <region>:begin` と `// <region>:end`（シェルのファイルでは `# <region>:begin` と `# <region>:end`）の間だけを比べる |
| `packaging/check-skill-config-vendor.ts` | 配布スキルに同梱する設定の読み取り（`scripts/skill-config/`）。同梱した jsonc-parser（`vendor/`）が devDependency のバージョンから作った内容と一致するか。バージョンを上げたら `--fix` で作り直す |
| `packaging/check-skill-configs.ts` | このリポジトリのスキルの設定（`.config/skills/shoji9x9/*.jsonc`）が、各スキルのスキーマ（`skills/<name>/config-schemas/`）に合うか |
| `prose/check-time-sensitive-prose.ts` | 日付・「現状は」「当面」を Tier 1〜3 の文書とコメントに書いていないか。変異の件数や全件の実測値は `mutation-proof.yml` だけに書く |
| `prose/check-version-mentions.ts` | Tier 1〜3 の文書とコメントに書いた「<ツール> X.Y.Z」が、リポジトリで宣言したバージョンと食い違っていないか。依存を上げたら、食い違う記述を直す |
| `docs/check-doc-refs.ts` | リンクと節名の実在、参照の向き。節名は、パス（バッククォート・リンク・スキル名付き）の後に「」で書いたものを照合する。間に「の」や空白を挟んでもよく、節名でない語句を引用するときは名詞を挟む。導入先で生成するファイルは `scripts/gates/docs/doc-refs.json`、違反の形だが正しい記述の許可は `scripts/gates/docs/doc-allowed.json` に書く |
| `packaging/check-skill-index.ts` | スキルガイド・README とスキルの実体の対応 |
| `prose/lint-prose.ts` | 人が読む Markdown の文章と、JavaScript・TypeScript・シェル・YAML のコメントの文章。JavaScript・TypeScript の文字列と `evals/<name>/evals.json` の prompt・expected_output・assertions には、使わない語の規則だけを当てる（取り出し方は `scripts/lib/text/code-strings.ts`）。シェルのコメントは `shfmt --to-json` の構文木から取り出すので、shfmt（`mise.toml` でバージョンを固定）が要る |
| `docs/agents-md/check-agents-md-size.ts` | `AGENTS.md` のサイズが、Codex が読む上限（`project_doc_max_bytes` のデフォルトの 32 KiB）を超えていないか |

### カバレッジ（CI で実行）

`pnpm run test:coverage` がテスト全体をカバレッジ付きで実行し、ファイルごとの値を `scripts/coverage/coverage-thresholds.json` の閾値と比べる。
CI では、必須チェックの `Unit tests` のジョブがこのコマンドを実行する。テスト全体を実行するので、lefthook では実行しない。
測り方・閾値の決め方・除外の書き方は [`docs/testing.md`](testing.md)「カバレッジ」にある。

vitest は、vite の変換を通さず Node がファイルを直接読み込む設定にしている（`vitest.config.ts` の `experimental.viteModuleRunner`）。
変換を通すと、c8 が数える位置がずれる。

### ミューテーションテスト（CI だけで実行）

`scripts/mutation/check-mutation-proof.ts` は、`scripts/**/*.mutations.json` の定義をもう一度実行する。
各変異について、置換が当たったことと、定義したテストだけが失敗したことを確かめる。
チェックが違反を検出できることをコメントの文章で記録すると、コードが変わったときに古くなる。そこでデータとして持ち、このランナーで機械的に測り直す。

PR では、差分に関係する定義だけを測る（`--changed-since origin/<base>`）。関係するのは次の 3 通りである。

- ランナーが変わったとき。すべての定義を測る。
- 定義ファイル自身が変わったとき。
- その定義の `test_file`、`test_file` が import する `scripts/` の `.ts`（ヘルパーや fixture。import をたどったものを含み、`scripts/lib/` は除く）、変異の対象のファイルのどれかが変わったとき。

次のものの変更で影響を受ける定義は、PR では選ばない。週次の全件の実行で確かめる。

- 共有のライブラリ（`scripts/lib/`）
- `scripts/` の外のコード（`skills/` の `.mjs` など）
- `.ts` でない相対の import と、テストが import せずに実行時に読むファイル（fixture など）
- 依存のバージョン

すべての定義を測ると、PR ごとには払えない時間がかかる。実測値は `.github/workflows/mutation-proof.yml` のコメントにある。
1 つの変異につき対象のテストファイルを 1 回実行するので、対象のテストは子プロセスを起動せず `main` を直接呼ぶ。CLI として起動するテストは、変異を検出できることを確かめる数本に絞る。
CI では、選んだ変異を matrix で 12 個のシャードに分けて並列に実行する（`--shard i/N`）。必須チェックの `Mutation proof (PR)` は、全シャードの成功を確かめる集約ジョブが持つ。
シャードには定義を単位に割り当て、基準 run（変異を入れずにテストを 1 回実行する分）を定義ごとに 1 つのシャードでだけ実行する（下の重い定義は、分けた一部ごとに実行する）。
1 つのシャードの目安を超える重い定義だけを、変異で分ける。所要時間は `scripts/mutation/mutation-durations.json`（定義ごとの、テストファイルを 1 回実行する秒数）で見積もる。
見積もりは割り当ての釣り合いにだけ使い、測る変異の集合は変えない。各シャードのログには、そのシャードの見積もり（`見積もり: 全体 … 秒、このシャード … 秒`）と、定義ごとの実測（`時間: X 秒（N 変異、基準 run を含む）`）が出る。
定義を足したときや、シャードの所要時間が偏ったときは、全件を検証した PR の CI の全シャードのログから、定義ごとに X の合計 ÷ (N + 1) の合計で更新する。
週次の全件の実行も、同じ `--shard` で matrix に分けて測る。分割数とその根拠は `.github/workflows/mutation-proof.yml` のコメントにある。
週次の実行の全シャードのログも、同じ形の `時間:` を出すので、同じ式で見積もりの更新に使える。
定義を足したら、見積もりも足す（`mutations-declaration.test.ts` が、どの定義にも見積もりがあることを確かめる）。最初は手元の実行の `時間:` から同じ式で書く。
文書を含む変更は、push の前に手元でも `--changed-since origin/main` を実行する。文書を読むテストを持つ定義も選ばれるので、文書の書き換えで落ちる定義を CI の前に見つけられる。
`--changed-since` は commit の差分（`origin/main...HEAD`）だけを見るので、commit した後に実行する。commit する前は「変更ファイル: 0 件」になり、何も測らない。
ランナーのテストのうち本物の vitest を使うのは e2e の 2 本だけで、残りはスタブで実行する（`MUTATION_PROOF_TEST_COMMAND`）。
ランナーのテストは `describe.concurrent` で並べて実行するので、テストの間でロック・復元情報・fixture を共有しない。

すべての定義は、週に 1 回の定期実行（`.github/workflows/mutation-proof.yml`）で測る。
対象もチェックも変わっていない定義は前回の結果が有効だが、共有ライブラリやツールのバージョンが変わると前提が成り立たなくなることがあるので、測り直す。

pre-commit には入れない。実行中に対象のファイルを書き換えて戻すので、staged の変更と混在すると取り違える。
同じ作業ツリーでは並列にも実行しない。同時の実行はロックで止めるが、無関係な `pnpm test` と重なると、変異を入れた途中の状態を読んで無関係なテストが失敗する（実測）。

手元で全件を並列に実行するときは、`scripts/tools/mutation-proof-shards.sh <N> [ランナーの引数...]` を使う。
シャードごとに HEAD の別の worktree を作って依存を入れ、`--shard i/N` を並列に実行して、終わったら worktree を消す。
作業ツリーを分けるのは、ランナーが対象のファイルを書き換えて戻すためである。
同じ作業ツリーでシャードを並べると、ロック（`node_modules/.cache/mutation-proof/`）で止まり、ロックを外しても互いの変異を読んで無関係なテストが失敗する。
worktree ごとに `node_modules` が分かれるので、ロックと復元情報も分かれる。
worktree は commit した内容から作るので、tracked のファイルに commit していない変更があれば止まる。
依存の導入の失敗や中断で途中で止まっても、作った worktree は消す。対象が戻っていない worktree は消さずに残し、次の実行もそれを確かめるまで止まる。

実行中は、その作業ツリーの変異の対象を編集しない。原本を読んでコピーする処理（`scripts/tools/reinstall-skill.sh`・成果物の生成）も実行しない。
ランナーは変異 1 件ごとに元の内容を書き戻すので、実行中の編集は消え、コピーには実行中の変異が入る（どちらも実測）。
ランナーは書き戻す直前に、対象の今の内容を分類する。自分の書いた変異のままなら書き戻す。
元の内容に戻されていた場合は、測定が無効なので結果を出さずに exit 2 で止まる。
消されていた場合と、外から編集されていた場合は、作り直しも上書きもせずに exit 2 で止まり、復元情報を残す。次回の起動も、同じ食い違いで止まる。
ランナーは対象を、同じディレクトリの一時ファイル（`<対象>.mutation-proof-<pid>.tmp`）に書いてから差し替える。
そのため、書き込みが途中で失敗しても（ディスクが一杯など）、対象は書く前の内容のままになる。
変異の書き込みが失敗したら、変異を当てられないとして exit 2 で止まる。書き戻しが失敗したときも exit 2 で止まる。このとき対象は変異のまま残るが、次回の起動が自分の変異として戻す。
中断で残った一時ファイルも、復元情報が残っていれば、次回の起動が消す（復元情報を手で消した後は、`<対象>.mutation-proof-<pid>.tmp` を手で消す）。
差し替えるので、ハードリンクを持つ対象は変異させずに exit 2 で止まり、書き込めないディレクトリの中の対象も変異させられない。所有者と拡張属性も保たない。
実行しながら同じファイルを編集したいとき（変更前の所要時間の計測など）は、基点の commit の別の worktree（`git worktree add --detach`）で実行する。
ランナーは宣言ごとの所要時間（基準 run を含む）を出し、最後の集計の行の前に長い順の一覧を出す。全件の実行で、次に縮める宣言をこの一覧から選ぶ。
変異 1 件ごとにテストファイルを丸ごと実行するので、子プロセスの終了を待つテストは `test.concurrent` で並べると、変異の数だけ縮む。
子は `scripts/lib/spawn-async.ts` の `spawnAsync` で起動し（`spawnSync` はイベントループを止めるので並ばない）、一時ディレクトリは `makeTempDirFactory` で作る。
並べたテストの中の `makeTempDir` は、消す予約が別のテストに付くので例外になる。
バックグラウンドで実行したときの完了は、完了の通知ではなく、プロセスが無いこと（`/proc/<pid>`）と、ログの最終行（`mutation-proof: N proven / M failed`）で判断する。

ランナー自身を変異させる定義があるときは、`--changed-since` を測るテストを `--only` で絞る。
選ぶ判定を常に真にする変異が入ると、入れ子のランナーが指数的に増える。実測では 30 分以上かかって 21 以上のプロセスが起動し、止めた後の作業ツリーに変異が残った。

### その他のチェックと整形

Bash の実行前のチェック（PreToolUse）として、`scripts/hooks/bash-command-guard.sh` が、1 文字だけの文字クラス（`[d]ump-dom`）で自分を避けていない `pkill -f` と `killall -f` を止める。
照合するのがコマンドライン全体なので、自分のシェルにも一致する。文章の規約では防げずに再発した形である。
判定は語として現れる `pkill`・`killall` を 1 本の正規表現で見るだけで、シェルの構文は解析しない。そのため、引用の中の文章や heredoc の本文に書いた `pkill -f` でも止める。止められたら書き方を変える。
この Hook に規則を足さない。

このチェックは、3 つのエージェントに設定してある（`.claude/settings.json`・`.codex/hooks.json`・`.github/hooks/kaizen-session.json`）。

応答を確定する前のチェック（Claude Code の Stop）として、`scripts/hooks/response-language-check.ts` が、最後の応答が日本語で書かれているかを確かめる。
コードブロック・インラインコード・引用・URL・ハーネスのタグの塊を除いた本文で、ラテン文字が 40 字以上あり、日本語の文字（ひらがな・カタカナ・漢字）の割合が 0.1 未満なら、exit 2 で書き直させる。
`stop_hook_active` が true のときも、この Hook が止めた印が無ければ（別の Hook が書き直させた後なら）確かめる。印は `scripts/hooks/stop-marker.ts` で、次の Hook と共有している。
node が無い環境では警告だけを出して通す。設定は Claude Code だけで、Codex と Copilot には入れていない。

同じ Stop で、`scripts/hooks/response-word-check.ts` が、最後の応答に使わない語（`.textlint/words.json`）が含まれていないかを確かめる。
判定は textlint の `ai-words-ja/no-ai-words` の規則と、記号が続く形も拾うダッシュの規則（`local/no-dash-emphasis`）で行い、引用・ハーネスのタグの塊とコードは対象から外す。
見つかれば、辞書の言い換えを添えて exit 2 で書き直させる。
語の言い換えを説明するときと、固有名詞や複合語の一部として字義どおりに使うとき（`NAT ゲートウェイ` など）は、インラインコードで書けば止めない。`stop_hook_active` の扱いと印は、上の Hook と同じである。
textlint の設定を読めないときや規則が無効なときは、書き直させずに exit 1 にする。設定は Claude Code だけである。

シークレットの走査は `gitleaks` で行う。pre-commit は staged の差分を（`gitleaks git --staged`）、CI はリポジトリ全体と全履歴を（`Secret scan` ジョブ、`fetch-depth: 0`）走査する。

どのファイルにどのフォーマッタを当てるかは、`lefthook.yml` の glob と `package.json` の `format:*` で決める。「リントと整形」の表はその要約で、ツールが扱える範囲の上限ではない。
フォーマッタを当てる前に、そのファイルの種類がそのフォーマッタに割り当てられているかを、`lefthook.yml` と `package.json` で確かめる。
割り当てられていないファイルに `--check` を当てて失敗しても、誰も強制していないチェックなので指摘にはならない。直すと無関係な差分になる。

整形ツールが書き換える種類は、ツールの設定で割り当てた種類に閉じている。
整形ツールは渡された範囲を自分の判断で整形するので、閉じていないと、ディレクトリ・glob・引数なしの呼び出しで目的外の種類が警告なしに書き換わる。
markdownlint-cli2 は `.mjs`・`.png`・`.yml` まで書き換えて構文エラーや fixture の破損を起こし、oxfmt は `.md` の表の桁をそろえた。

- `markdownlint-cli2`: `.markdownlint-cli2.yaml` の `ignores` で `.md` 以外を外す。`ignores` は引数で渡したファイルにも当たる。
- `oxfmt`: `oxfmt.config.ts` の `ignorePatterns` を、lefthook の `oxfmt-*` のジョブと同じ種類（JS・TS・JSON・YAML）の許可リストにする。
  oxfmt は `.md`・`.css`・`.html`・`.toml` も整形するので、外す種類を挙げる形にはしない。

どの渡し方でも割り当て外の種類が変わらないことは、`scripts/gates/tooling/formatter-scope.test.ts` が実物のツールで確かめる。
許可リストと lefthook の一致は `scripts/gates/tooling/lint-scope.test.ts` が確かめる。
Markdown の整形は `markdownlint-cli2 --fix` で行う。
生成物は、生成スクリプト自身が出力ファイルを並べて整形する。手順書で人に oxfmt を当てさせない。

`markdownlint-cli2` の行長のルール（MD013）は strict にせずに使う（`line_length: 200`。`code_blocks`・`tables`・`headings` は除く）。
200 桁を超えた行のうち、200 桁より後に半角スペース（改行できる位置）が残る行だけを違反にする。
日本語だけの長い行は空白で区切らないので通るが、英数字やツール名など半角スペースを含む語を長い行に足すと失敗する。
日本語の長い行に英数字を足したら、200 桁以内に収めるか、200 桁より後に半角スペースが残らないように折り返す。

### 文章のチェック

文章の規則（配布スキル `writing-style` の `references/rules.md` の規則 1〜10）のうち、規則 2・4・6・7・8 の一部は `scripts/gates/prose/lint-prose.ts` が textlint でチェックする（pre-commit と CI）。
設定は `.textlintrc.json`、使わない語の一覧は `.textlint/words.json` に置く。
Markdown に加えて、JavaScript・TypeScript・シェル・YAML のコメントもチェックする。
コメントは日本語を含む段落だけを見て、文字列（利用者に表示するメッセージ）は見ない。メッセージは、書いた人とレビューする人が確かめる。

- 語を一覧に足すときは、言い換え先を `message` に、検出されることを確かめる文を `example` に書く。
  `scripts/gates/prose/lint-prose.test.ts` が全エントリの `example` で検出されることを確かめる。
- 読みやすさの規則を例の文から語の並びとして lint にするかを決めるときは、例と同じ語の並びを持つ自然な文を 1 つ以上書き、その文を検出しないかを確かめる。
  分かりにくさが語そのものではなく、係り受けや指す対象のような意味から来る規則は、lint にしない。
  lint にするなら、その文を `scripts/gates/prose/lint-prose.test.ts` の、誤検知しないことを確かめるテストに入れる。
  どの部分が分かりにくいかの判断が分かれる形は、依頼した人に確かめてから決める。
  足した規則に既存の文書が当たっても、規則を作った人の判断だけで書き換えない。自然に読める可能性がある箇所は、例として依頼した人に示す。
- 図の線のように字義どおりの意味で使う語は、その箇所だけ `<!-- textlint-disable -->` で除外する。
  コメントでは、`textlint-disable` と `textlint-enable` だけを書いたコメントの行で囲む。

規則 5 のダッシュでつないだ強調（`——` と、字形の違う `――`・`──`・`－－`）は、`lint-prose.ts` と応答の Stop の Hook が検出する。
規則 9 の時期の語（「現状は」「当面」など）と日付は、`scripts/gates/prose/check-time-sensitive-prose.ts` が検出する。
`scripts/gates/prose/check-version-mentions.ts` は、ツールのバージョンを書いた記述のうち、宣言（`package.json` と `pnpm-lock.yaml`、`mise.toml` の `[tools]`）と食い違うものを検出する（規則 9）。
`mise.toml` の宣言は `mise ls --current --json` で mise に解決させて読む。`mise.toml` を上書きする設定（`mise.local.toml`・`MISE_ENV` など）は読ませない。mise を起動できない環境と、それでも `mise ls` が上書きの宣言を返した環境では、チェックできないとして exit 2 で止まる。
範囲の書き方（「以上」「〜」など）でも、宣言と違う `X.Y.Z` は違反にする。必要な最低のバージョンのように正しい記述は、`scripts/gates/docs/doc-allowed.json` に理由付きで許可する。
バージョンを書かなくても意味が通るかは判定できないので、書いた人とレビューする人が確かめる。
それ以外の形を含め、規則 1・3・5・9・10 は機械では判定しきれない。書いた人とレビューする人が確かめる。
規則 10 の分かりにくさは意味から来るので、語の並びで検出すると誤検知と見逃しが避けられない。そのため lint にしない。

人への応答はファイルではないので、pre-commit と CI の textlint ではチェックできない。
代わりに、Claude Code の Stop の Hook（`scripts/hooks/response-word-check.ts`）が、応答を確定する前に同じ辞書で使わない語を確かめ、見つかれば書き直させる。
使わない語の一覧 `.textlint/word-list.md` は `AGENTS.md` から `@` で取り込み、Claude Code がセッション開始時に読み込むようにしている。
`@` での取り込みは Claude Code だけが処理するので、他のエージェントには `AGENTS.md` の文で一覧を開くよう指示している。
この一覧は `.textlint/words.json` の `term` と `instead` から `scripts/tools/generate-word-list.ts` で生成する。pre-commit が、`words.json` か一覧が staged のときに、index の `words.json` から生成し直して stage する。

### JavaScript の拡張子

JavaScript の拡張子は、配布するかどうかで使い分ける。新しいファイルもこれに従う。

| 種類 | 拡張子 | 理由 |
| --- | --- | --- |
| 配布スキル（`skills/**`）の JavaScript | `.mjs` | インストール先の `package.json` の `type` に依らず、Node が常に ESM として読むため |
| リポジトリ内のツールとテスト（`scripts/**/*.ts`）、配布しない private skill のスクリプト | `.ts` | `pnpm run typecheck` で型を検査するため。Node（`mise.toml` のバージョン）が型を消して直接実行するので、ビルドは要らない |
| ツールが読む設定 | `.ts` | 各ツールが `.ts` を自動で探して読むため |

private skill は、`.private-skill` を持ち、`.agents/skills/<name>/` にだけ在るスキルである。

`scripts/**` と private skill の `.ts` は、Node が型を消すだけで実行できる構文で書く。`enum`・`namespace`・constructor の parameter properties は使わない。
`tsconfig.repo.json` の `erasableSyntaxOnly` が、これを型の検査で失敗にする。
型だけの import は `import type` で書き、相対 import は `.ts` の拡張子まで書く（`verbatimModuleSyntax` と `allowImportingTsExtensions`）。
型の検査を警告なしに外す書き方（non-null の表明 `!`・`any`・`@ts-ignore` など）は、`oxlint.config.ts` の `overrides` で失敗にする。
対象はリポジトリの TypeScript 全体で、eval の fixture だけは non-null の表明を外す（下流のプロジェクトの書き方をそのまま持つため）。
禁じるのは、名前を挙げた書き方だけではない。型の検査を警告なしに外す書き方は、同じ理由ですべて禁じる。
null や undefined になりうる値は、表明せずに確かめて型を絞る。テストでは vitest の `assert`（`assert.exists` など）を使う。
型の表明（`as T`）も同じ設定で失敗にする（`as const` と `satisfies` は使ってよい）。型ガード・`instanceof`・型の注釈で書き換える。
表明が避けられない箇所は、その行に `// oxlint-disable-next-line typescript/consistent-type-assertions -- <理由>` を書く。
ただし、配布スキル（`skills/**`）には行の disable コメントを置かず、`oxlint.config.ts` の `overrides` でファイルごとに外す（`check-skill-lint-directives.ts` が検出する）。
何も抑えていない disable のコメントは、`reportUnusedDisableDirectives` が失敗にする。
よく使う形は `scripts/lib/` の helper にまとめ、表明をそこだけに置く。
catch の値は `errors.ts`、わざと不正な入力と欄の削除は `test-input.ts`、外部の JSON は `parse-as.ts`、YAML は `yaml-as.ts` を使う。
例外は、ミューテーションテストのランナーである。`scripts/lib/` を import せず、同じ helper をファイルの中に持つ。
テストがランナーのファイルだけをリポジトリの外にコピーして起動するからである。
private skill は配布せず、このリポジトリの中でだけ動くので、`scripts/lib/` の helper を import して使う。
配布スキルは `.mjs` のままにする。利用者の Node で動くので、`.ts` にすると利用者に求める Node のバージョンが上がる。

ツールが読む `.ts` の設定は次のとおりである。

- `vitest.config.ts`、`scripts/lib/testing/vitest-global-setup.ts`
- `commitlint.config.ts`、`release.config.ts`、`commit-types.ts`
- `oxlint.config.ts`、`oxfmt.config.ts`

commitlint と semantic-release は TypeScript の loader に `typescript` を使うので、devDependencies に明示する。
oxlint の `.ts` の設定は Node.js から起動することが前提なので、バイナリを直接起動せず `pnpm exec oxlint` で起動する。
`.ts` を読まないツールの設定は、元の形式のままにする。markdownlint-cli2 は `.mjs`・`.cjs`・JSON・YAML を、lefthook は YAML・JSON・TOML を読む。
mise・pnpm・GitHub・各エージェントの設定は、形式をツールが決めている。

`scripts/gates/code/check-js-extensions.ts` が、この規約を lefthook の pre-commit と CI（`Lint` ジョブ）でチェックする。
失敗にするのは、次の拡張子である。走査するのは、追跡しているファイルと、`.gitignore` に当たらない未追跡のファイルである。

- `skills/**`: `.js`・`.cjs`・`.mts`・`.cts`・`.tsx`・`.jsx`。`skills/<name>/assets/`（利用者のプロジェクトへ置く雛形）の外の `.ts` も失敗にする。
- `scripts/**` と private skill: `.js`・`.mjs`・`.cjs`・`.mts`・`.cts`・`.tsx`・`.jsx`。private skill の `.ts` は `scripts/` の下だけに置く（型の検査の対象がそこだけのため）。
  `.mts`・`.cts` は Node が実行できるのに `tsconfig.repo.json` の include（`*.ts`）に入らない。`.tsx`・`.jsx` は Node が実行できない。拡張子は大文字と小文字を区別せずに照合する。
- 許す拡張子（`skills/**` の `.mjs` と雛形の `.ts`、`scripts/**` と private skill の `.ts`）は、小文字だけを許す。
  tsconfig の include と Node は大文字と小文字を区別するので、`a.TS` は禁止リストに当たらないのに型の検査に入らない。
  private skill の `scripts/` のディレクトリ名も、同じ理由で小文字だけを許す。private skill の `scripts/` の外の `.d.ts` も失敗にする（型の検査に入らない）。

### 型の検査

`pnpm run typecheck`（`tsc -b --force`）が `.ts`・`.tsx` と配布スキルの `.mjs` の型を検査する。CI は `Lint` ジョブで実行する。
lefthook の pre-commit は、TypeScript か JavaScript（`ts`・`tsx`・`mts`・`cts`・`js`・`mjs`）か、tsconfig か依存が staged のときに実行する。
対象の拡張子は `lefthook.yml` の glob で決める。
`--force` を付けるのは、`tsc -b` が up to date かを include の対象と tsbuildinfo の時刻だけで判定し、依存の型（`node_modules`）が変わってもプロジェクトを飛ばすからである。
1 つのファイルの変更が import する側の型を変えるので、staged のファイルだけでなく全体を検査する。

`tsconfig.json` は参照を束ねるだけで、対象と設定は次の 5 つで決める。共通の設定は `tsconfig.base.json` に置く。
参照は `tsconfig.skills.json` を `tsconfig.repo.json` より先に挙げる。oxlint の型の情報を使うルール（`oxlint-tsgolint`）は、ファイルを含む参照のうち先に挙げたものの設定で型を読む。
配布スキルの `.mjs` は両方に含まれ、`tsconfig.repo.json` の lib には `dom` が無いので、後に挙げると DOM の型が解決できず誤って検出される。

| 設定 | 対象 | 解決の規則 |
| --- | --- | --- |
| `tsconfig.repo.json` | Node が直接実行する `.ts`（設定ファイル・`scripts/`・private skill の `scripts/`） | `nodenext` |
| `tsconfig.skills.json` | 配布スキルの `.mjs`（`skills/*/**`）を `checkJs` で検査する。lib に `dom` を含める（ブラウザの中で評価する関数を持つため） | `nodenext` |
| `tsconfig.templates.json` | 配布スキルの `.ts`・`.mts`・`.cts`（`skills/*/**` と、インストール済みのコピーの `.agents/skills/*/**`）。今あるのは `assets/` の雛形だけで、`assets/` の外に足した `.ts` も対象になる。Node が直接実行する `.ts` を配布スキルに足すなら、`nodenext` のプロジェクトへ分ける | `bundler` |
| `tsconfig.templates-links.json` | Claude Code 用のリンクから見た同じファイル（`.claude/skills/*/**`） | `bundler`（`tsconfig.templates.json` を継承する） |
| `tsconfig.fixtures.json` | eval の fixture（`evals/*/fixtures/**/*.{ts,tsx}`） | `bundler`、`jsx: react-jsx` |

インストール済みのコピーとリンクも対象にするのは、対象の外のファイルをエディタで開くと推論プロジェクトとして扱われ、Node の型のエラーが出るからである。
エディタは、開いたパスのままでプロジェクトを探す。
リンクを別のプロジェクトにするのは、tsc が同じプロジェクトの中で実体を読み込み済みのシンボリックリンクを辿らず、`tsconfig.templates.json` の `include` に足しても対象にならないからである。

雛形は、利用者のプロジェクトへコピーした後に Playwright が読み込む。Playwright は拡張子なしの相対 import も解決するので、`bundler` で検査する。
雛形が import する、コピー先にだけ在るモジュール（`../../lib/interactions` など）は、`types/parity-templates.ts` で `*` を含む名前の ambient 宣言にする。
`*` を含む名前は相対の import にも一致するので、雛形に `// @ts-nocheck` などを足さずに済む。利用者のコピーには何も入らない。
雛形に新しい import を足したら、`types/parity-templates.ts` にも足す。`@playwright/test` の型は devDependencies から読む。
`types/` の宣言は `.d.ts` にしない。`skipLibCheck` は `node_modules` の型だけでなく、すべての `.d.ts` を検査から外すので、宣言の誤りが警告なしに通る。

`JSON.parse` と `Response.json()` の戻り値は、`types/strict-json.ts` で `unknown` にしている（`tsconfig.repo.json` と `tsconfig.skills.json` が読む）。
`any` を経由すると、型の注釈も型の表明も無いまま検査が外れるためである。
受け取った後に形を検証するコードは、`unknown` で受けて型ガード（`scripts/lib/guards.ts` の `isRecord` など）で絞る。
`parseJsonAs<T>` は検証していない値に完全な型を付けるので、検証が抜けても `tsc` が警告しない。形を確かめない読み方（テストが出力を `expect` で確かめる場合など）にだけ使う。

配列への絞り込みは、`Array.isArray` ではなく `isArray` で行う。`Array.isArray` は `any[]` に絞るので、要素を読む処理で同じように検査が外れる。
`isArray` は入力の型の配列の部分（`unknown` なら `unknown[]`、`number[] | undefined` なら `number[]`）に絞る。
`scripts/**` と private skill は `scripts/lib/is-array.ts` を、配布スキルは各スキルの `scripts/lib/is-array.mjs` を import する。
直接の呼び出しは、`oxlint.config.ts` の `no-restricted-properties` が失敗にする。
型ガードの中で組み込みの判定を呼ぶファイルは、行の disable コメントではなく、`oxlint.config.ts` の `overrides` でファイルごとに外す（一覧は `scripts/lib/is-array-holders.ts`）。
配布スキルのファイルは利用者のプロジェクトへ入り、そこでは使われない disable のコメントになるからである。
外したファイルでは、型ガードの外の呼び出しを oxlint が検出しないので、書いた人とレビューする人が確かめる。
import できない雛形（`skills/*/assets/*.template.ts`）とミューテーションテストのランナーは、同じ関数をファイルの中に持つ。
利用者のプロジェクトへ 1 ファイルだけコピーして使う配布スキルのツール（`trait-compare.mjs` など）も同じである。
コピーとの一致は `check-identical-copies.ts` が確かめる。
1 ファイルだけコピーして使うツールが単独で読み込めることは、`scripts/skills/_cross/vendored-tool-standalone.test.ts` が確かめる。

`isArray` 以外の helper（型ガード・CLI の起動の判定など）も、配布スキルの中で複数のファイルが使うものは、そのスキルの `scripts/lib/` に 1 つだけ置いて import する。
各ファイルに同じ helper を書くと、同じ名前で中身が食い違っても気付けない。中身が違うものは、意味ごとに名前を分ける（配列も通すものは `isObjectLike`）。
スキルをまたいでは共通化しない。同じ内容であるべきコピーは、`isArray` と同じく `check-identical-copies.ts` の組に登録する。
スキルの中の重複を検出するチェックは無いので、これは規約である（一致を確かめるのは、登録したコピーの組だけである）。

型ガードは、絞る型の値すべてに true を返す判定にする。一部の値にだけ true を返すなら、ブランド型に絞る。オブジェクトの形の型ガードも同じである。
一部の値にだけ true を返す型ガード（空文字や空白を除く文字列・有限の数など）は、絞る型をブランド型にする。
`v is string` と書くと、false の側から `string` が取り除かれ、実際には来る `""` や `"  "` が型の上で消える。
`v is string & { readonly __<関数名>: true }` と書けば、false の側には元の型が残る。true の側の値は `string` の一種なので、`string` を受け取る関数にそのまま渡せる。
配列の型ガードは、要素ではなく配列にブランドを付ける（`v is string[] & { readonly __<関数名>: true }`）。要素にブランドを付けると、その要素を `string` の配列の `includes` に渡せなくなる。
要素の型ガードを `.every` に渡して絞った配列は、要素がブランド型になる。この配列を検査していない `string` と比べるときは、`includes` の代わりに `some((x) => x === y)` を使うか、`/** @type {Set<string>} */` の注釈で受けた `Set` で比べる。
判定が型と一致する型ガード（`typeof` だけのもの、`isArray`）と、false の側が無いもの（`asserts`）は、ブランド型にしない。
呼び出しの引数に直接渡す関数（`filter`・`every` のコールバックなど）も、false の側を使うかを呼び出し先が決めるので、ブランド型にしなくてよい。
型ガードがこの規約に従うかは、チェックするツールが無いので、書いた人とレビューする人が確かめる。

配布スキルの `.mjs` では、型の検査を外す JSDoc の書き方を `scripts/gates/types/check-jsdoc-types.ts` が失敗にする。
失敗にするのは、型の表明 `/** @type {X} */ (v)`（TypeScript の `as` と同じ）と、`@ts-ignore`・`@ts-expect-error`・`@ts-nocheck` である。
JSDoc の型の `any`・`*`・`?`・`Function` と、型引数の無い `Object` も失敗にする。
判定は TypeScript のパーサで読んだ構文だけで行い、型の名前は解決しない。
そのため、型引数を省くとデフォルトの `any` が入る型（`Generator<string>` は `Generator<string, any, any>` になる）は検出しない。書く人とレビューする人が、型引数をすべて書く。
宣言の注釈（`/** @type {X} */ const v = ...`）・`@satisfies`・`/** @type {const} */ (v)` は、型を外さないので使ってよい。
配布スキルが利用者のプロジェクトから読み込むモジュール（`pngjs` など）の型は、使う欄だけを `types/skill-runtime/<モジュール名>.ts` に書き、`tsconfig.skills.json` の `paths` でそこへ解決する。
大域の `declare module` にしないのは、`.mjs` をモジュールとして読む判定（`moduleDetection`）を変えずに済ませるためである。

eval の fixture は、エージェントに渡す下流のプロジェクトの断片で、依存のパッケージ（架空のものを含む）や同じ階層のファイルを置いていない。
それらは `types/eval-fixtures.ts` で、fixture が使う範囲の型を書いて宣言する。fixture に import を足したら、この宣言にも足す。
雛形の宣言と同じファイルにしないのは、ambient 宣言がプロジェクトの全体に適用され、互いの検査で一致してしまうからである。
fixture の検査も strict のままにする。型が足りない fixture は、fixture に型を書いて直す。fixture は eval の入力なので、直したら `docs/skill-development.md` に従ってその eval を実行し直す。

`composite` のプロジェクトは、import した `.mjs` も `include` に挙げる必要がある。
そのため `tsconfig.repo.json` は、`scripts/` のテストが import する `skills/*/scripts/**/*.mjs` と `skills/*/assets/**/*.mjs` を含める。
`tsconfig.repo.json` では `checkJs` を付けず、配布スキルの JavaScript の型は `tsconfig.skills.json` で検査する（lib と型の宣言が違うため）。
インストール済みのコピーの `scripts/`（`.agents/skills/*/scripts/**` と `.claude/skills/*/scripts/**`）は、`tsconfig.templates.json` と `tsconfig.templates-links.json` から外す。
そこに在る `.ts` は private skill のもので、Node が直接実行するので `tsconfig.repo.json` で検査する。

### チェックの対象から外すもの

配布スキルに同梱した jsonc-parser（`skills/*/scripts/skill-config/vendor/**`）は、外部のパッケージから作った生成物なので、lint・整形・型の検査・カバレッジ・文章の規約の対象から外す。
範囲は `scripts/lib/source-scope.ts` の `VENDORED_GLOBS` で定義する。原本との一致は `check-skill-config-vendor.ts` が確かめる。

`tests/**` は、リントと整形の対象に含める。`.agents/skills/**` と `.claude/**` は、インストール済みのコピーとエージェント用のシンボリックリンクなので、対象から外す。
型の検査は、エディタで開く雛形のコピーとリンクを対象にする（上の「型の検査」）。
ただし、`.agents/rules/`（rule の実体）と private skill（`.private-skill` を持つ `.agents/skills/<name>/`）は対象にする。rule へのリンクを置く `.github/instructions/` は対象から外す。
