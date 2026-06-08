# ドキュメント戦略ガイド

## 基本方針

**AGENTS.md を基底とし、CLAUDE.md と copilot-instructions.md で上書きする。** 共通内容は AGENTS.md に集約し、各エージェント固有の内容のみ各ファイルに記述する。AGENTS.md の内容を他のファイルに複製しない。

## ファイル別役割

| ファイル | 主な読者 | 役割 |
|---------|---------|------|
| `AGENTS.md` | Codex（メイン）、Claude Code | 全エージェント共通の指示。参照スキル・ルールの一覧 |
| `CLAUDE.md` | Claude Code | Claude Code 固有の上書き・拡張のみ記述 |
| `.github/copilot-instructions.md` | GitHub Copilot | Copilot 固有の上書き・拡張のみ記述 |
| `README.md` | 人間 | プロジェクト概要。エージェント向け指示は含めない |

## AGENTS.md の推奨構成

```markdown
# <プロジェクト名>

## プロジェクト概要

<プロジェクトの目的と概要>

## 技術スタック

<使用技術の一覧>

## ワークフロー

<開発フローや規約>

## 参照スキルガイド

<!-- 常に参照させたいスキルをここに列挙 -->
- `<skill-name>`: <スキルの用途>

## 参照ルールガイド

<!-- 常に参照させたいルールをここに列挙 -->
<!-- ルールが存在しない場合はこのセクションを省略してよい -->
- `.agents/rules/<name>.md`: <ルールの適用範囲>
```

## CLAUDE.md / copilot-instructions.md の方針

どちらも AGENTS.md の内容を参照し、**差分のみ**を記述する。そのエージェントにしか適用されない設定のみを追記する。固有の設定が何もない場合は AGENTS.md 参照行のみで十分。

```markdown
# <エージェント名> 設定

See AGENTS.md for project overview, tech stack, and workflow.

## <エージェント固有の設定>

<このエージェントにのみ適用するルール・設定>
```

**エージェント固有の設定の例:**

| エージェント | 固有の設定の例 |
|------------|--------------|
| Claude Code | `/skill-creator` などのスキル呼び出し手順、mise コマンド、Claude 固有の CLI 操作 |
| GitHub Copilot | Copilot 拡張の設定、GitHub Copilot Chat スラッシュコマンド、Copilot ワークスペースの挙動 |
| Codex | AGENTS.md がメインのため通常は不要 |

**共通の規約や仕様（スキルのフォーマット、コーディング規約、ディレクトリ構造など）は AGENTS.md に書く。** copilot-instructions.md に書いた内容が AGENTS.md にも存在する場合、または Claude Code にも同様に適用されるなら、それは AGENTS.md に移すべき内容。

## 作成順序

1. `AGENTS.md` — 全エージェント共通の指示を先に確定する
2. `CLAUDE.md` と `.github/copilot-instructions.md` — AGENTS.md が確定した後に差分のみ記述する（順序は問わない）

## 更新手順

全エージェント共通の変更は `AGENTS.md` のみを更新する。エージェント固有の変更は対応するファイルのみを更新する。
