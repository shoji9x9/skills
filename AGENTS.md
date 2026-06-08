# Skills

Claude Code / Codex / GitHub Copilot に対応したマルチエージェント向けスキル集。

## プロジェクト概要

このリポジトリは、複数の AI エージェントが共通のスキル・ルール・Hooks・ドキュメント構造を共有できるよう整備するための汎用スキルを提供する。  
スキルは `gh skill install` で任意のプロジェクトにインストールして使用する。

## 技術スタック

- **スキル管理**: GitHub CLI (`gh skill`)、Agent Skills 仕様
- **テスト**: skill-creator、Python 3.8+（集計スクリプト）
- **環境管理**: mise

## スキルファイル形式

`skills/*/SKILL.md` を編集する際は Agent Skills 仕様のフォーマットを維持すること:

```yaml
---
name: <skill-name>          # 必須: 小文字英数字とハイフンのみ、最大64文字
description: <description>  # 必須: スキルの説明とトリガー条件、最大1024文字
---
```

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
    - commitlint / semantic-release はコードで `commit-types.js` を import するが、dependabot.yml は手書きのため `scripts/commit-types-consistency.test.mjs` が型の整合を CI で検査する
- **禁止**: `main` への直接 push、commit の `--amend`、force push。無関係な変更を同一 commit に混ぜない
- **`main` の保護**: ルールセットで force push とブランチ削除をブロックし、PR と CI 必須チェック（`Supply chain` / `Lint` / `GitHub Actions lint`）の通過を要求する

## API 取得のページネーション

`gh api` 等で一覧を取得する shell / markdown コードは、**指定件数で暗黙に打ち切らない**こと。
ページングを処理して必要な範囲をすべて辿る（REST は `--paginate`、GraphQL は `pageInfo`/`endCursor` ＋ `--paginate`）。
件数が大きくなりうる場合は、全件をメモリに抱えず**ページ単位で逐次処理**し、十分なら早期終了の条件を明示する。
この規約は `scripts/lint-pagination.mjs` が lefthook pre-commit と CI（`Lint` ジョブ）で検査する（完全なシェルパーサではなくヒューリスティックな安全網）。判定ロジックは vitest で `scripts/lint-pagination.test.mjs` がカバーする。
意図的な単発取得は当該箇所に `# pagination-ok` を付けて明示する。

## エージェントの自己設定編集について

コーディングエージェントは自身の設定ファイルの編集が制限される場合がある（自己改変ガード）。設定ファイルを書き換える作業（kaizen の Hook セットアップ等）でブロックされたら、適用すべき内容を一時ファイルに書き出し、ユーザーに `! cp <tmp> <設定ファイル>` 等での適用を依頼する。

| エージェント | 自己設定ファイル | 編集可否 |
|------------|---------------|---------|
| Claude Code | `.claude/settings.json` | 不可（ハードブロック。bypass でも確認が出る） |
| Codex | `.codex/config.toml` / hooks | 現状は可（ただし credentials/auth/profile 等の上書きは制限） |
| GitHub Copilot | `.github/agents/`（指示） | 不可（ハードブロック） |
| GitHub Copilot | `.github/hooks/`（フック） | 可（手動承認ガードの設定を推奨） |

## 配布スキルの成果物は同梱する

配布対象スキル（`skills/<name>/`、`gh skill publish` の対象）が実行時に参照する成果物（テンプレート・設定ファイル・スクリプト等）は、必ずスキル内（`assets/` / `scripts/` / `references/`）に正本として同梱する。

配布されるのは `skills/<name>/` 配下のみで、リポジトリ直下や `.github/` に置いたファイルはインストール先プロジェクトに付いて行かず、参照先が無くなるため。

- インストール先リポジトリに同種のファイルが既にある場合はそれを優先・尊重し、無いときだけ同梱物を使う／（ユーザー確認の上）コピー導入する。既存ファイルは上書きしない
- スキル本体（`SKILL.md` 等）から参照するパスは、リポジトリ固有の場所ではなくスキル内の同梱物を起点にする

## 参照スキルガイド

- `multiagent-setup`: スキル・ルール・Hooks・ドキュメントをマルチエージェント対応構造でセットアップする
- `kaizen`: セッションから学びを抽出し根本原因を分析してスキル・ルール等に反映する
- `issue-create`: 短い説明から GitHub Issue を作成する。重複チェック・`.github/ISSUE_TEMPLATE/` 参照・ドラフト承認を経て起票する。着手は `issue-start` に引き継ぐ
- `issue-start`: GitHub Issue を起点に branch 作成・実装・commit・PR 作成までを標準化する
- `pr-review-handle`: PR のレビューコメント（全レビュアー対象）を確認・妥当性判断・必要時のみ修正・返信・解決（resolve）する。`--push` で commit・push まで行う
- `dependabot-merge`: Dependabot PR の CI 確認・影響レビュー・判断のコメント記録・マージを標準化する。PR 単体または `--all` で open な全 PR を処理。`>=1.0` の決定論的自動マージは `.github/workflows/dependabot-automerge.yml` が担い、本スキルは 0.x や自動マージ未設定リポジトリでの手動判断を受け持つ
