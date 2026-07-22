# Skills

Claude Code / Codex / GitHub Copilot に対応したマルチエージェント向けスキル集。

## プロジェクト概要

このリポジトリは、複数の AI エージェントが共通のスキル・ルール・Hooks・ドキュメント構造を共有できるよう整備するための汎用スキルを提供する。  
スキルは `gh skill install` で任意のプロジェクトにインストールして使用する。

## 技術スタック

- **スキル管理**: GitHub CLI (`gh skill`、**v2.90.0+**)、Agent Skills 仕様
- **パッケージマネージャ**: pnpm（mise で管理）。正本は `package.json` の `packageManager` / `devEngines.packageManager` と `pnpm-lock.yaml`。**npm は使わない**（`package-lock.json` を作らない。誤った PM 利用は `devEngines` が警告する）
  - bump 手順（正本 4 箇所の同期）・broken 版回避は [`docs/package-manager.md`](docs/package-manager.md) を参照
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
- **Markdown の行長（MD013）**: `markdownlint-cli2` の MD013 は非 strict 運用（`line_length: 200`、`code_blocks` / `tables` / `headings` は除外）。
  200 桁超でも**半角スペース（改行可能点）が 200 桁を超えた位置に残る行だけ**を弾く。
  純 CJK の長行は分かち書きしないため通るが、英数字・ツール名など半角スペースを含む語を長行に足すと fail する。
  日本語長行に英数を追記したら、200 桁以内に収めるか、200 桁超に半角スペースを残さないよう折り返す。

JavaScript の拡張子は配布有無で使い分ける（新規ファイルもこれに従う）。

- **配布物は `.mjs`**: 配布スキル一式（`skills/**`）に含まれる JavaScript。インストール先の `package.json` の `type` に依存せず Node が常に ESM として解釈するため。
- **非配布物は `.js`**: リポジトリ内ツール・設定・テスト（`scripts/**/*.js` / `vitest.config.js` / `commitlint.config.js` / `release.config.js`）と、配布しない private skill（`.private-skill`。`.agents/skills/<name>/` のみに存在）のスクリプト。
  `package.json` の `"type": "module"` 下で ESM として動くため拡張子で ESM を明示する必要がない。
- この規約は `scripts/check-js-extensions.js` が lefthook pre-commit と CI（`Lint` ジョブ）で検査する（`skills/**` 配下の `.js` と `scripts/**` 配下の `.mjs` を fail させる）。

`tests/**` はリント／フォーマット対象に含める。`.agents/**` と `.claude/**` はインストール済みコピー／エージェント用シンボリックリンクのため対象外にする。

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
- **現状は verify してから言い切る**。ファイル・パス・成果物・ツール挙動・実行環境の現状は、述べる前に Read / grep / 実行で確かめる。記憶や一般論で断定しない（自明に見える一行ほど verify を省きやすい）。
- **パイプ越しの成否判定に末尾 `$?` を使わない**。パイプで出力を整形する検証の成否は、`${PIPESTATUS[0]}` か `set -o pipefail` で対象コマンド自身の終了コードを取る（末尾 `$?` はパイプ最後のコマンドの終了コード）。
- **ファイル移動＋索引再生成系の `set -e` スクリプトは冪等にする**。既に目的状態にある入力（同一ディレクトリへの `mv` 等）を明示スキップし、no-op で `set -e` が末尾のクリーンアップ／索引再生成に到達しない事態を防ぐ。到達性が重要なら `trap '...' EXIT` を検討する。
- **「常に壊れる／失敗する」系のレビュー指摘は、適用前に使い捨て環境で再現テストして裏取りする**。

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

Dependabot の pnpm 11 未対応期間の脆弱性確認・起票フロー（`pnpm-audit-alert-issue` / `dependabot-alert-issue` の連携）と、
major 更新に自動シグナルが出ない前提での手動確認方針は [`docs/vulnerability-handling.md`](docs/vulnerability-handling.md) を参照する。

## エージェントの自己設定編集について

コーディングエージェントは自身の設定ファイルの編集が制限される場合がある（自己改変ガード）。設定ファイルを書き換える作業（kaizen の Hook セットアップ等）でブロックされたら、適用すべき内容を一時ファイルに書き出し、ユーザーに `! cp <tmp> <設定ファイル>` 等での適用を依頼する。

| エージェント   | 自己設定ファイル             | 編集可否                                                     |
| -------------- | ---------------------------- | ------------------------------------------------------------ |
| Claude Code    | `.claude/settings.json`      | 不可（ハードブロック。bypass でも確認が出る）                |
| Codex          | `.codex/config.toml` / hooks | 現状は可（ただし credentials/auth/profile 等の上書きは制限） |
| GitHub Copilot | `.github/agents/`（指示）    | 不可（ハードブロック）                                       |
| GitHub Copilot | `.github/hooks/`（フック）   | 可（手動承認ガードの設定を推奨）                             |

## コンポーネント選択基準

知識・規約・処理を追加、またはドキュメントを整理・分割するときは、まず skill / rule / hook / ドキュメントのどれに落とすかを判断する。

- **skill**: 人／エージェントが実行する一連の手順・ワークフロー
- **rule**: 特定のファイル群を触るときだけ関係する規約（`.agents/rules/`。paths を最小スコープで切って自動適用。ファイル種別だけで広く指定〈`**/*.ts` 等〉せず対象ディレクトリまで絞る）
- **hook**: 特定イベントで自動実行する決定論的な処理（ゲート・整形・検査）
- **ドキュメント**: 上記に当たらない知識・方針・仕様。作業対象に依らず常に必要なものは基底ドキュメント（本 `AGENTS.md`）へ集約し、スキル実行時のみ要る詳細は各 `SKILL.md` / `references/` へ置く

詳細な判断基準は `multiagent-setup` スキルの `references/component-selection.md` を参照する。

## 参照ルールガイド

- `.agents/rules/doc-altitude.md`: エージェント向けドキュメント（`AGENTS.md` / `SKILL.md` / `docs/`）の記載粒度（altitude）。行動に必須な情報だけを single source of truth で置き、重複・読み手のいない節を避ける
- `.agents/rules/github-actions-authoring.md`: GitHub Actions ワークフロー作成・変更時のレビュー観点（必要権限の突き合わせ・happy path 失敗時の fail-safe）。`.github/workflows/**` 編集時に適用
- `.agents/rules/skill-reinstall.md`: `skills/<name>/` 編集後は `scripts/reinstall-skill.sh <name>` でインストール済みコピーを再同期する。`skills/**` 編集時に適用
- `.agents/rules/external-tool-format-verification.md`: 外部ツール（Codex / Copilot / `gh` / GitHub API 等）の設定・Hook・API 形状は公式一次ドキュメントで構造とフィールド意味論を検証してから記述し、検証 URL を併記する。`skills/**` 編集時に適用
- `.agents/rules/curl-data-urlencode.md`: 配布スキルの curl 例・スクリプトでは変数値を URL クエリ / フォームに直挿しせず `--data-urlencode`（GET は `-G` 併用）でエンコードする。`skills/**` 編集時に適用
- `.agents/rules/distributed-skill-base-doc-generalization.md`: 配布スキルは基底ドキュメントを `AGENTS.md` に決め打ちせず `CLAUDE.md` / `.github/copilot-instructions.md` のみの下流でも成立させる。`skills/**` 編集時に適用
- `.agents/rules/distributed-skill-bundle-artifacts.md`: 配布スキルが実行時に参照する成果物（テンプレート・スクリプト等）はスキル内（`assets/` / `scripts/` / `references/`）に正本を同梱する。`skills/**` 編集時に適用
- `.agents/rules/api-pagination.md`: `gh api` 等の一覧取得は指定件数で暗黙に打ち切らずページネーションを処理する（`scripts/lint-pagination.js` が検査。単発は `# pagination-ok`）。`skills/**` 編集時に適用
- `.agents/rules/skill-file-format.md`: `SKILL.md` の frontmatter は Agent Skills 仕様（`name` / `description` 最大 1024 バイト / 任意 `argument-hint`）を維持する。`skills/*/SKILL.md` 編集時に適用

## 参照スキルガイド

- `multiagent-setup`: スキル・ルール・Hooks・ドキュメントをマルチエージェント対応構造でセットアップする
- `kaizen`: セッションから学びを抽出し根本原因を分析してスキル・ルール等に反映する
- `issue-create`: 短い説明から GitHub Issue を作成する。重複チェック・`.github/ISSUE_TEMPLATE/` 参照・ドラフト承認を経て起票する。着手は `issue-start` に引き継ぐ
- `issue-start`: GitHub Issue を起点に branch 作成・実装・commit・PR 作成までを標準化する
- `pr-review-handle`: PR のレビューコメント（全レビュアー対象）を確認・妥当性判断・必要時のみ修正・返信・解決（resolve）する。`--push` で commit・push まで行う。対応後の再レビュー依頼先は `skills.common.review_tool`（Copilot/Claude Code/Codex/none、既定 copilot）で選択する
- `dependabot-merge`: Dependabot PR の CI 確認・影響レビュー・判断のコメント記録・マージを標準化する。PR 単体または `--all` で open な全 PR を処理。`>=1.0` の決定論的自動マージは `.github/workflows/dependabot-automerge.yml` が担い、本スキルは 0.x や自動マージ未設定リポジトリでの手動判断を受け持つ
- `dependabot-alert-issue`: Dependabot alerts を確認し、解消するための Issue を作成する。着手可否で分類し severity・パッケージ単位でグルーピング、着手できないものは着手可能条件を明記。設定で特定 alert の無視・dismiss も指定できる。起票後の着手は `issue-start` に引き継ぐ
- `pnpm-audit-alert-issue`: Dependabot の pnpm 11 対応（dependabot/dependabot-core#14794）完了までの private skill。`pnpm audit --json` を正規化し、`dependabot-alert-issue` の外部 audit findings mode で脆弱性対応 Issue を作る
- `pr-finalize-loop`: 作成済み PR の CI エラー解消とレビュー対応を CI 成功＋未解決なしまで自律ループ（修正・返信/解決・commit/push・再レビュー依頼）。依頼先 `skills.common.review_tool`（既定 copilot）、`--max-iterations` 既定 5。単体対応は `pr-review-handle`
- `aws-architecture-diagram`: AWS 構成図を IaC（CDK/Terraform 等）や説明から spec に起こし SVG 生成する。作図ルール（交差最小・直交配線・軸整列）に従い、環境（prod/local 等）を単一ベース spec ＋ 変換で出し分け、PNG 化して目視確認しながら反復。初回は setup で対話導入、以降 update
- `box`: Box のファイル/フォルダを Box REST API（`curl` + `jq`）で参照・検索・更新する。フォルダ一覧・メタ取得・ダウンロード・検索・アップロード・新バージョン作成を、Dev Token または OAuth refresh のトークンで実行。MCP・SDK・追加ランタイム不要
- `replace-strategy`: 仕様を変えないアプリケーションリプレイスの入口。現行アプリを実測して戦略を決め、機能に分解して姉妹スキル（golden-dataset / parity-suite / parity-replace / parity-diff）へ振り分ける（自分では実装しない）。`setup` / `issues` / `status` の 3 モード。測定できなければ停止する
- `golden-dataset`: replace-strategy 姉妹。現新比較用の共通データセットを冪等・決定論的な投入ツール（TypeScript / SQL）で構築（本番非参照）。2 フェーズ（A: 現行テスト環境へ投入検証、B: 新側スキーマへ写像・現新一致検証）、バージョンで陳腐化検出。setup 完了が前提
- `parity-suite`: replace-strategy 姉妹。新旧両実装に当てられる合否判定基準を Playwright で構築し故障注入で強度検証。論理名マッピング・寛容な aria スナップショット・API record/replay・視覚ベースライン/ノイズ基準を採取し parity-diff へ渡す。1 回で 1 機能。setup / golden-dataset(A) 前提
- `parity-replace`: replace-strategy 姉妹。parity-suite の論理名に新側を実装する薄い層（ページ単位分割・マッピング例外充填・敵対的レビュー）。branch/commit/PR は issue-start へ委譲、suite が新で green＋静的解析通過で完了。前提: setup・golden-dataset(A)・対象 slug の parity-suite
- `parity-diff`: replace-strategy 姉妹。現新差分を画素・特性照合・aria の 3 経路の差分器（強度検証済み）で検出し LLM は分類のみ。要対応は parity-replace へ差し戻し、収束は未説明差分ゼロ＋未修正回帰ゼロ。前提: setup・golden-dataset・parity-suite・parity-replace の新側 green
