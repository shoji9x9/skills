# Skills

Claude Code / Codex / GitHub Copilot に対応したマルチエージェント向け汎用スキル集。

## 利用可能なスキル

| スキル | 説明 |
|-------|------|
| [multiagent-setup](./skills/multiagent-setup/) | スキル・ルール・Hooks・ドキュメントをマルチエージェント対応構造でセットアップ |
| [kaizen](./skills/kaizen/) | セッションから失敗・修正・エラーを抽出し根本原因を分析。スキル・ルール・Hooks・ドキュメントへ反映して同じ失敗の再発を防ぐ |
| [issue-start](./skills/issue-start/) | GitHub Issue を起点に branch 作成・実装・commit・PR 作成までを標準化 |

## インストール

```bash
gh skill install shoji9x9/skills multiagent-setup
gh skill install shoji9x9/skills kaizen
gh skill install shoji9x9/skills issue-start
```

## スキルの更新

```bash
gh skill update --all
```
