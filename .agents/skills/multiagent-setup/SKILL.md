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

## このスキル自体のインストール手順

`gh skill install` で `.agents/` に実体を配置し、`.claude/` にシンボリックリンクを作成する:

```bash
# 1. --agent codex で .agents/skills/multiagent-setup/ に実体を配置する
gh skill install shoji9x9/skills multiagent-setup --agent codex

# 2. Claude Code 用シンボリックリンクを作成
mkdir -p .claude/skills
ln -s ../../.agents/skills/multiagent-setup .claude/skills/multiagent-setup
```

`--agent codex` を指定すると `.agents/` 配下にファイルが配置される。これにより Codex が直接参照できる実体となる。Claude Code は手順 2 で作成するシンボリックリンク経由で参照する。

`AGENTS.md` の「参照スキルガイド」セクションに追記すれば常時参照させられる。
