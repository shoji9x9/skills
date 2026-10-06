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
| JavaScript・TypeScript（`*.js`、`*.mjs`、`*.ts` など） | `oxlint` | `oxfmt` | なし |
| JSON（`*.json`） | `jsonlint` | `oxfmt` | 重複したキーもチェックする |
| YAML（`*.yml`、`*.yaml`） | `js-yaml`（`scripts/gates/lint-yaml.js` が API で 1 つのプロセスにまとめて読む） | `oxfmt` | なし |
| シェル（`*.sh`） | `shellcheck` | `shfmt` | `scripts/gates/lint-pagination.js` が `gh api` のページネーションをチェックする |
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
| `lint-prose.js` | 人が読む Markdown の文章。書き換え前のファイルは `scripts/gates/prose-lint-pending.json` に書く |
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
ランナーのテストのうち本物の vitest を使うのは e2e の 3 本だけで、残りはスタブで実行する（`MUTATION_PROOF_TEST_COMMAND`）。

すべての定義は、週に 1 回の定期実行（`.github/workflows/mutation-proof.yml`）で測る。
対象もチェックも変わっていない定義は前回の結果が有効だが、共有ライブラリやツールの版が変わると前提が成り立たなくなることがあるので、測り直す。

pre-commit には入れない。実行中に対象のファイルを書き換えて戻すので、staged の変更と混在すると取り違える。
並列にも実行しない。同時の実行はロックで止めるが、無関係な `pnpm test` と重なると、変異を入れた途中の状態を読んで無関係なテストが失敗する（実測）。

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

`oxfmt` には Markdown を渡さない。oxfmt は渡されたファイルを種類で判定して整形するので、`.md` を渡すと表の桁もそろえる。Markdown の整形は `markdownlint-cli2 --fix` で行う。
`oxfmt` にはディレクトリを渡さず、対象のファイルを並べて渡す。ディレクトリを渡すと、目的外のファイルが警告なしに書き換えられる。
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

### チェックの対象から外すもの

`tests/**` は、リントと整形の対象に含める。`.agents/skills/**` と `.claude/**` は、インストール済みのコピーとエージェント用のシンボリックリンクなので、対象から外す。
ただし、`.agents/rules/`（rule の実体）と private skill（`.private-skill` を持つ `.agents/skills/<name>/`）は対象にする。rule へのリンクを置く `.github/instructions/` は対象から外す。
