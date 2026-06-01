# スキルセットアップガイド

スキルの書き方・設計方針は `skill-creator` スキルを参照。

## ディレクトリ構造

```
.agents/skills/<name>/SKILL.md   実体（Codex が直接参照）
.claude/skills/<name>            Claude Code 用シンボリックリンク（ディレクトリへのリンク）
```

Copilot は `.agents/skills/` と `.claude/skills/` の両方を参照するため、追加対応不要。

## SKILL.md frontmatter

```yaml
---
name: <skill-name>          # 必須: 小文字英数字とハイフンのみ、最大64文字
description: <description>  # 必須: スキルの説明とトリガー条件、最大1024文字
---
```

## スキル作成手順

```bash
# ディレクトリ作成
mkdir -p .agents/skills/<name>

# SKILL.md を作成する（frontmatter + 本文）

# Claude Code 用シンボリックリンク
mkdir -p .claude/skills
ln -s ../../.agents/skills/<name> .claude/skills/<name>
```

常に参照させたい場合は `AGENTS.md` の「参照スキルガイド」セクションに追記する:

```markdown
## 参照スキルガイド

- `<name>`: <スキルの用途説明>
```

## スキル更新手順

`.agents/skills/<name>/SKILL.md` を編集するだけでよい。シンボリックリンク経由で自動的に反映される。

## スキル削除手順

```bash
rm -rf .agents/skills/<name>
rm .claude/skills/<name>
```

`AGENTS.md` に参照がある場合は該当行も削除する。

## スキル検証

`skill-creator` スキルが利用可能な場合、スキル作成後に検証と改善を提案する。利用不可の場合はスキップする。
