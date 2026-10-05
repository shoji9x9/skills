---
name: multiagent-setup
description: マルチエージェント環境（Claude Code / Codex / GitHub Copilot）向けのスキル・ルール・Hooks・ドキュメントのセットアップに必ず使用すること。スキルの作成・更新・削除、ルールの追加・管理、Hooksの設定、CLAUDE.md・AGENTS.md・.github/copilot-instructions.mdなどのドキュメントの整備・整理・分割・集約、プロジェクトのマルチエージェント初期化で参照する。加えて、知識・規約・処理を新たに追加する、またはドキュメントを整理・再配置するときに、それを skill / rule / hook / ドキュメントのどれに落とすか（rule なら paths を最小スコープに、ドキュメントなら基底ドキュメントか個別かを選ぶ）を判断する場面でも必ず参照する。
argument-hint: "[操作内容（スキル / ルール / Hooks / ドキュメント / 全体）]"
license: MIT
---

# Multiagent Setup

Claude Code・Codex・GitHub Copilot の 3 つのエージェントが共有できる、プロジェクトの構成を整えるスキル。

## 前提

- ツール: `gh`（`gh skill` 拡張）、`git`
- 前提スキル: なし（スキルを作った後の検証に `skill-creator` を使えるが、必須ではない）
- MCP: なし
- シェル: bash（POSIX 互換のシェル）。
  コマンドの例（シンボリックリンクの作成など）は bash を前提にしているので、Windows では WSL や Git Bash などの bash の環境で実行する。
- node・pnpm・python などのランタイムは要らない。

## 基本原則

- `.agents/` ディレクトリに実体を置き、各エージェントに固有のディレクトリにはシンボリックリンクを作る。同じファイルを複数の場所に複製しない。
- 対象はプロジェクトのレベルだけである。ユーザーの設定（`~/.claude/`、`~/.codex/` など）は対象にしない。

## フロー

### Step 1: コンポーネントの特定

ユーザーのメッセージから、操作の対象を推論する。

| ユーザーの意図 | コンポーネント |
|-------------|-------------|
| スキルを作成 / 追加 / 更新 / 削除 | スキル |
| ルールを作成 / 追加 / 更新 / 削除 | ルール |
| Hooks を設定 / 追加 / 更新 | Hooks |
| ドキュメントを整備 / 整理 / 分割 / 集約 / 再配置 / 初期化 / 作成 | ドキュメント |
| プロジェクトを初期化 / セットアップ | 全コンポーネント |

意図が分からないときや、複数に当たるときは、AskUserQuestion で確かめる。

追加したい知識・規約・処理を、skill・rule・hook・ドキュメントのどれにするか迷うときは、`references/component-selection.md` の基準に従う。

### Step 2: 対象エージェントの確認

プロジェクトの今の状態を確かめる。

```bash
ls -d .agents .claude .github .codex 2>/dev/null
```

対象のエージェントが明示されていないときは、AskUserQuestion で確かめる。

### Step 3: コンポーネントの実行

SKILL.md と同じディレクトリの `references/` にある、対応するコンポーネントのファイルを Read ツールで読み、その手順に従って実行する。

- コンポーネントの選択基準（どのコンポーネントにするか迷うときに最初に読む） → `references/component-selection.md`
- スキルの設定 → `references/skills.md`
- ルールの設定 → `references/rules.md`
- Hooks の設定 → `references/hooks.md`
- ドキュメントの整備 → `references/docs.md`

コンポーネントのファイルは、SKILL.md と同じディレクトリの `references/` の下にある。インストール先に応じて、次の場所を順に試す。

- `~/.claude/skills/multiagent-setup/references/<file>.md`
- `.claude/skills/multiagent-setup/references/<file>.md`
- `.agents/skills/multiagent-setup/references/<file>.md`

### Step 4: 後処理

- スキルを作った場合: `skill-creator` スキルが使えれば、スキルの検証と改善を提案する。使えなければ飛ばす。
- ドキュメントを整備した場合: `references/docs.md` の指示に従う。
