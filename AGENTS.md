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

### スキルを追加・修正する

1. `skills/<name>/` を作成または編集する
2. `skills/<name>/evals/evals.json` にテストケースを追加・更新する
3. `scripts/reinstall-skill.sh <name>` でインストール済みスキルを更新する
4. スキルにセットアップ手順が定義されている場合は実行する。既存ファイルや既存 Hook がある場合は上書きせず、更新するか確認する
5. skill-creator で回帰テストを実行し `tests/<name>/iteration-N/` に結果を保存する
6. `gh skill publish --dry-run` でバリデーションを確認する
7. コミット・タグ・リリースする

### スキル修正後の再インストール

スキルを修正した場合は、手作業ではなくスクリプトで再インストールする:

```bash
scripts/reinstall-skill.sh <name>
```

このスクリプトは `.agents/skills/<name>/` に実体をインストールし、`.claude/skills/<name>` にシンボリックリンクを作成する。
また、`gh skill install --from-local` が自動追加する `metadata.local-path` をインストール済み `SKILL.md` から削除する。
現時点の `gh skill install --help` には、このメタデータ追加を無効化するオプションはない。

### 回帰テストを実行する

`skills/<name>/evals/README.md` の手順を参照。

スキルのインストールまたはセットアップ手順を変更した場合も、そのスキルで定義された評価を実行する。テスト結果にローカル絶対パスやユーザー固有情報が含まれる場合は、コミット前に `<repo>` や `<home>` などのプレースホルダーへ置換する。

## 参照スキルガイド

- `multiagent-setup`: スキル・ルール・Hooks・ドキュメントをマルチエージェント対応構造でセットアップする
- `kaizen`: セッションから学びを抽出し根本原因を分析してスキル・ルール等に反映する
