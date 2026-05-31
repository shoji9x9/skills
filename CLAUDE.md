# Claude Code 設定

See AGENTS.md for project overview, directory structure, and workflow.

## Claude Code 固有の設定

### スキル開発

新しいスキルを作成・改善する際は `skill-creator` スキルを使用する。

### テスト実行

```bash
# 集計スクリプトの実行（mise 環境）
cd ~/.claude/skills/skill-creator
mise exec python -- python -m scripts.aggregate_benchmark \
  tests/<skill-name>/iteration-N \
  --skill-name <skill-name> \
  --skill-path skills/<skill-name>
```

### リリース

```bash
gh skill publish --dry-run   # バリデーション
gh skill publish --tag vX.Y.Z
```
