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

## 自動実行のセットアップ（オプション）

Stop Hook でセッション終了を記録し、次回 SessionStart 時に自動で `--current` 抽出を実行する。

**仕組み**: Claude Code の Stop Hook から Claude 自身を再帰呼び出しすることはできない。そのため Stop 時点でセンチネルファイルを作成し、次のセッション開始時に前セッションのログを解析して学びを保存する（1 セッション遅延）。

### Claude Code (`.claude/settings.json`)

設定例を示す。Stop Hook でセッション終了をマークし、SessionStart Hook で前セッションの学びを処理する。

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "mkdir -p .kaizen && date -Iseconds > .kaizen/.pending-extract"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "もし .kaizen/.pending-extract ファイルが存在すれば kaizen --current を実行して前セッションの最重要の学びを 1 件 .kaizen/ に保存し、完了後に .kaizen/.pending-extract を削除する。ファイルが存在しなければ何もしない。"
          }
        ]
      }
    ]
  }
}
```

### Codex (`.codex/hooks.json`)

Stop イベント時にセンチネルファイルを作成し、SessionStart 時に処理する:

```json
{
  "Stop": [
    {
      "command": "mkdir -p .kaizen && date -Iseconds > .kaizen/.pending-extract-codex"
    }
  ],
  "SessionStart": [
    {
      "command": "test -f .kaizen/.pending-extract-codex && echo 'kaizen --current を実行して前セッションの学びを 1 件保存してください' && rm .kaizen/.pending-extract-codex || true"
    }
  ]
}
```

詳細なフォーマットは [Codex Hooks ドキュメント](https://developers.openai.com/codex/hooks) を参照すること。

### GitHub Copilot (`.github/hooks/kaizen-session.json`)

`sessionEnd` イベント時にセンチネルファイルを作成し、`sessionStart` 時に通知する:

```json
{
  "sessionEnd": {
    "command": "mkdir -p .kaizen && date -Iseconds > .kaizen/.pending-extract-copilot"
  },
  "sessionStart": {
    "command": "test -f .kaizen/.pending-extract-copilot && echo 'kaizen --current を実行して前セッションの学びを保存してください' && rm .kaizen/.pending-extract-copilot || true"
  }
}
```

詳細なフォーマットは [GitHub Copilot Hooks ドキュメント](https://docs.github.com/en/copilot/concepts/agents/hooks) を参照すること。
