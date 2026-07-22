---
argument-hint: '[操作内容（スキル / ルール / Hooks / ドキュメント / 全体）]'
description: マルチエージェント環境（Claude Code / Codex / GitHub Copilot）向けのスキル・ルール・Hooks・ドキュメントのセットアップに必ず使用すること。スキルの作成・更新・削除、ルールの追加・管理、Hooksの設定、CLAUDE.md・AGENTS.md・.github/copilot-instructions.mdなどのドキュメントの整備・整理・分割・集約、プロジェクトのマルチエージェント初期化で参照する。加えて、知識・規約・処理を新たに追加する、またはドキュメントを整理・再配置するときに、それを skill / rule / hook / ドキュメントのどれに落とすか（rule なら paths を最小スコープに、ドキュメントなら基底ドキュメントか個別かを選ぶ）を判断する場面でも必ず参照する。
license: MIT
name: multiagent-setup
---
# Multiagent Setup

Claude Code / Codex / GitHub Copilot の3エージェントが共有できるプロジェクト構造を整備するスキル。

## 前提

- **ツール**: `gh`（`gh skill` 拡張）, `git`
- **前提スキル**: なし（スキル作成後の検証に `skill-creator` を使えるが任意）
- **MCP**: なし
- **シェル**: bash（POSIX 互換シェル）。コマンド例（シンボリックリンク作成等）は bash 前提のため、Windows では WSL / Git Bash 等の bash 環境で実行する
- node / pnpm / python などのランタイムは不要。

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
| ドキュメントを整備 / 整理 / 分割 / 集約 / 再配置 / 初期化 / 作成 | ドキュメント |
| プロジェクトを初期化 / セットアップ | 全コンポーネント |

意図が不明または複数該当する場合は AskUserQuestion で確認する。

追加したい知識・規約・処理を skill / rule / hook / ドキュメントのどれに落とすか迷う場合は、`references/component-selection.md` の判断基準に従う。

### Step 2: 対象エージェントの確認

プロジェクトの現状を確認する:

```bash
ls -d .agents .claude .github .codex 2>/dev/null
```

対象エージェントが明示されていない場合は AskUserQuestion で確認する。

### Step 3: コンポーネントの実行

SKILL.md と同じディレクトリの `references/` にある対応コンポーネントファイルを Read ツールで読み込み、手順に従って実行する:

- コンポーネント選択基準（どのコンポーネントか迷う場合にまず参照する判断基準） → `references/component-selection.md`
- スキル設定 → `references/skills.md`
- ルール設定 → `references/rules.md`
- Hooks 設定 → `references/hooks.md`
- ドキュメント整備 → `references/docs.md`

コンポーネントファイルは SKILL.md と同じディレクトリの `references/` 配下にある。インストール先に応じて以下を試みる:

- `~/.claude/skills/multiagent-setup/references/<file>.md`
- `.claude/skills/multiagent-setup/references/<file>.md`
- `.agents/skills/multiagent-setup/references/<file>.md`

### Step 4: 後処理

**スキルを作成した場合**: `skill-creator` スキルが利用可能であれば、スキルの検証・改善を提案する。利用不可の場合はスキップする。

**ドキュメントを整備した場合**: `references/docs.md` の指示に従う。
