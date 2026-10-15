# ツールとチェック

`AGENTS.md`「技術スタック」の詳細。ツールの使い方と、pre-commit・CI で実行するチェックをまとめる。

## 技術スタック

- スキルは GitHub CLI（`gh skill`、v2.90.0 以上）と Agent Skills 仕様で管理する。
- パッケージマネージャは pnpm で、版は mise で管理する。
  版は `mise.toml`、`package.json` の `packageManager` と `devEngines.packageManager`、`pnpm-lock.yaml` の 4 か所に書く。
  npm は使わず、`package-lock.json` を作らない。誤って別のパッケージマネージャを使うと、`devEngines` が警告する。
  4 か所をそろえて版を上げる手順と、不具合のある版を避ける方法は [`docs/package-manager.md`](package-manager.md) にある。
- フォーマッタとリンタは「リントと整形」の表のとおりである。prettier は使わない。
- テストは skill-creator で行う。eval viewer には Python 3.8 以上が要る。結果の集計は `scripts/eval/build-skill-eval-benchmark.ts`（Node）で行う。
- 実行環境は mise で管理する。

### ツールの起動

スクリプト・lefthook・CI からツールを起動するときは、`./node_modules/.bin/<tool>` のパスを直接書かず、`pnpm exec <tool>` か mise の shim で起動する。

1 回の実行で同じツールを多数回（数十以上）起動するスクリプトは例外とする。`pnpm exec` の起動にかかる時間（実測で 1 回約 0.6 秒）が、実行時間の大半を占めるためである。
この場合は、Node のモジュール解決（`createRequire(...).resolve("<pkg>/package.json")` の `bin`）でエントリを求め、`node` で起動してよい。
`scripts/mutation/check-mutation-proof.ts` は、子プロセスの vitest をこの方法で起動する。この場合も `.bin` のパスは直接書かない。

mise の shim は、cwd の設定の階層からツールの版を決める。
リポジトリの外の cwd（`/tmp` など）からコマンド名だけで起動すると、`No version is set for shim` で失敗する。グローバルのデフォルトが無いためで、untrusted とは別の失敗である。
リポジトリの外で動かす検証では、`mise which <tool>` で実体のパスを取得して渡すか、cwd をリポジトリの中に保つ。

### リントと整形

| 対象 | リント | 整形 | 補助のチェック |
| --- | --- | --- | --- |
| Markdown（`*.md`） | `markdownlint-cli2` | `markdownlint-cli2` | `scripts/gates/code/lint-pagination.ts` が shell のコードブロックの `gh api` のページネーションを、`scripts/gates/prose/lint-prose.ts` が人が読む文章を textlint でチェックする |
| JavaScript・TypeScript（`*.js`、`*.mjs`、`*.ts` など） | `oxlint` | `oxfmt` | `tsc`（`pnpm run typecheck`）が `.ts`・`.tsx` の型を検査する（下の「型の検査」）。`scripts/gates/prose/lint-prose.ts` がコメントの文章を textlint で、文字列（テスト名・メッセージ）を使わない語の規則でチェックする |
| JSON（`*.json`） | `jsonlint` | `oxfmt` | 重複したキーもチェックする。`scripts/gates/prose/lint-prose.ts` が `evals/<name>/evals.json` の文字列を使わない語の規則でチェックする |
| YAML（`*.yml`、`*.yaml`） | `js-yaml`（`scripts/gates/code/lint-yaml.ts` が API で 1 つのプロセスにまとめて読む） | `oxfmt` | `scripts/gates/prose/lint-prose.ts` がコメントの文章を textlint でチェックする |
| シェル（`*.sh`） | `shellcheck` | `shfmt` | `scripts/gates/code/lint-pagination.ts` が `gh api` のページネーションを、`scripts/gates/prose/lint-prose.ts` がコメントの文章をチェックする |
| GitHub Actions（`.github/workflows/*.{yml,yaml}`） | `actionlint` と `ghalint` | `oxfmt` | `pinact` が SHA の固定を確かめる |

表のうち `shellcheck`・`shfmt`・`actionlint`・`pinact`・`ghalint`・`gitleaks` は、mise でインストールし（`mise.toml`）、コマンド名だけで起動する。
それ以外は pnpm の devDependencies に入れ、`pnpm exec` で起動する。

`oxlint` と `oxfmt` の対象は、JS・TS の拡張子すべて（`js`・`mjs`・`cjs`・`jsx`・`ts`・`tsx`・`mts`・`cts`）である。
CI は引数なしで実行する（`pnpm run lint:js`）ので、この範囲を自動で拾う。
lefthook の glob と `format:js*` スクリプトの glob も、この範囲にそろえる。片方だけが狭いと、その拡張子は手元でチェックされず、CI でだけ失敗する。

GitHub Actions は、`actionlint` で構文を、`ghalint` で `permissions`・`timeout-minutes`・`persist-credentials` などの方針をチェックする。
`ghalint` はリポジトリ全体を読むので pre-commit に入れず、CI の `GitHub Actions lint` だけで実行する。

ファイルの種類に依らない横断のチェックは、pre-commit と CI の `Lint` ジョブで実行する。どのチェックも、対象が 0 件のときは成功にしない。

| スクリプト（`scripts/gates/` からのパス） | チェックする内容 |
| --- | --- |
| `packaging/check-rule-symlinks.ts` | rule を各エージェントから読むためのシンボリックリンクと、Copilot のレビューに読ませる文書（`docs/writing-style.md`）へのシンボリックリンク |
| `code/check-control-chars.ts` | テキストの拡張子のファイルに入った制御文字 |
| `packaging/check-eval-reachability.ts` | eval の assertion と prompt の対応 |
| `packaging/check-skills-sync.ts` | `skills/<name>/` とインストール済みのコピー `.agents/skills/<name>/` の一致 |
| `code/check-js-extensions.ts` | JavaScript の拡張子（「JavaScript の拡張子」の節） |
| `code/check-skill-lint-directives.ts` | 配布スキルの、このリポジトリの lint の設定を前提にした抑止コメント（`.agents/rules/distributed-skill-stack-independence.md`）と、`Array.isArray` の禁止をファイル単位で外したファイル（`scripts/lib/is-array-holders.ts`）の、型ガードの外の呼び出し |
| `code/check-jsdoc-types.ts` | 配布スキルの `.mjs` で、型の検査を外す JSDoc の書き方（「JavaScript の拡張子」の節） |
| `packaging/check-skill-frontmatter.ts` | `SKILL.md` の frontmatter |
| `code/lint-pagination.ts` | `gh api` などの一覧の取得のページネーション |
| `docs/check-kaizen-refs.ts` | `.kaizen/` の学びへの参照の実在。意図して実在しないものは `scripts/gates/docs/kaizen-refs-exemptions.json` に書く |
| `packaging/check-identical-copies.ts` | 同じ内容であるべきコピー。組は `scripts/gates/packaging/identical-copies.json` に書く。`region` を持つ組は、印 `// <region>:begin` と `// <region>:end` の間だけを比べる |
| `packaging/check-skill-checks.ts` | 配布スキルのチェック（`*-check.*`）の分類。利用者の pre-commit・CI に組み込むもの（`skills/<name>/checks.json`）か、組み込まないもの（理由を付けて `scripts/gates/packaging/skill-checks-unwired.json`）のどちらかにする |
| `prose/check-time-sensitive-prose.ts` | 日付・「現状は」「当面」を Tier 1〜3 の文書とコメントに書いていないか。変異の件数や全件の実測値は `mutation-proof.yml` だけに書く |
| `docs/check-doc-tiers.ts` | 文書の階層。原本は `scripts/gates/docs/doc-tiers.json` で、`.agents/rules/doc-altitude.md` の表は `--fix` で生成する |
| `docs/check-doc-refs.ts` | リンクと節名の実在、参照の向き。節名は、パス（バッククォート・リンク・スキル名付き）の後に「」で書いたものを照合する。間に「の」や空白を挟んでもよく、節名でない語句を引用するときは名詞を挟む。導入先で生成するファイルは `scripts/gates/docs/doc-refs.json`、保留は `scripts/gates/docs/doc-pending.json` に書く |
| `packaging/check-skill-index.ts` | スキルガイド・README とスキルの実体の対応 |
| `prose/lint-prose.ts` | 人が読む Markdown の文章と、JavaScript・TypeScript・シェル・YAML のコメントの文章。JavaScript・TypeScript の文字列と `evals/<name>/evals.json` の prompt・expected_output・assertions には、使わない語の規則だけを当てる（取り出し方は `scripts/lib/code-strings.ts`）。シェルのコメントは `shfmt --to-json` の構文木から取り出すので、shfmt（`mise.toml` で版を固定）が要る。書き換え前のファイルは `scripts/gates/prose/prose-lint-pending.json` に書く |
| `prose/check-word-list.ts` | `.textlint/word-list.md` と `.textlint/words.json` の一致 |
| `docs/check-agents-md-size.ts` | `AGENTS.md` のサイズ。ブランチで 30 KiB を超えたら、24 KiB 以下まで縮めさせる。超えたかは履歴で判定し、上限は `scripts/gates/docs/agents-md-size.json` に書く |

### ミューテーションテスト（CI だけで実行）

`scripts/mutation/check-mutation-proof.ts` は、`scripts/**/*.mutations.json` の定義をもう一度実行する。
各変異について、置換が当たったことと、定義したテストだけが失敗したことを確かめる。
チェックが違反を検出できることをコメントの文章で記録すると、コードが変わったときに古くなる。そこでデータとして持ち、このランナーで機械的に測り直す。

PR では、差分に関係する定義だけを測る（`--changed-since origin/<base>`）。関係するのは次の 3 通りである。

- ランナーが変わったとき。すべての定義を測る。
- 定義ファイル自身が変わったとき。
- その定義の `test_file` か、変異の対象のファイルが変わったとき。

すべての定義を測ると、PR ごとには払えない時間がかかる。実測値は `.github/workflows/mutation-proof.yml` のコメントにある。
1 つの変異につき対象のテストファイルを 1 回実行するので、対象のテストは子プロセスを起動せず `main` を直接呼ぶ。CLI として起動するテストは、変異を検出できることを確かめる数本に絞る。
CI では、選んだ変異を matrix で 12 個のシャードに分けて並列に実行する（`--shard i/N`）。必須チェックの `Mutation proof (PR)` は、全シャードの成功を確かめる集約ジョブが持つ。
シャードには定義を単位に割り当て、基準 run（変異を入れずにテストを 1 回実行する分）を定義ごとに 1 つのシャードでだけ実行する（下の重い定義は、分けた一部ごとに実行する）。
1 つのシャードの目安を超える重い定義だけを、変異で分ける。所要時間は `scripts/mutation/mutation-durations.json`（定義ごとの、テストファイルを 1 回実行する秒数）で見積もる。
見積もりは割り当ての釣り合いにだけ使い、測る変異の集合は変えない。各シャードのログには、そのシャードの見積もり（`見積もり: 全体 … 秒、このシャード … 秒`）と、定義ごとの実測（`時間: X 秒（N 変異、基準 run を含む）`）が出る。
定義を足したときや、シャードの所要時間が偏ったときは、全件を検証した PR の CI の全シャードのログから、定義ごとに X の合計 ÷ (N + 1) の合計で更新する。
週次の全件の実行は 1 つのジョブで直列に測るので、並べて実行する CI のシャードとは 1 回の秒数が違う。見積もりの更新には使わない。
定義を足したら、見積もりも足す（`mutations-declaration.test.ts` が、どの定義にも見積もりがあることを確かめる）。最初は手元の実行の `時間:` から同じ式で書く。
文書を含む変更は、push の前に手元でも `--changed-since origin/main` を実行する。文書を読むテストを持つ定義も選ばれるので、文書の書き換えで落ちる定義を CI の前に見つけられる。
`--changed-since` は commit の差分（`origin/main...HEAD`）だけを見るので、commit した後に実行する。commit する前は「変更ファイル: 0 件」になり、何も測らない。
ランナーのテストのうち本物の vitest を使うのは e2e の 2 本だけで、残りはスタブで実行する（`MUTATION_PROOF_TEST_COMMAND`）。
ランナーのテストは `describe.concurrent` で並べて実行するので、テストの間でロック・復元情報・fixture を共有しない。

すべての定義は、週に 1 回の定期実行（`.github/workflows/mutation-proof.yml`）で測る。
対象もチェックも変わっていない定義は前回の結果が有効だが、共有ライブラリやツールの版が変わると前提が成り立たなくなることがあるので、測り直す。

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

Bash の実行前のチェック（PreToolUse）として、`scripts/hooks/bash-command-guard.sh` が次の 2 つの形を止める。どちらも、文章の規約では防げずに再発した形である。

- `gh api` と同じセグメントにある `--body-file`。`gh api` にこのフラグは無い。`gh pr` と `gh issue` の `--body-file` は通す。
- 文字クラスで自分を避けていない `pkill -f` と `killall -f`。照合するのがコマンドライン全体なので、自分のシェルにも一致する。

このチェックは、3 つのエージェントに設定してある（`.claude/settings.json`・`.codex/hooks.json`・`.github/hooks/kaizen-session.json`）。

応答を確定する前のチェック（Claude Code の Stop）として、`scripts/hooks/response-language-check.ts` が、最後の応答が日本語で書かれているかを確かめる。
コードブロック・インラインコード・引用・URL・ハーネスのタグの塊を除いた本文で、ラテン文字が 40 字以上あり、日本語の文字（ひらがな・カタカナ・漢字）の割合が 0.1 未満なら、exit 2 で書き直させる。
`stop_hook_active` が true のとき（既に書き直させた後）は通し、node が無い環境では警告だけを出して通す。設定は Claude Code だけで、Codex と Copilot には入れていない。

同じ Stop で、`scripts/hooks/response-word-check.ts` が、最後の応答に使わない語（`.textlint/words.json`）が含まれていないかを確かめる。
判定は textlint の `ai-words-ja/no-ai-words` の規則と、記号が続く形も拾うダッシュの規則（`local/no-dash-emphasis`）で行い、引用・ハーネスのタグの塊とコードは対象から外す。
見つかれば、辞書の言い換えを添えて exit 2 で書き直させ、止めたことを一時ディレクトリの印（session ごとのファイル）に残す。
`stop_hook_active` が true のときも、印が無ければ（別の Hook が書き直させた後なら）確かめる。印が在れば、この Hook が既に止めた後なので通す。
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

### JavaScript の拡張子

JavaScript の拡張子は、配布するかどうかで使い分ける。新しいファイルもこれに従う。

| 種類 | 拡張子 | 理由 |
| --- | --- | --- |
| 配布スキル（`skills/**`）の JavaScript | `.mjs` | インストール先の `package.json` の `type` に依らず、Node が常に ESM として読むため |
| リポジトリ内のツールとテスト（`scripts/**/*.ts`）、配布しない private skill のスクリプト | `.ts` | `pnpm run typecheck` で型を検査するため。Node（`mise.toml` の版）が型を消して直接実行するので、ビルドは要らない |
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
配布スキルは `.mjs` のままにする。利用者の Node で動くので、`.ts` にすると利用者に求める Node の版が上がる。

ツールが読む `.ts` の設定は次のとおりである。

- `vitest.config.ts`、`scripts/lib/vitest-global-setup.ts`
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
外したファイルの型ガードの外の呼び出しは、`check-skill-lint-directives.ts` が検出する。
import できない雛形（`skills/*/assets/*.template.ts`）とミューテーションテストのランナーは、同じ関数をファイルの中に持つ。
利用者のプロジェクトへ 1 ファイルだけコピーして使う配布スキルのツール（`trait-compare.mjs` など）も同じである。
コピーとの一致は `check-identical-copies.ts` が確かめる。
1 ファイルだけコピーして使うツールが単独で読み込めることは、`scripts/skills/_cross/vendored-tool-standalone.test.ts` が確かめる。

`isArray` 以外の helper（型ガード・CLI の起動の判定など）も、配布スキルの中で複数のファイルが使うものは、そのスキルの `scripts/lib/` に 1 つだけ置いて import する。
各ファイルに同じ helper を書くと、同じ名前で中身が食い違っても気付けない。中身が違うものは、意味ごとに名前を分ける（配列も通すものは `isObjectLike`）。
スキルをまたいでは共通化しない。同じ内容であるべきコピーは、`isArray` と同じく `check-identical-copies.ts` の組に登録する。
スキルの中の重複を検出するチェックは無いので、これは規約である（一致を確かめるのは、登録したコピーの組だけである）。

配布スキルの `.mjs` では、型の検査を外す JSDoc の書き方を `scripts/gates/code/check-jsdoc-types.ts` が失敗にする。
失敗にするのは、型の表明 `/** @type {X} */ (v)`（TypeScript の `as` と同じ）と、`@ts-ignore`・`@ts-expect-error`・`@ts-nocheck` である。
JSDoc の型の `any`・`*`・`?`・`Function` と、型引数の無い `Object` も失敗にする。
型引数を省くとデフォルトの `any` が入る型（`Generator`・`Iterable`・`IteratorResult`・`ReadableStream` など）は、`any` が入らない数まで型引数を書かせる。
対象の型と書く数は、`tsconfig.skills.json` から作った Program の型チェッカーで名前を解決し、宣言の型引数のデフォルトから求める。
名前では照合しないので、同じ名前の自作の型は対象にせず、修飾した名前（`globalThis.Generator`）も検出する。
型引数の無い `Array`・`Promise`・`Map` は、tsc が TS2314 で失敗にする。
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

`tests/**` は、リントと整形の対象に含める。`.agents/skills/**` と `.claude/**` は、インストール済みのコピーとエージェント用のシンボリックリンクなので、対象から外す。
型の検査は、エディタで開く雛形のコピーとリンクを対象にする（上の「型の検査」）。
ただし、`.agents/rules/`（rule の実体）と private skill（`.private-skill` を持つ `.agents/skills/<name>/`）は対象にする。rule へのリンクを置く `.github/instructions/` は対象から外す。
