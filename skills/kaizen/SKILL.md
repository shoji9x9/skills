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
| セットアップ / 初期設定 / hooks を設定する | セットアップ（このファイルの Step 3 参照） |

意図が不明な場合は AskUserQuestion で確認する。

### Step 2: コンポーネントの実行

対応コンポーネントファイルを Read ツールで読み込み手順に従う:

- 学び抽出 → `extract.md`
- 学び適用 → `apply.md`

コンポーネントファイルの場所（インストール先に応じて試みる）:

- `~/.claude/skills/kaizen/<component>.md`
- `.claude/skills/kaizen/<component>.md`
- `.agents/skills/kaizen/<component>.md`

### Step 3: セットアップ（インストール後・初回のみ）

kaizen を「自動で回る」状態にするには 2 つの Hook を組み合わせる。Hook からエージェント自身を呼び出して LLM を動かすことはできないため、役割を分ける:

- **タスク終了時 Hook（記録役）**: センチネルファイル `.kaizen/.pending-extract*` を残し、「未抽出の活動がある」ことを記録する。
- **コミット前 PreToolUse ゲート（実行役）**: `git commit` を捕捉し、未抽出センチネルが残っていればコミットをブロックしてエージェントに `kaizen --current` を促す。
  エージェントが抽出を終えるとセンチネルが消え、再試行した commit が通る。
  コミットを実際にブロックするため確定的に効き、全エージェント（Claude Code / Codex / Copilot）の PreToolUse で機能する。

> echo によるリマインダーや `AGENTS.md` への散文の指示は、エージェントの行動を確定的に変えられず守られない確率が高いため使わない。詳細は `extract.md` の「使わない方式」を参照。

既に Hook 設定が存在する場合は、上書きせず、既存設定を更新するかユーザーに確認する。

#### 1. 対象エージェントの確認

```bash
ls -d .agents .claude .github .codex 2>/dev/null
```

#### 2. 設定するエージェントをユーザーに確認

AskUserQuestion で確認する。対象エージェントが明示されていない場合のみ確認する。

#### 3. `extract.md` を読み込み、選択されたエージェントごとに 2 つの Hook を設定する

`extract.md` の「自動実行のセットアップ」（タスク終了時 Hook）と「コミット前 PreToolUse ゲート」に各エージェントの設定例がある。PreToolUse ゲートはスキルにバンドルされたスクリプトの実体（`.agents/skills/kaizen/scripts/kaizen-precommit-gate.sh`）をフックから直接参照する。プロジェクトへのコピーは不要。

#### 4. `multiagent-setup` スキルとの依存関係

`apply.md` の学び適用ステップでは `multiagent-setup` スキルを使用する。インストール済みでなければ事前にインストールするようユーザーに案内する:

```bash
gh skill install shoji9x9/skills multiagent-setup --agent codex
mkdir -p .claude/skills
ln -s ../../.agents/skills/multiagent-setup .claude/skills/multiagent-setup
```

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
