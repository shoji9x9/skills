# Hooks セットアップガイド

## エージェント別設定ファイル

| エージェント | 設定ファイル | 対応イベント |
|------------|------------|------------|
| Claude Code | `.claude/settings.json` の `hooks` セクション | SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, StopFailure, Notification, SubagentStop |
| Codex | `.codex/hooks.json` または `.codex/config.toml` の `[hooks]` テーブル | SessionStart, PreToolUse, PostToolUse, PermissionRequest, UserPromptSubmit, Stop |
| Copilot | `.github/hooks/*.json`（ファイル名は任意） | preToolUse, sessionStart, sessionEnd, postToolUse, errorOccurred |

各エージェントのフックは stdin で JSON を受け取り、stdout への JSON 出力で動作を制御できる。最新の設定フォーマットは各エージェントの公式ドキュメントを確認すること:

- Claude Code: https://docs.anthropic.com/en/docs/claude-code/hooks
- Codex: https://developers.openai.com/codex/hooks
- GitHub Copilot: https://docs.github.com/en/copilot/concepts/agents/hooks

## フックスクリプトの配置

Hook スクリプトは `.agents/hooks/scripts/` に配置し、各エージェントの設定ファイルからそのパスを参照する。これにより複数エージェントで同じスクリプトを共有できる。

```text
.agents/hooks/scripts/
  pre-tool.sh         # ツール実行前の共通処理
  session-start.sh    # セッション開始時の共通処理
  ...
```

## 作成手順

```bash
# スクリプトディレクトリを作成する
mkdir -p .agents/hooks/scripts

# スクリプトを作成し実行権限を付与する
chmod +x .agents/hooks/scripts/<script>.sh

# 各エージェントの設定ファイルで .agents/hooks/scripts/<script>.sh を参照する
```

## 削除手順

各エージェントの設定ファイルから該当フックの設定を削除し、不要になったスクリプトを `.agents/hooks/scripts/` から削除する。
