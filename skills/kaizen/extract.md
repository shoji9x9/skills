# 学び抽出ガイド

## モード

| モード | トリガー | 対象 | 抽出件数 |
|--------|---------|------|---------|
| `--all` | 手動のみ | 全セッション | 制限なし（優先度順に提示） |
| `--current`（デフォルト） | 手動 または Stop Hook 経由 | 前セッションのみ | 最重要 1 件 |

## セッションログの場所

| エージェント | ログの場所 | 形式 |
|-----------|----------|------|
| Claude Code | `~/.claude/projects/<hash>/*.jsonl` | JSONL |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | JSONL |
| Copilot | `~/.copilot/session-state/` | JSONL / SQLite |

セッションログを探す手順:

```bash
# Claude Code: プロジェクトのハッシュディレクトリを特定する
ls -lt ~/.claude/projects/ | head -10

# Codex: 日付ディレクトリを探す
ls -lt ~/.codex/sessions/$(date +%Y/%m/%d)/ 2>/dev/null | head -10

# Copilot: セッション状態を確認する
ls ~/.copilot/session-state/ 2>/dev/null | head -10
```

## 抽出パターン

以下のいずれかが検出された会話ターンを候補とする。

**ユーザーの修正指示**:

- 「違う」「やり直し」「修正して」「ダメ」「間違い」「もう一度」
- 否定から始まるフォローアップ（「そうではなく」「〜ではなく〜」）
- 直前の出力への否定的な反応

**エラーと繰り返し**:

- ツール実行エラーの連続（同じエラーが複数回）
- 同一ファイルへの複数回の編集（作成→削除→再作成など）
- コマンドの `exit code != 0` が続く

## 根本原因分析（重要）

個別の失敗を記録するのではなく、**なぜそれが起きたか**を推論する。

| 事象のパターン | 根本原因候補 | 提案するアクション |
|-------------|------------|----------------|
| ディレクトリ構造の誤り | ルールが明文化されていない | `.agents/rules/` にルールを追加する |
| 同じコマンドエラーを繰り返す | スキルに正確な手順がない | スキルに手順・注意事項を追加する |
| ドキュメントと実装の乖離 | ドキュメントが更新されていない | `AGENTS.md` 等を更新する |
| コミット前に問題が発覚する | 自動チェックがない | lefthook / pre-commit に検証を追加する |
| エージェントが誤った前提で動く | 共通認識が共有されていない | `AGENTS.md` に背景情報を追記する |

## 抽出手順

1. `.kaizen/` ディレクトリが存在しなければ作成する
2. セッションログを読み込む（`--current` なら前セッションの最新ファイル 1 つ）
3. 抽出パターンに照らして修正・エラー・やり直しの箇所を特定する
4. 各箇所について根本原因を推論し候補をリストアップする
5. `--current` モードの場合: 最も重要な 1 件を選ぶ（優先度: 繰り返し発生 > 根本原因が明確 > 対策が具体的）
6. 候補の内容（事象・根本原因・提案）をユーザーに提示し承認を得る
7. 承認された候補を `.kaizen/YYYY-MM-DD-<slug>.md` に書き込む

## 学びファイルのフォーマット

```markdown
---
date: YYYY-MM-DD
type: rule
priority: high
status: pending
session: claude-code
---

## 事象

〈何が起きたか〉

## 根本原因

〈なぜそれが起きたか〉

## 提案

〈何を作成・変更すべきか。type が rule ならルール文面まで含める〉
```

`type` の値: `rule` / `skill` / `hook` / `doc` / `other`
`priority` の値: `high` / `medium` / `low`
`status` の初期値: 常に `pending`

## 自動実行のセットアップ

タスク終了時 Hook で kaizen の振り返り候補を記録する。インストール後に一度だけ設定する（SKILL.md の Step 3 からこのセクションが呼び出される）。

**仕組み**: Hook からエージェント自身を再帰呼び出しして改善を自動適用するのは避ける。タスク終了時にセンチネルファイルを作成し、ユーザーまたは次のエージェント実行が `kaizen --current` を明示的に実行して学びを保存する。改善の適用は `.kaizen/` に保存された学びを確認してから行う。

### Claude Code (`.claude/settings.json`)

設定例を示す。Stop Hook でタスク終了時に kaizen の振り返り候補を残す。

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "mkdir -p .kaizen && date -Iseconds > .kaizen/.pending-extract && echo 'kaizen: タスク終了時の振り返り候補を記録しました。必要に応じて kaizen --current を実行してください。'"
          }
        ]
      }
    ]
  }
}
```

### Codex (`.codex/hooks.json`)

Stop イベント時にセンチネルファイルを作成する:

```json
{
  "Stop": [
    {
      "command": "mkdir -p .kaizen && date -Iseconds > .kaizen/.pending-extract-codex && echo 'kaizen --current を実行してタスク終了時の学びを保存してください'"
    }
  ]
}
```

詳細なフォーマットは [Codex Hooks ドキュメント](https://developers.openai.com/codex/hooks) を参照すること。

### GitHub Copilot (`.github/hooks/kaizen-session.json`)

`sessionEnd` イベント時にセンチネルファイルを作成する:

```json
{
  "version": 1,
  "hooks": {
    "sessionEnd": [
      {
        "type": "command",
        "bash": "mkdir -p .kaizen && date -Iseconds > .kaizen/.pending-extract-copilot && echo 'kaizen --current を実行してタスク終了時の学びを保存してください'",
        "cwd": ".",
        "timeoutSec": 5
      }
    ]
  }
}
```

詳細なフォーマットは [GitHub Copilot Hooks ドキュメント](https://docs.github.com/en/copilot/concepts/agents/hooks) を参照すること。
