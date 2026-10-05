# Hooks セットアップガイド

## エージェント別設定ファイル

| エージェント | 設定ファイル | イベントの例 |
|------------|------------|------------|
| Claude Code | `.claude/settings.json` の `hooks` セクション | SessionStart, PreToolUse, PostToolUse, Stop |
| Codex | `.codex/hooks.json` または `.codex/config.toml` の `[hooks]` テーブル | SessionStart, PreToolUse, PostToolUse, Stop |
| Copilot | `.github/hooks/*.json`（ファイル名は任意） | sessionStart, preToolUse, postToolUse, sessionEnd |

イベントの一覧、入力の JSON、exit code の意味はエージェントごとに違い、版が上がると増える。
上の列は例なので、使うイベントは各エージェントの公式のリファレンスで確かめる。

- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks)
- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)

## フックスクリプトの配置

- スキルに同梱の Hook（`kaizen`・`git-worktree` など）は、スキルに同梱のスクリプトを、各エージェントの設定ファイルから直接参照する。
  どこから参照するかと手順は、各スキルのセットアップの手順に従う。
  `.agents/hooks/scripts/` には複製しない（複製すると、スキルを更新しても反映されない）。
- プロジェクトに固有の Hook は `.agents/hooks/scripts/` に置き、各エージェントの設定ファイルからそのパスを参照する。
  こうすると、複数のエージェントで同じスクリプトを共有できる。

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

各エージェントの設定ファイルから該当するフックの設定を削除し、不要になったスクリプトを `.agents/hooks/scripts/` から削除する。
