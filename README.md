# Skills

Claude Code / Codex / GitHub Copilot に対応したマルチエージェント向け汎用スキル集。
エージェントによる自律的な開発（Issue の起票・着手から実装・レビュー対応・リリースまで）に必要なスキルを提供する。

## 利用可能なスキル

| スキル | 説明 |
|-------|------|
| [multiagent-setup](./skills/multiagent-setup/) | スキル・ルール・Hooks・ドキュメントをマルチエージェント対応構造でセットアップ |
| [kaizen](./skills/kaizen/) | セッションから失敗・修正・エラーを抽出し根本原因を分析。スキル・ルール・Hooks・ドキュメントへ反映して同じ失敗の再発を防ぐ |
| [issue-create](./skills/issue-create/) | 短い説明から GitHub Issue を作成。重複チェック・`.github/ISSUE_TEMPLATE/` 参照・ドラフト承認を経て起票 |
| [issue-start](./skills/issue-start/) | GitHub Issue を起点に branch 作成・実装・commit・PR 作成までを標準化 |
| [pr-review-handle](./skills/pr-review-handle/) | PR のレビューコメント（全レビュアー対象）を確認・妥当性判断・必要時のみ修正・返信・解決。`--push` で commit・push・CI 確認後の Copilot 再依頼まで |

## インストール

```bash
gh skill install shoji9x9/skills multiagent-setup
gh skill install shoji9x9/skills kaizen
gh skill install shoji9x9/skills issue-create
gh skill install shoji9x9/skills issue-start
gh skill install shoji9x9/skills pr-review-handle
```

## スキルの更新

```bash
gh skill update --all
```
