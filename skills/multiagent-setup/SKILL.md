---
name: multiagent-setup
description: マルチエージェント環境（Claude Code / Codex / GitHub Copilot）向けのスキル・ルール・Hooks・ドキュメントのセットアップに必ず使用すること。スキルの作成・更新・削除、ルールの追加・管理、Hooksの設定、CLAUDE.md・AGENTS.md・copilot-instructions.mdなどのドキュメント整備、またはプロジェクトのマルチエージェント初期化を行う際はこのスキルを参照する。
license: MIT
---

# Multiagent Setup

Claude Code / Codex / GitHub Copilot の3エージェントが共有できるプロジェクト構造を整備するスキル。

## 基本原則

- `.agents/` ディレクトリを実体の保管場所とし、各エージェント固有のディレクトリへはシンボリックリンクを作成する。同一ファイルを複数箇所に複製しない。
- **スコープはプロジェクトレベルのみ。** ユーザー設定（`~/.claude/`、`~/.codex/` 等）は対象外。

## フロー

### Step 1: コンポーネントの特定

ユーザーのメッセージから操作対象を推論する。

| ユーザーの意図 | コンポーネント |
|-------------|-------------|
| スキルを作成 / 追加 / 更新 / 削除 | スキル |
| ルールを作成 / 追加 / 更新 / 削除 | ルール |
| Hooks を設定 / 追加 / 更新 | Hooks |
| ドキュメントを整備 / 初期化 / 作成 | ドキュメント |
| プロジェクトを初期化 / セットアップ | 全コンポーネント |

意図が不明または複数該当する場合は AskUserQuestion で確認する。

### Step 2: 対象エージェントの確認

プロジェクトの現状を確認する:

```bash
ls -d .agents .claude .github .codex 2>/dev/null
```

対象エージェントが明示されていない場合は AskUserQuestion で確認する。

### Step 3: コンポーネントの実行

このスキルと同じディレクトリにある対応コンポーネントファイルを Read ツールで読み込み、手順に従って実行する:

- スキル設定 → `skill.md`
- ルール設定 → `rule.md`
- Hooks 設定 → `hooks.md`
- ドキュメント整備 → `docs.md`

コンポーネントファイルの場所は SKILL.md と同じディレクトリ。インストール先に応じて以下を試みる:
- `~/.claude/skills/multiagent-setup/<component>.md`
- `.claude/skills/multiagent-setup/<component>.md`
- `.agents/skills/multiagent-setup/<component>.md`

### Step 4: 後処理

**スキルを作成した場合**: `skill-creator` スキルが利用可能であれば、スキルの検証・改善を提案する。利用不可の場合はスキップする。

**ドキュメントを整備した場合**: `docs.md` の指示に従う。

---

## エージェント別ファイル配置リファレンス

### スキル

| パス | 用途 |
|-----|------|
| `.agents/skills/<name>/SKILL.md` | **実体**（Codex が直接参照） |
| `.claude/skills/<name>` → `../../.agents/skills/<name>` | Claude Code 用シンボリックリンク |

Copilot は `.agents/skills/` と `.claude/skills/` の両方を参照するため、シンボリックリンクで自動対応。

### ルール

| パス | 用途 |
|-----|------|
| `.agents/rules/<name>.md` | **実体** |
| `.claude/rules/<name>.md` → `../../.agents/rules/<name>.md` | Claude Code 用シンボリックリンク |
| `.github/instructions/<name>.instructions.md` → `../../.agents/rules/<name>.md` | Copilot 用シンボリックリンク |

Codex は `AGENTS.md` の「参照ルールガイド」セクション経由で参照。

ルールファイルの frontmatter には Claude Code 用 `paths:` と Copilot 用 `applyTo:` を両方記述する:

```yaml
---
paths:
  - src/**
applyTo: "src/**"
---
```

### Hooks

| エージェント | 設定ファイル | 対応イベント |
|------------|------------|------------|
| Claude Code | `.claude/settings.json` | SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, StopFailure, Notification, SubagentStop |
| Codex | `.codex/hooks.json` または `.codex/config.toml` | SessionStart, PreToolUse, PostToolUse, PermissionRequest, UserPromptSubmit, Stop |
| Copilot | `.github/hooks/*.json` | preToolUse, sessionStart, sessionEnd, postToolUse, errorOccurred |

### ドキュメント

| ファイル | 役割 |
|---------|------|
| `AGENTS.md` | **基底**: 全エージェント共通の指示。「参照スキルガイド」「参照ルールガイド」セクションを持つ |
| `CLAUDE.md` | **上書き**: Claude Code 固有の拡張。AGENTS.md を参照し差分のみ記述 |
| `.github/copilot-instructions.md` | Copilot 専用の指示 |
| `README.md` | 人間向けのプロジェクト説明 |
