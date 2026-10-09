# ツールとチェック

`AGENTS.md`「技術スタック」の詳細。ツールの使い方と、pre-commit・CI で実行するチェックをまとめる。

## 技術スタック

- スキルは GitHub CLI（`gh skill`、v2.90.0 以上）と Agent Skills 仕様で管理する。
- パッケージマネージャは pnpm で、版は mise で管理する。
  版は `mise.toml`、`package.json` の `packageManager` と `devEngines.packageManager`、`pnpm-lock.yaml` の 4 か所に書く。
  npm は使わず、`package-lock.json` を作らない。誤って別のパッケージマネージャを使うと、`devEngines` が警告する。
  4 か所をそろえて版を上げる手順と、不具合のある版を避ける方法は [`docs/package-manager.md`](package-manager.md) にある。
- フォーマッタとリンタは「リントと整形」の表のとおりである。prettier は使わない。
- テストは skill-creator で行う。eval viewer には Python 3.8 以上が要る。結果の集計は `scripts/eval/build-skill-eval-benchmark.js`（Node）で行う。
- 実行環境は mise で管理する。

### ツールの起動

スクリプト・lefthook・CI からツールを起動するときは、`./node_modules/.bin/<tool>` のパスを直接書かず、`pnpm exec <tool>` か mise の shim で起動する。

1 回の実行で同じツールを多数回（数十以上）起動するスクリプトは例外とする。`pnpm exec` の起動にかかる時間（実測で 1 回約 0.6 秒）が、実行時間の大半を占めるためである。
この場合は、Node のモジュール解決（`createRequire(...).resolve("<pkg>/package.json")` の `bin`）でエントリを求め、`node` で起動してよい。
`scripts/mutation/check-mutation-proof.js` は、子プロセスの vitest をこの方法で起動する。この場合も `.bin` のパスは直接書かない。

mise の shim は、cwd の設定の階層からツールの版を決める。
リポジトリの外の cwd（`/tmp` など）からコマンド名だけで起動すると、`No version is set for shim` で失敗する。グローバルのデフォルトが無いためで、untrusted とは別の失敗である。
リポジトリの外で動かす検証では、`mise which <tool>` で実体のパスを取得して渡すか、cwd をリポジトリの中に保つ。

### リントと整形

| 対象 | リント | 整形 | 補助のチェック |
| --- | --- | --- | --- |
| Markdown（`*.md`） | `markdownlint-cli2` | `markdownlint-cli2` | `scripts/gates/lint-pagination.js` が shell のコードブロックの `gh api` のページネーションを、`scripts/gates/lint-prose.js` が人が読む文章を textlint でチェックする |
| JavaScript・TypeScript（`*.js`、`*.mjs`、`*.ts` など） | `oxlint` | `oxfmt` | `tsc`（`pnpm run typecheck`）が `.ts`・`.tsx` の型を検査する（下の「型の検査」）。`scripts/gates/lint-prose.js` がコメントの文章を textlint で、文字列（テスト名・メッセージ）を使わない語の規則でチェックする |
| JSON（`*.json`） | `jsonlint` | `oxfmt` | 重複したキーもチェックする。`scripts/gates/lint-prose.js` が `evals/<name>/evals.json` の文字列を使わない語の規則でチェックする |
| YAML（`*.yml`、`*.yaml`） | `js-yaml`（`scripts/gates/lint-yaml.js` が API で 1 つのプロセスにまとめて読む） | `oxfmt` | `scripts/gates/lint-prose.js` がコメントの文章を textlint でチェックする |
| シェル（`*.sh`） | `shellcheck` | `shfmt` | `scripts/gates/lint-pagination.js` が `gh api` のページネーションを、`scripts/gates/lint-prose.js` がコメントの文章をチェックする |
| GitHub Actions（`.github/workflows/*.{yml,yaml}`） | `actionlint` と `ghalint` | `oxfmt` | `pinact` が SHA の固定を確かめる |

表のうち `shellcheck`・`shfmt`・`actionlint`・`pinact`・`ghalint`・`gitleaks` は、mise でインストールし（`mise.toml`）、コマンド名だけで起動する。
それ以外は pnpm の devDependencies に入れ、`pnpm exec` で起動する。

`oxlint` と `oxfmt` の対象は、JS・TS の拡張子すべて（`js`・`mjs`・`cjs`・`jsx`・`ts`・`tsx`・`mts`・`cts`）である。
CI は引数なしで実行する（`pnpm run lint:js`）ので、この範囲を自動で拾う。
lefthook の glob と `format:js*` スクリプトの glob も、この範囲にそろえる。片方だけが狭いと、その拡張子は手元でチェックされず、CI でだけ失敗する。

GitHub Actions は、`actionlint` で構文を、`ghalint` で `permissions`・`timeout-minutes`・`persist-credentials` などの方針をチェックする。
`ghalint` はリポジトリ全体を読むので pre-commit に入れず、CI の `GitHub Actions lint` だけで実行する。

ファイルの種類に依らない横断のチェックは、pre-commit と CI の `Lint` ジョブで実行する。どのチェックも、対象が 0 件のときは成功にしない。

| スクリプト（`scripts/gates/`） | チェックする内容 |
| --- | --- |
| `check-rule-symlinks.js` | rule を各エージェントから読むためのシンボリックリンク |
| `check-control-chars.js` | テキストの拡張子のファイルに入った制御文字 |
| `check-eval-reachability.js` | eval の assertion と prompt の対応 |
| `check-skills-sync.js` | `skills/<name>/` とインストール済みのコピー `.agents/skills/<name>/` の一致 |
| `check-js-extensions.js` | JavaScript の拡張子（「JavaScript の拡張子」の節） |
| `check-skill-frontmatter.js` | `SKILL.md` の frontmatter |
| `lint-pagination.js` | `gh api` などの一覧の取得のページネーション |
| `check-kaizen-refs.js` | `.kaizen/` の学びへの参照の実在。意図して実在しないものは `scripts/gates/kaizen-refs-exemptions.json` に書く |
| `check-identical-copies.js` | 同じ内容であるべきコピー。組は `scripts/gates/identical-copies.json` に書く |
| `check-skill-checks.js` | 配布スキルのチェック（`*-check.*`）の分類。利用者の pre-commit・CI に組み込むもの（`skills/<name>/checks.json`）か、組み込まないもの（理由を付けて `scripts/gates/skill-checks-unwired.json`）のどちらかにする |
| `check-time-sensitive-prose.js` | 日付・「現状は」「当面」を Tier 1〜3 の文書とコメントに書いていないか。変異の件数や全件の実測値は `mutation-proof.yml` だけに書く |
| `check-doc-tiers.js` | 文書の階層。原本は `scripts/gates/doc-tiers.json` で、`.agents/rules/doc-altitude.md` の表は `--fix` で生成する |
| `check-doc-refs.js` | リンクと節名の実在、参照の向き。節名は、パス（バッククォート・リンク・スキル名付き）の後に「」で書いたものを照合する。間に「の」や空白を挟んでもよく、節名でない語句を引用するときは名詞を挟む。導入先で生成するファイルは `scripts/gates/doc-refs.json`、保留は `scripts/gates/doc-pending.json` に書く |
| `check-skill-index.js` | スキルガイド・README とスキルの実体の対応 |
| `lint-prose.js` | 人が読む Markdown の文章と、JavaScript・TypeScript・シェル・YAML のコメントの文章。JavaScript・TypeScript の文字列と `evals/<name>/evals.json` の prompt・expected_output・assertions には、使わない語の規則だけを当てる（取り出し方は `scripts/lib/code-strings.js`）。シェルのコメントは `shfmt --to-json` の構文木から取り出すので、shfmt（`mise.toml` で版を固定）が要る。書き換え前のファイルは `scripts/gates/prose-lint-pending.json` に書く |
| `check-word-list.js` | `.textlint/word-list.md` と `.textlint/words.json` の一致 |
| `check-agents-md-size.js` | `AGENTS.md` のサイズ。ブランチで 30 KiB を超えたら、24 KiB 以下まで縮めさせる。超えたかは履歴で判定し、上限は `scripts/gates/agents-md-size.json` に書く |

### ミューテーションテスト（CI だけで実行）

`scripts/mutation/check-mutation-proof.js` は、`scripts/**/*.mutations.json` の定義をもう一度実行する。
各変異について、置換が当たったことと、定義したテストだけが失敗したことを確かめる。
チェックが違反を検出できることをコメントの文章で記録すると、コードが変わったときに古くなる。そこでデータとして持ち、このランナーで機械的に測り直す。

PR では、差分に関係する定義だけを測る（`--changed-since origin/<base>`）。関係するのは次の 3 通りである。

- ランナーが変わったとき。すべての定義を測る。
- 定義ファイル自身が変わったとき。
- その定義の `test_file` か、変異の対象のファイルが変わったとき。

すべての定義を測ると、PR ごとには払えない時間がかかる。実測値は `.github/workflows/mutation-proof.yml` のコメントにある。
1 つの変異につき対象のテストファイルを 1 回実行するので、対象のテストは子プロセスを起動せず `main` を直接呼ぶ。CLI として起動するテストは、変異を検出できることを確かめる数本に絞る。
CI では、選んだ変異を matrix で 6 つに分けて並列に実行する（`--shard i/N`）。必須チェックの `Mutation proof (PR)` は、全シャードの成功を確かめる集約ジョブが持つ。
文書を含む変更は、push の前に手元でも `--changed-since origin/main` を実行する。文書を読むテストを持つ定義も選ばれるので、文書の書き換えで落ちる定義を CI の前に見つけられる。
`--changed-since` は commit の差分（`origin/main...HEAD`）だけを見るので、commit した後に実行する。commit する前は「変更ファイル: 0 件」になり、何も測らない。
ランナーのテストのうち本物の vitest を使うのは e2e の 3 本だけで、残りはスタブで実行する（`MUTATION_PROOF_TEST_COMMAND`）。

すべての定義は、週に 1 回の定期実行（`.github/workflows/mutation-proof.yml`）で測る。
対象もチェックも変わっていない定義は前回の結果が有効だが、共有ライブラリやツールの版が変わると前提が成り立たなくなることがあるので、測り直す。

pre-commit には入れない。実行中に対象のファイルを書き換えて戻すので、staged の変更と混在すると取り違える。
並列にも実行しない。同時の実行はロックで止めるが、無関係な `pnpm test` と重なると、変異を入れた途中の状態を読んで無関係なテストが失敗する（実測）。

実行中は、その作業ツリーの変異の対象を編集しない。原本を読んでコピーする処理（`scripts/tools/reinstall-skill.sh`・成果物の生成）も実行しない。
ランナーは変異 1 件ごとに元の内容を書き戻すので、実行中の編集は消え、コピーには実行中の変異が入る（どちらも実測）。
ランナーは書き戻す直前に、対象の今の内容を分類する。自分の書いた変異のままなら書き戻す。
元の内容に戻されていた場合と、消されていた場合（元の内容で作り直す）は、測定が無効なので結果を出さずに exit 2 で止まる。
どちらでもない（外からの編集）場合は、上書きせずに exit 2 で止まり、復元情報を残す。次回の起動も、同じ食い違いで止まる。
実行しながら同じファイルを編集したいとき（変更前の所要時間の計測など）は、基点の commit の別の worktree（`git worktree add --detach`）で実行する。
バックグラウンドで実行したときの完了は、完了の通知ではなく、プロセスが無いこと（`/proc/<pid>`）と、ログの最終行（`mutation-proof: N proven / M failed`）で判断する。

ランナー自身を変異させる定義があるときは、`--changed-since` を測るテストを `--only` で絞る。
選ぶ判定を常に真にする変異が入ると、入れ子のランナーが指数的に増える。実測では 30 分以上かかって 21 以上のプロセスが起動し、止めた後の作業ツリーに変異が残った。

### その他のチェックと整形

Bash の実行前のチェック（PreToolUse）として、`scripts/hooks/bash-command-guard.sh` が次の 2 つの形を止める。どちらも、文章の規約では防げずに再発した形である。

- `gh api` と同じセグメントにある `--body-file`。`gh api` にこのフラグは無い。`gh pr` と `gh issue` の `--body-file` は通す。
- 文字クラスで自分を避けていない `pkill -f` と `killall -f`。照合するのがコマンドライン全体なので、自分のシェルにも一致する。

このチェックは、3 つのエージェントに設定してある（`.claude/settings.json`・`.codex/hooks.json`・`.github/hooks/kaizen-session.json`）。

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

どの渡し方でも割り当て外の種類が変わらないことは、`scripts/gates/formatter-scope.test.js` が実物のツールで確かめ、許可リストと lefthook の一致は `scripts/gates/lint-scope.test.js` が確かめる。
Markdown の整形は `markdownlint-cli2 --fix` で行う。
生成物は、生成スクリプト自身が出力ファイルを並べて整形する。手順書で人に oxfmt を当てさせない。

`markdownlint-cli2` の行長のルール（MD013）は strict にせずに使う（`line_length: 200`。`code_blocks`・`tables`・`headings` は除く）。
200 桁を超えた行のうち、200 桁より後に半角スペース（改行できる位置）が残る行だけを違反にする。
日本語だけの長い行は空白で区切らないので通るが、英数字やツール名など半角スペースを含む語を長い行に足すと失敗する。
日本語の長い行に英数字を足したら、200 桁以内に収めるか、200 桁より後に半角スペースが残らないように折り返す。

### JavaScript の拡張子

JavaScript の拡張子は、配布するかどうかで使い分ける。新しいファイルもこれに従う。

| 種類 | 拡張子 | 理由 |
| --- | --- | --- |
| 配布スキル（`skills/**`）の JavaScript | `.mjs` | インストール先の `package.json` の `type` に依らず、Node が常に ESM として読むため |
| リポジトリ内のツールとテスト（`scripts/**/*.js`）、配布しない private skill のスクリプト | `.js` | `package.json` の `"type": "module"` の下で ESM として動くので、拡張子で ESM を示す必要がないため |
| ツールが読む設定 | `.ts` | 各ツールが `.ts` を自動で探して読むため |

private skill は、`.private-skill` を持ち、`.agents/skills/<name>/` にだけ在るスキルである。

ツールが読む `.ts` の設定は次のとおりである。

- `vitest.config.ts`、`scripts/lib/vitest-global-setup.ts`
- `commitlint.config.ts`、`release.config.ts`、`commit-types.ts`
- `oxlint.config.ts`、`oxfmt.config.ts`

commitlint と semantic-release は TypeScript の loader に `typescript` を使うので、devDependencies に明示する。
oxlint の `.ts` の設定は Node.js から起動することが前提なので、バイナリを直接起動せず `pnpm exec oxlint` で起動する。
`.ts` を読まないツールの設定は、元の形式のままにする。markdownlint-cli2 は `.mjs`・`.cjs`・JSON・YAML を、lefthook は YAML・JSON・TOML を読む。
mise・pnpm・GitHub・各エージェントの設定は、形式をツールが決めている。

`scripts/gates/check-js-extensions.js` が、この規約を lefthook の pre-commit と CI（`Lint` ジョブ）でチェックする。`skills/**` の `.js` と、`scripts/**` の `.mjs` を失敗にする。

### 型の検査

`pnpm run typecheck`（`tsc -b --force`）が `.ts`・`.tsx` の型を検査する。CI は `Lint` ジョブで実行する。
lefthook の pre-commit は、TypeScript か JavaScript（`ts`・`tsx`・`mts`・`cts`・`js`・`mjs`）か、tsconfig か依存が staged のときに実行する。
対象の拡張子は `lefthook.yml` の glob で決める。
`--force` を付けるのは、`tsc -b` が up to date かを include の対象と tsbuildinfo の時刻だけで判定し、依存の型（`node_modules`）が変わってもプロジェクトを飛ばすからである。
1 つのファイルの変更が import する側の型を変えるので、staged のファイルだけでなく全体を検査する。

`tsconfig.json` は参照を束ねるだけで、対象と設定は次の 4 つで決める。共通の設定は `tsconfig.base.json` に置く。

| 設定 | 対象 | 解決の規則 |
| --- | --- | --- |
| `tsconfig.repo.json` | Node が直接実行する `.ts`（設定ファイル・`scripts/`） | `nodenext` |
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

eval の fixture は、エージェントに渡す下流のプロジェクトの断片で、依存のパッケージ（架空のものを含む）や同じ階層のファイルを置いていない。
それらは `types/eval-fixtures.ts` で、fixture が使う範囲の型を書いて宣言する。fixture に import を足したら、この宣言にも足す。
雛形の宣言と同じファイルにしないのは、ambient 宣言がプロジェクトの全体に適用され、互いの検査で一致してしまうからである。
fixture の検査も strict のままにする。型が足りない fixture は、fixture に型を書いて直す。fixture は eval の入力なので、直したら `docs/skill-development.md` に従ってその eval を実行し直す。

`composite` のプロジェクトは、import した `.js` も `include` に挙げる必要がある。
そのため `tsconfig.repo.json` は `scripts/**/*.js` と `skills/*/scripts/**/*.mjs` を含める。`checkJs` は付けないので、JavaScript の型は検査しない。

### チェックの対象から外すもの

`tests/**` は、リントと整形の対象に含める。`.agents/skills/**` と `.claude/**` は、インストール済みのコピーとエージェント用のシンボリックリンクなので、対象から外す。
型の検査は、エディタで開く雛形のコピーとリンクを対象にする（上の「型の検査」）。
ただし、`.agents/rules/`（rule の実体）と private skill（`.private-skill` を持つ `.agents/skills/<name>/`）は対象にする。rule へのリンクを置く `.github/instructions/` は対象から外す。
