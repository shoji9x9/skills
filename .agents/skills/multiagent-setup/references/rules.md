# ルールセットアップガイド

## ディレクトリ構造

```text
.agents/rules/<name>.md                          実体
.claude/rules/<name>.md                          Claude Code 用シンボリックリンク
.github/instructions/<name>.instructions.md      GitHub Copilot 用シンボリックリンク
```

Codex は、`AGENTS.md` の「参照ルールガイド」の節を通してルールを参照する。

## frontmatter フォーマット

実体のファイルには、Claude Code 用の `paths` と、GitHub Copilot 用の `applyTo` の両方を書く。

```yaml
---
paths:
  - src/**/*.ts
applyTo: "src/**/*.ts"
---
```

- `paths`: Claude Code が適用するファイルの glob パターンの配列
- `applyTo`: GitHub Copilot が適用するファイルの glob パターン。
  引用符で囲む。基本はダブルクォートだが、導入先のリポジトリのフォーマッターによってはシングルクォートに変わることがあり、どちらでも有効である。
- すべてのファイルに適用するときは `**` を使う。
  ただし、`**` はどのファイルでも常に守る普遍的な規則に限る（下の「rules 化とスコープの基準」）。
- 複数のパターンを書くとき、`applyTo` はカンマ区切りの 1 つの文字列（例: `"src/**/*.ts,src/**/*.tsx"`）にし、`paths` は配列で 1 行ずつ並べる。
  どちらも、種別だけの広い指定にせず、対象のディレクトリまで絞る。

## rules 化とスコープの基準

- ルールにするかの判断: 特定のファイル群を触るときだけ関係する規約を、ルールにする。
  作業の対象に関わらず常に把握しておく必要がある方針は、ルールではなく基底ドキュメントに置く。
  skill・rule・hook・ドキュメントの振り分けは、`references/component-selection.md` にある。
- paths は最小の範囲で切る。そのルールが実際に当たるべきファイル群だけを対象にする。
  - `**`（すべてのファイル）は、「どのファイルを触っても常に守るべき普遍則」に限る。
  - 言語や領域に固有の規約は、`<領域>/**/*.<ext>` まで絞る（例: `skills/**`、`.github/workflows/**`、`src/**/*.ts`）。
    ファイルの種別だけで広く指定（例: `**/*.ts`）せず、対象のディレクトリまで含めて絞る。
  - paths が広すぎると、関係の無い作業でも常に読み込まれてコンテキストを圧迫し、ルールが読まれなくなる。
- `applyTo` は `paths` と同じ範囲に揃える（片方だけを広げない）。

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

常に参照させたいときは、`AGENTS.md` の「参照ルールガイド」の節に追記する。

```markdown
## 参照ルールガイド

- `.agents/rules/<name>.md`: <ルールの適用範囲の説明>
```

## ルール更新手順

`.agents/rules/<name>.md` を編集するだけでよい。2 つのシンボリックリンクを通して、自動で反映される。

## ルール削除手順

```bash
rm .agents/rules/<name>.md
rm .claude/rules/<name>.md
rm .github/instructions/<name>.instructions.md
```

`AGENTS.md` に参照があるときは、その行も削除する。
