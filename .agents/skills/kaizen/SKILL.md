---
description: コーディングエージェントのセッションから失敗・修正・エラーを抽出し根本原因を分析。スキル・ルール・Hooks・ドキュメントへ反映することで同じ失敗を繰り返さない仕組みを構築する。「セッションを振り返る」「学びを抽出する」「kaizen」「改善を適用する」「学びを適用して」などで発動。
license: MIT
name: kaizen
---
# Kaizen

セッションから学びを継続的に抽出・適用するスキル。

## 前提

- **ツール**: `git`
- **前提スキル**: `multiagent-setup`（Hook・ドキュメント整備のセットアップで利用。`references/setup.md` 参照）。学びの反映先スキルの検証に `skill-creator` を使えるが任意
- **MCP**: なし
- **シェル**: bash（POSIX 互換シェル）。本スキルのコマンド例・設定する Hook（`mkdir -p` / `date -u` 等）は bash 前提のため、Windows では WSL / Git Bash 等の bash 環境で実行する
- node / pnpm / python などのランタイムは不要。

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
| セットアップ / 初期設定 / hooks を設定する | setup |

意図が不明な場合は AskUserQuestion で確認する。

### Step 2: コンポーネントの実行

対応コンポーネントファイルを Read ツールで読み込み手順に従う:

- 学び抽出 → `references/extract.md`
- 学び適用 → `references/apply.md`
- セットアップ → `references/setup.md`

コンポーネントファイルは SKILL.md と同じディレクトリの `references/` 配下にある。インストール先に応じて以下を試みる:

- `~/.claude/skills/kaizen/references/<file>.md`
- `.claude/skills/kaizen/references/<file>.md`
- `.agents/skills/kaizen/references/<file>.md`

### Step 3: セットアップ（インストール後・初回のみ）

`references/setup.md` を Read ツールで読み込み、手順に従う。kaizen を「自動で回る」状態にするための 3 つの Hook（タスク終了時のセンチネル記録・コミット前 PreToolUse ゲート・セッション開始時の参照注入）、`AGENTS.md` へのエージェント自己設定制約の追記、`multiagent-setup` への依存をまとめている。

---

## 参考文献

このスキルの根本原因分析（`references/extract.md`「根本原因分析」: 最低 3 階層の「なぜ」・KEDB 照合・横断スコープ確認）は、LLM エージェントによる障害原因分析（RCA）の研究知見に基づく。

- Roy et al. "Exploring LLM-based Agents for Root Cause Analysis" ([arXiv:2403.04123](https://arxiv.org/abs/2403.04123)) — 推論とツール実行を往復する ReAct 型エージェントが単発 LLM より診断精度が高い。証拠を取りに行く反復の根拠。
- Chen et al. "Automatic Root Cause Analysis via Large Language Models for Cloud Incidents" ([arXiv:2305.15778](https://arxiv.org/abs/2305.15778))
  — 約 4 万件の過去インシデントを RAG で参照すると精度向上。KEDB（既存 `.kaizen/` 照合）の根拠。
- "Reasoning Language Models for Root Cause Analysis in 5G Wireless Networks" ([arXiv:2507.21974](https://arxiv.org/abs/2507.21974)) — 推論特化モデルが高い pass@1 を達成。段階的な深掘りの有効性。
- "Towards LLM-based Root Cause Analysis of Hardware Design Failures" ([arXiv:2507.06512](https://arxiv.org/abs/2507.06512)) — 深い推論で RCA タスクの正答率が向上。
- "TAMO: Fine-Grained Root Cause Analysis via Tool-Assisted LLM Agent" ([arXiv:2504.20462](https://arxiv.org/abs/2504.20462)) — 多角的な観測データとツール呼び出しで深い分析。「単一の視点だけで結論しない」の根拠。

これらの要素は [karaage0703/ai-assistant-workspace の xangi-kaizen スキル](https://github.com/karaage0703/ai-assistant-workspace/tree/main/skills/xangi-kaizen) を参考に取り入れた。
