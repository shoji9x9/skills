# スキルセットアップガイド

スキルの書き方と設計の方針は、`skill-creator` スキルにある。

## ディレクトリ構造

```text
.agents/skills/<name>/SKILL.md   実体（Codex が直接参照）
.claude/skills/<name>            Claude Code 用シンボリックリンク（ディレクトリへのリンク）
```

Copilot は `.agents/skills/` と `.claude/skills/` の両方を参照するので、追加の対応は要らない。

## 初期セットアップ

プロジェクトにマルチエージェントに対応した基本の構成を入れるときは、`references/docs.md` を使って次を作成・更新する。

- `AGENTS.md`
- `CLAUDE.md`
- `.github/copilot-instructions.md`
- `README.md`

ファイルがすでにあれば上書きせず、更新するかをユーザーに確かめる。
共通の内容は `AGENTS.md` にまとめ、`CLAUDE.md` と `.github/copilot-instructions.md` には、各エージェントに固有の差分だけを書く。

## SKILL.md frontmatter

```yaml
---
name: <skill-name>          # 必須: 小文字英数字とハイフンのみ、最大64文字
description: <description>  # 必須: スキルの説明とトリガー条件、最大 1024 バイト（UTF-8。日本語はおよそ 340 文字）
argument-hint: "<hint>"     # 任意: スラッシュコマンド実行時に表示する引数ヒント、引用符で囲む
---
```

`argument-hint` は、Agent Skills の標準仕様（agentskills.io）の外にある拡張のフィールドである。
Claude Code と VS Code（Copilot の Agent Skills）は、補完のときのヒントの表示に使う。Codex CLI と Copilot CLI は知らないフィールドとして無視する（エラーにはならない）。
値が `[` で始まると、YAML の flow sequence と誤って解釈されるので、引用符で囲む（シングルとダブルのどちらでもよい）。

## スキル作成手順

```bash
# ディレクトリ作成
mkdir -p .agents/skills/<name>

# SKILL.md を作成する（frontmatter + 本文）

# Claude Code 用シンボリックリンク
mkdir -p .claude/skills
ln -s ../../.agents/skills/<name> .claude/skills/<name>
```

常に参照させたいときは、`AGENTS.md` の「参照スキルガイド」の節に追記する。

```markdown
## 参照スキルガイド

- `<name>`: <スキルの用途説明>
```

## スキル更新手順

`.agents/skills/<name>/SKILL.md` を直接編集するだけでよい。シンボリックリンクを通して、自動で反映される。

## スキル削除手順

```bash
rm -rf .agents/skills/<name>
rm .claude/skills/<name>
```

`AGENTS.md` に参照があるときは、その行も削除する。

## スキル検証

`skill-creator` スキルが使えるときは、スキルを作った後に検証と改善を提案する。使えなければ飛ばす。
