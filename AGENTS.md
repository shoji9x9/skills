# Skills

Claude Code・Codex・GitHub Copilot に対応した、マルチエージェント向けのスキル集。

## プロジェクト概要

複数の AI エージェントが、スキル・ルール・Hooks・ドキュメントの構成を共有できるようにするための汎用スキルを提供する。
スキルは `gh skill install` で任意のプロジェクトにインストールして使う。

## 技術スタック

- スキルは GitHub CLI（`gh skill`、v2.90.0 以上）と Agent Skills 仕様で管理する。
- パッケージマネージャは pnpm で、版は mise で管理する。npm は使わず、`package-lock.json` を作らない。版を変える手順は [`docs/package-manager.md`](docs/package-manager.md) にある。
- ツールは `pnpm exec <tool>` か mise の shim で起動する。`./node_modules/.bin/<tool>` を直接指定しない。
- mise の shim はリポジトリの外のディレクトリでは解決できない。リポジトリの外で動かすときは、使うツールをすべて（`node_modules/.bin` の bin が通る `node` を含む）
  リポジトリの中で `mise which <tool>` によって実体のパスに解決してから使う。新しいパスの worktree は trust を引き継がないので、依存を入れる前に `mise trust` を実行する。
- `oxfmt` には Markdown を渡さない。Markdown の整形は `markdownlint-cli2 --fix` で行う。prettier は使わない。
- 整形ツール（`oxfmt`・`markdownlint-cli2 --fix`）にはディレクトリを渡さず、ファイルを並べて渡す。渡された範囲の目的外の種類のファイルまで書き換わる。

| 対象 | リント | 整形 |
| --- | --- | --- |
| Markdown | `markdownlint-cli2`、文章は textlint（`scripts/gates/lint-prose.js`） | `markdownlint-cli2` |
| JavaScript・TypeScript | `oxlint`、型は `tsc`（`pnpm run typecheck`） | `oxfmt` |
| JSON | `jsonlint` | `oxfmt` |
| YAML | `js-yaml`（`scripts/gates/lint-yaml.js`） | `oxfmt` |
| シェル | `shellcheck` | `shfmt` |
| GitHub Actions | `actionlint` と `ghalint`、SHA の固定は `pinact` | `oxfmt` |

JavaScript の拡張子は、配布する `skills/**` では `.mjs`、配布しない `scripts/**` と private skill では `.js` にする。
ツールが読む設定ファイル（`vitest.config.ts` など）は `.ts` にする。`scripts/gates/check-js-extensions.js` がこれをチェックする。

pre-commit と CI で実行するチェックの一覧、ミューテーションテスト、Markdown の行長などの詳細は [`docs/tooling.md`](docs/tooling.md) にある。

## ディレクトリ構造

```text
skills/<name>/          スキルの実体（gh skill publish の対象）
  SKILL.md              スキルのメインの指示
  references/           SKILL.md から必要なときに読む補助ドキュメント
  checks.json           利用者の pre-commit・CI に組み込むべきチェックの宣言（scripts/ に *-check.* を持つスキルだけ）
evals/<name>/           回帰テスト（配布しないので skills/<name>/ の外に置く）
  evals.json            回帰テストの定義
  README.md             テストの実行手順
  fixtures/             eval の初期状態
tests/<name>/           テスト結果（git にはサマリーだけを入れる）
  iteration-N/
    benchmark.json      結果のサマリー
types/                  型の検査だけで使う宣言（配布スキルの雛形と eval の fixture が import する、このリポジトリに無いモジュール）
.agents/skills/<name>/  インストール済みのスキル（Codex が直接読む）
.claude/skills/<name>   → ../../.agents/skills/<name>（Claude Code 用のシンボリックリンク）
scripts/                リポジトリ内のツールとテスト（配布しない）。直下にファイルを置かない
  gates/                横断チェック（check-* / lint-*）と、それが読む定義データ
  mutation/             ミューテーションテストのランナー
  eval/                 eval の実行・隔離・集計と、evals/ の fixture の生成・チェック
  hooks/                エージェントの Hook から起動するスクリプト
  tools/                手で起動する補助スクリプト（reinstall-skill.sh など）
  lib/                  テストとツールの共有ライブラリ、vitest の globalSetup
  skills/<name>/        配布スキル skills/<name>/ のスクリプトのテストと fixture
  skills/_cross/        複数のスキルにまたがる取り決めのテスト
```

`scripts/` のテスト（`*.test.js`）とミューテーションテストの定義ファイル（`*.mutations.json`）は、テスト対象の隣に置く。
`scripts/` のツールのテストはそのツールと同じディレクトリに置く。
配布スキルのスクリプトのテストは `scripts/skills/<name>/` に置き、複数のスキルにまたがるものは `scripts/skills/_cross/` に置く。

## ワークフロー

スキルの作成・改善・評価には `skill-creator` スキルを使う。
スキルの追加・修正・リリース・再インストール・回帰テストの手順は [`docs/skill-development.md`](docs/skill-development.md) にある。

人が読む文章（Markdown・コードコメント・利用者に表示するメッセージ・人への応答）は [`docs/writing-style.md`](docs/writing-style.md) に従って書く。
使わない語とその言い換えは、次の一覧に従う（Claude Code はセッション開始時に読み込む。他のエージェントはこのファイルを開いて従う）。

@.textlint/word-list.md

作業では次の原則を守る。各原則の理由と実例は次のファイルにある（Claude Code はセッション開始時に読み込む。他のエージェントは作業の前に開いて読む）。

@docs/agent-workflow.md

### 確かめ方

- ファイル・パス・ツールの挙動・実行環境の現状は、述べる前に読むか、検索するか、実行して確かめる。
- 規約を満たすかは、その規約をチェックするツールをそのまま実行して確かめる。自分で書いた近似のスクリプトで数えない。
- 検証は目的を果たす最小の範囲で実行する。広い範囲で一括実行したら、直後に `git status --short` で意図しない変更がないかを確かめる。
- 「該当なし」を根拠にするチェックは、わざと違反を置いて検出されることを先に確かめる。違反は除外の対象の外に置く。
- 0 件の結果、時間切れ、0 以外の終了コードを、合格として扱わない。
- 回帰だという指摘は、旧版と現行版を同じ条件で実行して確かめる。差が出なければ回帰ではない。
- 新しく作った分岐や、新しく受け付ける入力は、その状態を実際に作って確かめる。
- 等しいかを比べる処理を正規化で直すときは、ずれうる軸をすべて挙げ、両辺に同じ正規化を当てる。
- 規約に語彙・記録項目・判定軸を足すときや、規約を特定のツールや方向について書くときは、元の事例の表面ではなく機序から作る。
  対称な反対側（読み取りと書き込み、受け取る側と書く側、成功と失敗、同じ危険を持つ対のツール）を 1 件ずつ当ててから確定する。
- 階層で合わさる設定（mise・git・npm など）に依存する検証は、先に有効な設定の出所を一覧にする。
- ツールが欠けた環境でのチェックは、意図した分岐に達した証拠（stderr など）まで確かめる。同梱物を相対パスで読むものは、ディレクトリ一式で検証する。

### シェルの書き方

- パイプでつないだ検証の成否は、`${PIPESTATUS[0]}` か `set -o pipefail` で取る。判定に使わない終了コードは表示しない。
- バッククォートや `$` を含む本文は、quoted heredoc（`<<'PY'`）でインタプリタに渡す。
- 終了コードを決める最後の位置に条件式を置かない。`if` で書くか、`true` で終える。
- 結果として期待される 0 以外の終了コード（grep の該当なしなど）は、値を保存して分岐し、呼び出し全体の終了コードにしない。
- バックグラウンドで起動するコマンドは、失敗が終了コードに残る形で書き、stdin を `</dev/null` にする。
- 止まって見える子プロセスは、stderr の最終行と出力サイズを見て、何を待っているかを確かめてから扱う。
- バックグラウンドの処理が動いているかは、出力ファイルではなくプロセスの有無で判断する。
- 外部プロセスを動かすツールを書く前に、本番と同じ呼び出しで小さく試す。タイムアウトは呼び出しごとに設定する。
- ファイルを移動して索引を作り直す `set -e` のスクリプトは、何度実行しても同じ結果になるように書く。
- ID・完全な SHA・長い prompt・スクリプト名は、表示された結果から手で書き写さない。構造化された出力から同じ呼び出しの中で取得し、形式を確かめて渡す。
- 制限付きの sandbox で子プロセスの起動が `EPERM` になったら、待たずに承認付きの sandbox 外の実行に切り替える。

### 外向きの操作と破壊的な操作

- 本文を伴う外向きの操作は、本文を先にファイルへ書いて渡す。`gh pr` と `gh issue` は `--body-file` を、`gh api` は `-F body=@<path>` か `--input` を使う。
- 順序のある外向きの操作は `&&` でつなぐ。取り消せない操作の引数は、別のコマンドで先に取得し、空でないことを確かめてから渡す。
- 破壊的な操作は、対象を許可リストで決め、破壊のフラグを付けずに対象と件数を確かめてから実行する。
- プロセスは、起動時に保存した PID で終了させる。`pkill -f` は自分のシェルにも一致するので使わない。

### 編集

- 文字列の一致で編集するときは、置換元を直前に読んだ内容からそのまま使う。フォーマッタを通した後は読み直す。
- 複数の置換をまとめたスクリプトは、置換ごとにファイルへ書き戻し、`assert` にどの置換かを書く。
- 「すべて」のように網羅を求める指示を受けたら、どう解釈するかを 1 行で述べてから始める。

## ブランチ運用

`main` だけを持つトランクベースで、Issue を起点にして PR で取り込む。`issue-start` スキルがこの流れを標準化する。

- `main` から feature ブランチを作る。`develop` は持たない。
- ブランチ名は `feature/<issue番号>-<英語の短い説明>`（kebab-case）にする。Issue が日本語なら、説明は短い英語に要約する。
- ブランチは `gh issue develop <issue番号> --name "feature/<issue番号>-<英語の短い説明>" --base main --checkout` で作る。
  作る前に、同じ番号のブランチが local と remote に無いかを確かめる。
- feature ブランチは PR で `main` に取り込む。PR には関連 Issue、変更の概要、確認した内容を書く。
- `main` への直接の push、commit の `--amend`、force push はしない。無関係な変更を同じ commit に入れない。
- `main` はルールセットで保護し、force push とブランチの削除を禁じている。
- `main` への取り込みには、PR と CI の必須チェックの成功が必要である。
  必須チェックは `Supply chain`・`Lint`・`Unit tests`・`Mutation proof (PR)`・`GitHub Actions lint`・`Secret scan` である。
- CI は `pull_request` と、マージ後の `push: main` で実行する。

### commit message

- conventional commits（`feat:`・`fix:`・`docs:` など）で書く。commitlint と lefthook の commit-msg フックがチェックする。
- 種別は `commit-types.ts` で定義し、commitlint・semantic-release・`.github/dependabot.yml` が同じ種別を使う。
  `build` と `style` は使わず、依存の更新は `chore` にする。dependabot.yml との一致は `scripts/gates/commit-types-consistency.test.js` が CI で確かめる。
- 本文は 1 行 100 文字以内にする。長い本文は `git commit -F <file>` で渡す。
- `git commit` を含む呼び出しに、`git add` や message ファイルの作成を入れない。
  PreToolUse のチェック（kaizen など）は呼び出し全体を止めるので、準備も実行されず、後で `could not read log file` で失敗する。
- PreToolUse のチェックは文字列で判定するので、`git commit` を実行しない呼び出しでも、その文字列を含むだけで止まる。
  テストや置換の文字列では語を分けて組み立てる（python なら `"com" + "mit"`）か、ファイル編集ツールを使う。
- 実行中のセッション自身をチェックする仕組みの範囲を広げるときは、自分の呼び出しが新たに何に当たるかを先に 1 行で述べる。

## 脆弱性対応

Dependabot が pnpm 11 に対応するまでの脆弱性の確認と起票、major 更新の手動確認の方針は [`docs/vulnerability-handling.md`](docs/vulnerability-handling.md) にある。

## エージェントの自己設定編集

エージェントは自分の設定ファイルを編集できないことがある。
止められたら、適用する内容を一時ファイルに書き出し、ユーザーに `! cp <tmp> <設定ファイル>` などで適用してもらう。
権限やチェックを緩める設定の変更は、止められるかどうかに関わらず人に確認する。
エージェントごとの編集の可否は [`docs/agent-workflow.md`](docs/agent-workflow.md) にある。

## コンポーネント選択基準

知識・規約・処理を追加するときや文書を整理するときは、skill・rule・hook・ドキュメントのどれにするかを先に決める。
新しい仕組みを設計する前に、同じ問題の公開済みの解（上流の対応・既存のスキル・Issue）を調べる。見つからなかった場合も、その結果を提案に添える。

| 種類 | 置くもの |
| --- | --- |
| skill | 人やエージェントが実行する一連の手順 |
| rule | 特定のファイル群を触るときだけ関係する規約（`.agents/rules/`。paths は対象のディレクトリまで絞る） |
| hook | 特定のイベントで自動実行する決定論的な処理（チェック・整形） |
| ドキュメント | 上のどれにも当たらない知識・方針・仕様。常に必要なものは `AGENTS.md`、スキルの実行時だけ要るものは `SKILL.md` や `references/` |

判断の詳細は `multiagent-setup` スキルの `references/component-selection.md` にある。

## 参照ルールガイド

rule は、対象のファイルを触るときに自動で読み込まれる。

- `.agents/rules/doc-altitude.md`: 文書に載せる粒度と、文書の階層（Tier）
- `.agents/rules/github-actions-authoring.md`: GitHub Actions のワークフローを書くときのレビューの観点
- `.agents/rules/skill-reinstall.md`: `skills/<name>/` を直した後のインストール済みのコピーの再同期
- `.agents/rules/external-tool-format-verification.md`: 外部ツールの設定・Hook・API の形を、公式のドキュメントで確かめてから書く
- `.agents/rules/curl-data-urlencode.md`: 配布スキルの curl で、変数の値を `--data-urlencode` でエンコードする
- `.agents/rules/distributed-skill-base-doc-generalization.md`: 配布スキルで、基底ドキュメントを `AGENTS.md` に決め打ちしない
- `.agents/rules/distributed-skill-bundle-artifacts.md`: 配布スキルが実行時に使う成果物を、スキルの中に同梱する
- `.agents/rules/api-pagination.md`: `gh api` などの一覧の取得で、ページネーションを処理する
- `.agents/rules/skill-file-format.md`: `SKILL.md` の frontmatter を Agent Skills 仕様に合わせる
- `.agents/rules/eval-assertion-discrimination.md`: 回帰 eval の assertion と fixture を書いたときに確かめること
- `.agents/rules/eval-run-scope.md`: eval を実行する前に、目的と範囲を述べる
- `.agents/rules/state-space-and-mutation-proof.md`: チェックを書く前に入力の状態を列挙し、ミューテーションテストで効果を確かめる
- `.agents/rules/skill-consistency-pass.md`: 配布スキルを変えたときに、push 前に整合を確認する

## 参照スキルガイド

各スキルの用途だけを書く。モード・前提・手順は各スキルの `SKILL.md` にある（ここへ書き写さない）。

- `multiagent-setup`: スキル・ルール・Hooks・ドキュメントを、マルチエージェントに対応した構成でセットアップする
- `kaizen`: セッションから学びを抽出し、根本原因を分析して、スキルやルールなどに反映する
- `git-worktree`: git worktree で作業を隔離する（セッションの移動・ファイルの持ち込み・チェックからの除外・後片付け）。branch の作成と Issue との紐付けは呼び出し側が行う
- `issue-create`: 短い説明から、重複の確認と下書きの承認を経て GitHub Issue を作る
- `issue-start`: GitHub Issue を起点に、branch の作成から実装・commit・PR の作成・受け入れ条件の確認までを標準化する
- `issue-batch`: 複数の Issue を、隔離した worktree と独立した PR で順に処理し、merge・Issue の close・deployment・後片付けまで追う
- `pr-review-handle`: PR のレビューコメントを確認し、妥当性を判断して、必要なときだけ修正し、返信して解決する
- `pr-finalize-loop`: 作成済みの PR の CI エラーとレビューの指摘を、CI が成功して未解決が無くなるまで自律的に解消する
- `dependabot-merge`: Dependabot の PR の CI の確認・影響のレビュー・判断の記録・マージを標準化する
- `dependabot-alert-issue`: Dependabot alerts（または外部の audit の結果）から、解消用の Issue を作る
- `pnpm-audit-alert-issue`: private skill。Dependabot が pnpm-lock.yaml の依存グラフを読めない間（dependabot/dependabot-core#15904）、`pnpm audit --json` から `dependabot-alert-issue` を通して Issue を作る
- `browser-test`: 変更による回帰を、実際のブラウザ（chrome-devtools MCP）で確認する
- `aws-architecture-diagram`: IaC や説明から AWS の構成図を spec に起こし、SVG として生成・更新する
- `box`: Box のファイルとフォルダを、Box REST API（`curl` と `jq`）で参照・検索・更新する
- `replace-strategy`: 仕様を変えないアプリケーションのリプレイスの起点。現行アプリを測って戦略を決め、機能を姉妹スキルに振り分ける
- `current-environment-bootstrap`: replace-strategy の姉妹スキル。受け取った資産だけを基に、現行のテスト環境を作り直す
- `golden-dataset`: replace-strategy の姉妹スキル。新旧の比較に使う共通のデータセットを投入する、冪等で決定論的なツールを作る
- `parity-component`: replace-strategy の姉妹スキル。共通の UI 部品の見た目の基準を現行から採り、実装してカタログで照合する
- `parity-suite`: replace-strategy の姉妹スキル。新旧どちらの実装にも当てられる合否の基準を Playwright で作り、故障を注入して強度を確かめる
- `parity-replace`: replace-strategy の姉妹スキル。parity-suite の論理名に対して新しい実装を作る
- `parity-diff`: replace-strategy の姉妹スキル。新旧の差分を決定論的なツールで検出し、LLM は分類だけを行う
