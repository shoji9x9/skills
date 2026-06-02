# 学び抽出ガイド

## モード

| モード | トリガー | 対象 | 抽出件数 |
|--------|---------|------|---------|
| `--all` | 手動のみ | 全セッション | 制限なし（優先度順に提示） |
| `--current`（デフォルト） | 手動 / コミット前の PreToolUse ゲート | 最新セッション（実行中のものを含む） | 最重要 1 件 |

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
8. 抽出が完了したら未抽出マーカーを消す（同じセッションを再抽出しないため）: `rm -f .kaizen/.pending-extract*`

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

インストール後に一度だけ設定する（SKILL.md の Step 3 からこのセクションが呼び出される）。

**仕組み**: Hook からエージェント自身を再帰呼び出しして LLM を動かすことはできない。そこで役割を 2 つの Hook に分ける:

- **タスク終了時 Hook（記録役）**: センチネルファイル `.kaizen/.pending-extract*` を残すだけ（未抽出の活動があるという記録）。
- **コミット前 PreToolUse ゲート（実行役）**: `git commit` を捕捉し、未抽出センチネルが残っていればコミットをブロックしてエージェントに `kaizen --current` を促す。エージェントが抽出を終えるとセンチネルが消え、再試行した commit が通る。

> echo によるリマインダーは設定しない。Stop / sessionEnd Hook の標準出力はエージェントのコンテキストに渡らず（ユーザーにもほぼ surface されず）、行動につながらないため。確実に効かせるには、コミットを実際にブロックしてエージェントへ stderr を返す PreToolUse ゲート（後述）を使う。`AGENTS.md` 等への「コミット前に kaizen を実行する」という散文の指示は守られない確率が高いため主トリガーにはしない。

### タスク終了時 Hook（センチネル記録のみ）

#### Claude Code — Stop (`.claude/settings.json`)

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
    ]
  }
}
```

#### Codex — Stop (`.codex/hooks.json`)

```json
{
  "Stop": [
    {
      "command": "mkdir -p .kaizen && date -Iseconds > .kaizen/.pending-extract-codex"
    }
  ]
}
```

詳細なフォーマットは [Codex Hooks ドキュメント](https://developers.openai.com/codex/hooks) を参照すること。

#### GitHub Copilot — sessionEnd (`.github/hooks/kaizen-session.json`)

```json
{
  "version": 1,
  "hooks": {
    "sessionEnd": [
      {
        "type": "command",
        "bash": "mkdir -p .kaizen && date -Iseconds > .kaizen/.pending-extract-copilot",
        "cwd": ".",
        "timeoutSec": 5
      }
    ]
  }
}
```

詳細なフォーマットは [GitHub Copilot Hooks ドキュメント](https://docs.github.com/en/copilot/concepts/agents/hooks) を参照すること。

## コミット前 PreToolUse ゲート（自動実行の主トリガー）

`git commit` を捕捉し、未抽出センチネルが残っていればコミットをブロックして、エージェントに `kaizen --current` の実行を促す。Claude Code / Codex / Copilot のいずれも「ツール実行前に発火し、ブロックできる」Hook（PreToolUse / preToolUse）を備えるため、全エージェント共通で機能する。

判定はスキルにバンドルされたスクリプト（スキル内 `scripts/kaizen-precommit-gate.sh`、インストール後は `.agents/skills/kaizen/scripts/kaizen-precommit-gate.sh`）が行う。
`git commit` を含み、かつ `.kaizen/.pending-extract*` が存在するときだけ **exit code 2 + stderr** でブロックする。
この方式は Claude Code・Codex とも「exit 2 でブロックし stderr をエージェントへ渡す」と明記されており、JSON 出力スキーマの差を避けられる。

### セットアップ

スクリプトはプロジェクトへコピーしない。スキルのインストール先にある実体をフックから直接参照する。
このマルチエージェント構成では実体は `.agents/skills/kaizen/scripts/kaizen-precommit-gate.sh`（`.claude/skills/kaizen` はそこへのシンボリックリンク）にあり、フックの実行 cwd はプロジェクトルートなので、下記のパスでそのまま解決できる。
スクリプト内の `.kaizen/` 参照も cwd 基準なので、スクリプトの置き場所に依存しない。

> インストール先が異なる場合（例: ユーザースコープの `~/.claude/skills/kaizen/`）は、その実体へのパスに読み替える。

各エージェントの PreToolUse（Bash ツール実行前）に登録する。

#### Claude Code — PreToolUse (`.claude/settings.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash .agents/skills/kaizen/scripts/kaizen-precommit-gate.sh"
          }
        ]
      }
    ]
  }
}
```

#### Codex — PreToolUse (`.codex/hooks.json`)

```json
{
  "PreToolUse": [
    {
      "command": "bash .agents/skills/kaizen/scripts/kaizen-precommit-gate.sh"
    }
  ]
}
```

#### GitHub Copilot — preToolUse (`.github/hooks/kaizen-session.json`)

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": "bash .agents/skills/kaizen/scripts/kaizen-precommit-gate.sh",
        "cwd": ".",
        "timeoutSec": 5
      }
    ]
  }
}
```

> Copilot の `preToolUse` はブロックできるが、stderr/理由をエージェントのコンテキストへ渡せるかはドキュメント上不明確。
> 最低限コミットはブロックされるため、エージェントは失敗に反応して `kaizen --current` を実行する余地が残る。
> 挙動は [GitHub Copilot Hooks ドキュメント](https://docs.github.com/en/copilot/concepts/agents/hooks) で確認すること。

### 使わない方式

- **echo によるリマインダー（Stop / SessionStart）**: エージェントの行動を確定的に変えられず、見落とされる。
- **`AGENTS.md` 等への散文の指示**: 守られない確率が高い。主トリガーにはしない。
- **lefthook / git pre-commit**: 確定的だが LLM を動かせず、結局リマインダー止まりで echo と同じ問題に陥る。抽出・適用はエージェントの仕事なので、コミットをブロックしてエージェントに返す PreToolUse ゲートを使う。
