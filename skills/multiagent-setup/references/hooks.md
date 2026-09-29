# Hooks セットアップガイド

## エージェント別設定ファイル

| エージェント | 設定ファイル | イベントの例 |
|------------|------------|------------|
| Claude Code | `.claude/settings.json` の `hooks` セクション | SessionStart, PreToolUse, PostToolUse, Stop |
| Codex | `.codex/hooks.json` または `.codex/config.toml` の `[hooks]` テーブル | SessionStart, PreToolUse, PostToolUse, Stop |
| Copilot | `.github/hooks/*.json`（ファイル名は任意） | sessionStart, preToolUse, postToolUse, sessionEnd |

イベントの全一覧・入力 JSON・exit code の意味はエージェントごとに違い、版で増える。上の列は例なので、使うイベントは各エージェントの公式リファレンスで確かめる:

- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks)
- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)

## フックスクリプトの配置

- **スキル同梱の Hook**（`kaizen` / `git-worktree` 等）は、スキルに同梱されたスクリプトを各エージェントの設定ファイルから直接参照する。配線先と手順は各スキルのセットアップ手順に従い、`.agents/hooks/scripts/` へ複製しない（複製するとスキル更新に追随しない）。
- **プロジェクト固有の Hook** は `.agents/hooks/scripts/` に配置し、各エージェントの設定ファイルからそのパスを参照する。これにより複数エージェントで同じスクリプトを共有できる。

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
