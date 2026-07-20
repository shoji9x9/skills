# Skills

Claude Code / Codex / GitHub Copilot に対応したマルチエージェント向けスキル集。

## プロジェクト概要

このリポジトリは、複数の AI エージェントが共通のスキル・ルール・Hooks・ドキュメント構造を共有できるよう整備するための汎用スキルを提供する。  
スキルは `gh skill install` で任意のプロジェクトにインストールして使用する。

## 技術スタック

- **スキル管理**: GitHub CLI (`gh skill`、**v2.90.0+**)、Agent Skills 仕様
- **パッケージマネージャ**: pnpm（mise で管理）。正本は `package.json` の `packageManager` / `devEngines.packageManager` と `pnpm-lock.yaml`。**npm は使わない**（`package-lock.json` を作らない。誤った PM 利用は `devEngines` が警告する）
  - pnpm を bump するときは正本 4 箇所すべてを同期する: `mise upgrade pnpm --bump`
    → `mise lock`（全プラットフォーム URL を補完）→ `package.json` の `packageManager` と
    `devEngines.packageManager.version` を新版へ → `pnpm install --lockfile-only` で
    `pnpm-lock.yaml` を再生成。mise だけ更新して package.json / lock を取りこぼすと
    `devEngines` 警告・不整合になる
- **フォーマッタ／リンタ**: 下表の通り（**prettier は使わない**）
- **テスト**: skill-creator、Python 3.8+（集計スクリプト）
- **環境管理**: mise
- **ツール起動**: スクリプト・lefthook・CI からツールを起動する際は `./node_modules/.bin/<tool>` のハードパスで叩かず、`pnpm exec <tool>`（または mise の shim）経由で起動する

### リント／フォーマット

| 対象                                              | リント              | フォーマット        | 補助検査                                                                                  |
| ------------------------------------------------- | ------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Markdown (`*.md`)                                 | `markdownlint-cli2` | `markdownlint-cli2` | `scripts/lint-pagination.js` で shell コードブロック内の `gh api` ページネーションを検査 |
| JavaScript (`*.js`, `*.mjs`)                      | `oxlint`            | `oxfmt`             | なし                                                                                      |
| JSON (`*.json`)                                   | `jsonlint`          | `oxfmt`             | duplicate key も検査                                                                      |
| YAML (`*.yml`, `*.yaml`)                          | `js-yaml`           | `oxfmt`             | なし                                                                                      |
| Shell (`*.sh`)                                    | `shellcheck`        | `shfmt`             | `scripts/lint-pagination.js` で `gh api` ページネーションを検査                          |
| GitHub Actions (`.github/workflows/*.{yml,yaml}`) | `actionlint` + `ghalint` | `oxfmt` | `pinact` で SHA pinning を確認 |

表のうち `shellcheck`・`shfmt`・`actionlint`・`pinact`・`ghalint`・`gitleaks` は mise でインストールし（`mise.toml`）素のコマンド名で起動する。それ以外は pnpm devDependencies（`pnpm exec` で起動）。

- **GitHub Actions のポリシー検査**: `actionlint`（構文）に加え `ghalint`（`permissions`・`timeout-minutes`・`persist-credentials` 等のポリシー）で多層検査する。`ghalint` は全走査のため pre-commit に入れず CI（`GitHub Actions lint`）専任。
- **シークレット走査**: `gitleaks` で行う。pre-commit はステージ差分（`gitleaks git --staged`）、CI はリポジトリ全体・全履歴（`Secret scan` ジョブ・`fetch-depth: 0`）を走査する。

JavaScript の拡張子は配布有無で使い分ける（新規ファイルもこれに従う）。

- **配布物は `.mjs`**: 配布スキル一式（`skills/**`）に含まれる JavaScript。インストール先の `package.json` の `type` に依存せず Node が常に ESM として解釈するため。
- **非配布物は `.js`**: リポジトリ内ツール・設定・テスト（`scripts/**/*.js` / `vitest.config.js` / `commitlint.config.js` / `release.config.js`）と、配布しない private skill（`.private-skill`。`.agents/skills/<name>/` のみに存在）のスクリプト。
  `package.json` の `"type": "module"` 下で ESM として動くため拡張子で ESM を明示する必要がない。
- この規約は `scripts/check-js-extensions.js` が lefthook pre-commit と CI（`Lint` ジョブ）で検査する（`skills/**` 配下の `.js` と `scripts/**` 配下の `.mjs` を fail させる）。

`tests/**` はリント／フォーマット対象に含める。`.agents/**` と `.claude/**` はインストール済みコピー／エージェント用シンボリックリンクのため対象外にする。

## スキルファイル形式

`skills/*/SKILL.md` を編集する際は Agent Skills 仕様のフォーマットを維持すること:

```yaml
---
name: <skill-name> # 必須: 小文字英数字とハイフンのみ、最大64文字
description: <description> # 必須: スキルの説明とトリガー条件、最大1024文字
argument-hint: "<hint>" # 任意: スラッシュコマンド実行時に表示する引数ヒント
---
```

`argument-hint` は Agent Skills 標準仕様外の拡張フィールド（Claude Code / VS Code が表示に使用。Codex CLI・Copilot CLI は無視するがエラーにはならない）。
値が `[` で始まると YAML の flow sequence と誤解釈されるため引用符で囲む（単・二重どちらでも可）。

## ディレクトリ構造

```text
skills/<name>/          スキル実体（gh skill publish の対象）
  SKILL.md              スキルのメイン指示
  references/           進行的開示の補助ドキュメント（コンポーネント手順等。SKILL.md から参照）
  evals/
    evals.json          回帰テスト定義
    README.md           テスト実行手順
tests/<name>/           テスト結果（git 管理はサマリーのみ）
  iteration-N/
    benchmark.json      結果サマリー
.agents/skills/<name>/          実体（Codex が直接参照）
.claude/skills/<name>           → ../../.agents/skills/<name>（Claude Code 用シンボリックリンク）
```

## ワークフロー

スキルの作成・改善・評価には `skill-creator` スキルを使う。

- **検証は目的を果たす最低限のツール実行で行う**。目的より広い一括実行（例: `lefthook run pre-commit --all-files`）は auto-fix・`stage_fixed` による staging などの副作用を伴う。絞り込み方が不明なら範囲を広げる前に `--help` 等で調べる。広い実行をした場合は直後に `git status --short` で意図しない変更を確認して戻す。

スキルの追加・修正、リリース（CD）、修正後の再インストール、回帰テストの**詳細手順は [`docs/skill-development.md`](docs/skill-development.md) を参照**する。

## ブランチ運用

トランクベース（`main` 単一）の Issue 駆動・PR ベース運用とする。`issue-start` スキルがこのフローを標準化する。

- **ブランチ**: `main` から feature ブランチを切る（`develop` は持たない）
- **命名**: `feature/<issue番号>-<英語の短い説明>`（kebab-case）。日本語 Issue は短い英語に要約する
- **起点**: Issue 駆動。`gh issue develop <issue番号> --base main --checkout` で作成・checkout する
  - 作成前に同番号ブランチの重複を local / remote で確認する
- **マージ**: feature ブランチ → PR → `main`。PR には関連 Issue・変更概要・確認内容を含める
- **commit message**: conventional commits（`feat:` / `fix:` / `docs:` など）。commitlint と lefthook の commit-msg フックで検証される
  - body は 1 行 100 文字以内（`body-max-line-length`）。長い本文は `git commit -F <file>` で渡す
  - 使用する種別は `commit-types.js` を単一の真実として定義する（commitlint の `type-enum`・semantic-release の `releaseRules`・`.github/dependabot.yml` の `commit-message.prefix` が共有。`build` / `style` は使わない。依存更新は `chore`）
    - commitlint / semantic-release はコードで `commit-types.js` を import するが、dependabot.yml は手書きのため `scripts/commit-types-consistency.test.js` が型の整合を CI で検査する
- **禁止**: `main` への直接 push、commit の `--amend`、force push。無関係な変更を同一 commit に混ぜない
- **`main` の保護**: ルールセットで force push とブランチ削除をブロックし、PR と CI 必須チェック（`Supply chain` / `Lint` / `GitHub Actions lint` / `Secret scan`）の通過を要求する
  - CI は `pull_request` に加え `push: main`（マージ後の main）でも起動する。新設の `Secret scan` ジョブは GitHub のルールセットで必須チェックに追加する（リポジトリ設定側の手動作業）

## 脆弱性対応

Dependabot の pnpm 11 対応（dependabot/dependabot-core#14794）が完了するまでは、`devEngines.packageManager` により生成される
multi-document `pnpm-lock.yaml` を Dependabot が解析できず alerts が作られない。
その間の脆弱性確認・起票は private skill `pnpm-audit-alert-issue` で `pnpm audit --json` を一次情報として扱い、
Issue 作成は `dependabot-alert-issue` の外部 audit findings mode に委譲する。

## API 取得のページネーション

`gh api` 等で一覧を取得する shell / markdown コードは、**指定件数で暗黙に打ち切らない**こと。
ページングを処理して必要な範囲をすべて辿る（REST は `--paginate`、GraphQL は `pageInfo`/`endCursor` ＋ `--paginate`）。
件数が大きくなりうる場合は、全件をメモリに抱えず**ページ単位で逐次処理**し、十分なら早期終了の条件を明示する。
この規約は `scripts/lint-pagination.js` が lefthook pre-commit と CI（`Lint` ジョブ）で検査する（完全なシェルパーサではなくヒューリスティックな安全網）。判定ロジックは vitest で `scripts/lint-pagination.test.js` がカバーする。
意図的な単発取得は当該箇所に `# pagination-ok` を付けて明示する。

## エージェントの自己設定編集について

コーディングエージェントは自身の設定ファイルの編集が制限される場合がある（自己改変ガード）。設定ファイルを書き換える作業（kaizen の Hook セットアップ等）でブロックされたら、適用すべき内容を一時ファイルに書き出し、ユーザーに `! cp <tmp> <設定ファイル>` 等での適用を依頼する。

| エージェント   | 自己設定ファイル             | 編集可否                                                     |
| -------------- | ---------------------------- | ------------------------------------------------------------ |
| Claude Code    | `.claude/settings.json`      | 不可（ハードブロック。bypass でも確認が出る）                |
| Codex          | `.codex/config.toml` / hooks | 現状は可（ただし credentials/auth/profile 等の上書きは制限） |
| GitHub Copilot | `.github/agents/`（指示）    | 不可（ハードブロック）                                       |
| GitHub Copilot | `.github/hooks/`（フック）   | 可（手動承認ガードの設定を推奨）                             |

## 配布スキルの成果物は同梱する

配布対象スキル（`skills/<name>/`、`gh skill publish` の対象）が実行時に参照する成果物（テンプレート・設定ファイル・スクリプト等）は、必ずスキル内（`assets/` / `scripts/` / `references/`）に正本として同梱する。

配布されるのは `skills/<name>/` 配下のみで、リポジトリ直下や `.github/` に置いたファイルはインストール先プロジェクトに付いて行かず、参照先が無くなるため。

- インストール先リポジトリに同種のファイルが既にある場合はそれを優先・尊重し、無いときだけ同梱物を使う／（ユーザー確認の上）コピー導入する。既存ファイルは上書きしない
- スキル本体（`SKILL.md` 等）から参照するパスは、リポジトリ固有の場所ではなくスキル内の同梱物を起点にする

## 参照ルールガイド

- `.agents/rules/doc-altitude.md`: エージェント向けドキュメント（`AGENTS.md` / `SKILL.md` / `docs/`）の記載粒度（altitude）。行動に必須な情報だけを single source of truth で置き、重複・読み手のいない節を避ける
- `.agents/rules/github-actions-authoring.md`: GitHub Actions ワークフロー作成・変更時のレビュー観点（必要権限の突き合わせ・happy path 失敗時の fail-safe）。`.github/workflows/**` 編集時に適用
- `.agents/rules/skill-reinstall.md`: `skills/<name>/` 編集後は `scripts/reinstall-skill.sh <name>` でインストール済みコピーを再同期する。`skills/**` 編集時に適用

## 参照スキルガイド

- `multiagent-setup`: スキル・ルール・Hooks・ドキュメントをマルチエージェント対応構造でセットアップする
- `kaizen`: セッションから学びを抽出し根本原因を分析してスキル・ルール等に反映する
- `issue-create`: 短い説明から GitHub Issue を作成する。重複チェック・`.github/ISSUE_TEMPLATE/` 参照・ドラフト承認を経て起票する。着手は `issue-start` に引き継ぐ
- `issue-start`: GitHub Issue を起点に branch 作成・実装・commit・PR 作成までを標準化する
- `pr-review-handle`: PR のレビューコメント（全レビュアー対象）を確認・妥当性判断・必要時のみ修正・返信・解決（resolve）する。`--push` で commit・push まで行う
- `dependabot-merge`: Dependabot PR の CI 確認・影響レビュー・判断のコメント記録・マージを標準化する。PR 単体または `--all` で open な全 PR を処理。`>=1.0` の決定論的自動マージは `.github/workflows/dependabot-automerge.yml` が担い、本スキルは 0.x や自動マージ未設定リポジトリでの手動判断を受け持つ
- `dependabot-alert-issue`: Dependabot alerts を確認し、解消するための Issue を作成する。着手可否で分類し severity・パッケージ単位でグルーピング、着手できないものは着手可能条件を明記。設定で特定 alert の無視・dismiss も指定できる。起票後の着手は `issue-start` に引き継ぐ
- `pnpm-audit-alert-issue`: Dependabot の pnpm 11 対応（dependabot/dependabot-core#14794）完了までの private skill。`pnpm audit --json` を正規化し、`dependabot-alert-issue` の外部 audit findings mode で脆弱性対応 Issue を作る
- `pr-finalize-loop`: 作成済み PR の CI エラー解消とレビュー指摘対応を、CI 成功かつ未解決スレッドなしになるまで自律ループで反復する。CI 失敗の修正・レビュー返信/解決・commit/push・Copilot 再依頼を回し、`--max-iterations`（既定 5）・行き詰まり検知で停止。レビュー対応単体は `pr-review-handle` が担う
- `aws-architecture-diagram`: AWS 構成図を IaC（CDK/Terraform 等）や説明から spec に起こし SVG 生成する。作図ルール（交差最小・直交配線・軸整列）に従い、環境（prod/local 等）を単一ベース spec ＋ 変換で出し分け、PNG 化して目視確認しながら反復。初回は setup で対話導入、以降 update
- `box`: Box のファイル/フォルダを Box REST API（`curl` + `jq`）で参照・検索・更新する。フォルダ一覧・メタ取得・ダウンロード・検索・アップロード・新バージョン作成を、Dev Token または OAuth refresh のトークンで実行。MCP・SDK・追加ランタイム不要
- `replace-strategy`: 仕様を変えないアプリケーションリプレイスの入口。現行アプリを実測して戦略を決め、機能に分解して姉妹スキル（golden-dataset / parity-suite / parity-replace / parity-diff）へ振り分ける（自分では実装しない）。`setup` / `issues` / `status` の 3 モード。測定できなければ停止する
- `golden-dataset`: replace-strategy の姉妹スキル。現行と新側の比較を成立させる共通データセットを構築する。データそのものではなく冪等・決定論的な投入ツール（TypeScript / SQL）を作り、本番を参照せず一から作る。
  新側スキーマは後から出来るため 2 フェーズ（A: 現行テスト環境へ投入・検証、B: 新側スキーマへ写像・投入・現新一致検証）に分け、データセットのバージョンで parity-suite / parity-diff のベースライン陳腐化を検出させる。
  replace-strategy setup 完了が前提で、未完了なら停止する
- `parity-suite`: replace-strategy の姉妹スキル。現行アプリに対してパリティスイート（新旧どちらの実装にも当てられる実行可能な合否判定基準）を Playwright で構築し、故障注入（ネガティブコントロール）で強度を検証する。
  論理名のロケータマッピング・手書きの寛容な aria スナップショット・API の record/replay に加え、視覚ベースラインとノイズ基準値を採取して parity-diff へ引き渡す。1 回の実行で 1 機能（横断 API リソース・バッチも可）。
  replace-strategy setup / golden-dataset（フェーズ A）完了が前提で、未完了・Playwright 不可なら停止する
- `parity-replace`: replace-strategy の姉妹スキル。parity-suite が定義した論理名に対して新側を実装する意図的に薄い層。担うのは 3 つ——機能をページ単位のフェーズに分割・新側ロケータマッピングの例外充填・実装役と分離した敵対的レビュー（未コミット差分）。
  ブランチ作成・commit・push・PR は issue-start へ委譲する。現行コードを一次情報源に読み、推測せず確信度を常に申告し、スイートが新に対して green ＋ 静的解析が通れば完了（parity-diff の差分ゼロは含めず、往復ループの終了条件）。1 回の実行で 1 機能。
  replace-strategy setup / golden-dataset（フェーズ A）/ 対象 slug の parity-suite 完了が前提で、未完了なら停止する
