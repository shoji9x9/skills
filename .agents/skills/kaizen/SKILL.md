---
name: kaizen
description: コーディングエージェントのセッションから失敗・修正・エラーを抽出し根本原因を分析。スキル・ルール・Hooks・ドキュメントへ反映することで同じ失敗を繰り返さない仕組みを構築する。「セッションを振り返る」「学びを抽出する」「kaizen」「改善を適用する」「学びを適用して」などで発動。
license: MIT
---

# Kaizen

セッションから学びを継続的に抽出・適用するスキル。

## 基本原則

- **根本原因を分析する**: 個別の失敗への対策ではなく、その失敗が起きた理由を分析し原因への対策を行う
- **仕組みで解決する**: 可能な限り決定論的な仕組みで再発を防ぐ。エージェントの挙動は確率論的なため、エージェントへの指示（ルール・ドキュメント等）だけでなく、リンター・フォーマッター・pre-commit フック・スクリプトなど決定論的なチェックを優先して活用する
- **エージェント間で共有する**: `.kaizen/` に保存された学びはプロジェクト内の全エージェント（Claude Code / Codex / GitHub Copilot）が参照できる。あるエージェントで得た学びを他のエージェントでも活かす
- **スコープはプロジェクトレベル**: 学びは `.kaizen/` ディレクトリに保存し、このプロジェクトに適用する

## フロー

### Step 1: 意図の特定

| ユーザーの意図 | コンポーネント |
|-------------|-------------|
| セッションを振り返る / 学びを抽出する / kaizen | extract |
| 学びを適用する / 改善を実施する | apply |
| .kaizen/ を整理する / 適用済みを削除する / クリーンアップ | apply（cleanup セクション参照） |

意図が不明な場合は AskUserQuestion で確認する。

### Step 2: コンポーネントの実行

対応コンポーネントファイルを Read ツールで読み込み手順に従う:

- 学び抽出 → `extract.md`
- 学び適用 → `apply.md`

コンポーネントファイルの場所（インストール先に応じて試みる）:

- `~/.claude/skills/kaizen/<component>.md`
- `.claude/skills/kaizen/<component>.md`
- `.agents/skills/kaizen/<component>.md`

---

## このスキル自体のインストール手順

`gh skill install` で `.agents/` に実体を配置し、`.claude/` にシンボリックリンクを作成する:

```bash
# 1. --agent codex で .agents/skills/kaizen/ に実体を配置する
gh skill install shoji9x9/skills kaizen --agent codex

# 2. Claude Code 用シンボリックリンクを作成
mkdir -p .claude/skills
ln -s ../../.agents/skills/kaizen .claude/skills/kaizen
```

`--agent codex` を指定すると `.agents/` 配下にファイルが配置される。Claude Code は手順 2 のシンボリックリンク経由で参照する。

`AGENTS.md` の「参照スキルガイド」セクションに追記すれば常時参照させられる。
