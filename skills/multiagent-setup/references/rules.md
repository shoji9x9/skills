# ルールセットアップガイド

## ディレクトリ構造

```text
.agents/rules/<name>.md                          実体
.claude/rules/<name>.md                          Claude Code 用シンボリックリンク
.github/instructions/<name>.instructions.md      GitHub Copilot 用シンボリックリンク
```

Codex は `AGENTS.md` の「参照ルールガイド」セクション経由でルールを参照する。

## frontmatter フォーマット

実体ファイルには Claude Code 用の `paths` と GitHub Copilot 用の `applyTo` を両方記述する。

```yaml
---
paths:
  - src/**/*.ts
applyTo: "src/**/*.ts"
---
```

- `paths`: Claude Code が適用するファイルの glob パターンの配列
- `applyTo`: GitHub Copilot が適用するファイルの glob パターン（クォートで囲む。基本はダブルクォートだが、導入先リポジトリのフォーマッターによってはシングルクォートに変換されることがあり、どちらでも有効）
- 全ファイルに適用する場合は `**` を使用する
- 複数パターンはカンマ区切り: `"**/*.ts,**/*.tsx"`

## rules 化とスコープの基準

- **rules 化の判断**: 特定のファイル群を触るときだけ関係する規約をルールにする。作業対象に依らず常に把握が必要な方針は、ルールではなく基底ドキュメントへ置く（skill / rule / hook / ドキュメントの振り分けは `references/component-selection.md` を参照）。
- **paths は最小スコープで切る**: そのルールが実際に効くべきファイル群だけを対象にする。
  - `**`（全ファイル）は「どのファイルを触っても常に守るべき普遍則」に限定する。
  - 言語・領域固有の規約は `<領域>/**/*.<ext>` まで絞る（例: `skills/**`、`.github/workflows/**`、`src/**/*.ts`）。ファイル種別だけで広く指定（例: `**/*.ts`）せず、対象ディレクトリまで含めて絞る。
  - 広すぎる paths は無関係な作業でも常時読み込ませてコンテキストを圧迫し、ルールの形骸化を招く。
- `applyTo` は `paths` と同じスコープに揃える（片方だけ広げない）。

## ルール作成手順

```bash
# 実体ファイルを作成する（frontmatter + ルール本文）
mkdir -p .agents/rules
# .agents/rules/<name>.md を作成する

# Claude Code 用シンボリックリンク
mkdir -p .claude/rules
ln -s ../../.agents/rules/<name>.md .claude/rules/<name>.md

# GitHub Copilot 用シンボリックリンク
mkdir -p .github/instructions
ln -s ../../.agents/rules/<name>.md .github/instructions/<name>.instructions.md
```

常に参照させたい場合は `AGENTS.md` の「参照ルールガイド」セクションに追記する:

```markdown
## 参照ルールガイド

- `.agents/rules/<name>.md`: <ルールの適用範囲の説明>
```

## ルール更新手順

`.agents/rules/<name>.md` を編集するだけでよい。両シンボリックリンク経由で自動的に反映される。

## ルール削除手順

```bash
rm .agents/rules/<name>.md
rm .claude/rules/<name>.md
rm .github/instructions/<name>.instructions.md
```

`AGENTS.md` に参照がある場合は該当行も削除する。
