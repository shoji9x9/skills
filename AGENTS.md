# Skills

Claude Code / Codex / GitHub Copilot に対応したマルチエージェント向けスキル集。

## プロジェクト概要

このリポジトリは、複数の AI エージェントが共通のスキル・ルール・Hooks・ドキュメント構造を共有できるよう整備するための汎用スキルを提供する。  
スキルは `gh skill install` で任意のプロジェクトにインストールして使用する。

## 技術スタック

- **スキル管理**: GitHub CLI (`gh skill`)、Agent Skills 仕様
- **テスト**: skill-creator、Python 3.8+（集計スクリプト）
- **環境管理**: mise

## ディレクトリ構造

```
skills/<name>/          スキル実体（gh skill publish の対象）
  SKILL.md              スキルのメイン指示
  evals/
    evals.json          回帰テスト定義
    README.md           テスト実行手順
tests/<name>/           テスト結果（git 管理はサマリーのみ）
  iteration-N/
    benchmark.json      結果サマリー
.agents/skills/<name> -> ../../skills/<name>   このリポジトリ固有の構造 ※
.claude/skills/<name> -> ../../.agents/skills/<name>
```

※ 通常のプロジェクトでは `.agents/skills/<name>/` が実体で `.claude/skills/<name>` がシンボリックリンク。  
このリポジトリはスキルのソースが `skills/` にあるため、`.agents/` もシンボリックリンクとなっている。

## ワークフロー

### スキルを追加・修正する

1. `skills/<name>/` を作成または編集する
2. `skills/<name>/evals/evals.json` にテストケースを追加・更新する
3. skill-creator でテストを実行し `tests/<name>/iteration-N/` に結果を保存する
4. `gh skill publish --dry-run` でバリデーションを確認する
5. コミット・タグ・リリースする

### 回帰テストを実行する

`skills/<name>/evals/README.md` の手順を参照。

## 参照スキルガイド

- `multiagent-setup`: スキル・ルール・Hooks・ドキュメントをマルチエージェント対応構造でセットアップする
