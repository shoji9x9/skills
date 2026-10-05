---
name: kaizen
description: コーディングエージェントのセッションから失敗・修正・エラーを抽出し根本原因を分析。スキル・ルール・Hooks・ドキュメントへ反映することで同じ失敗を繰り返さない仕組みを構築する。適用されないまま古くなり再発もしていない学びは抽出時に自動で忘却し、セッション開始時の注入を軽く保つ。「セッションを振り返る」「学びを抽出する」「kaizen」「改善を適用する」「学びを適用して」「古い学びを忘れて」などで発動。
argument-hint: "[extract|apply|forget|archive|delete|setup] [--current | --all] [--record-pending]"
license: MIT
---

# Kaizen

セッションから学びを抽出し、成果物へ反映し続けるスキル。

## 使い方

```text
/kaizen [extract] [--current | --all]   学びを抽出（extract は省略可 = 既定。--current = 最新セッション・最重要 1 件 / --all = 全セッション・優先度順）
/kaizen extract --current --record-pending
                                      最重要候補を最大 1 件、承認確認なしで pending 記録（オーケストレーション専用）
/kaizen apply                           pending の学びを成果物（ルール / doc / hook 等）へ適用
/kaizen forget [--list | --auto | 対象ファイル...]  適用されないまま古くなった pending を忘れる（status: forgotten。3 つは排他）
/kaizen archive [対象フラグ]             .kaizen を整理 = アーカイブ（既定・非破壊。.kaizen/archive/ へ移動）
/kaizen delete  [対象フラグ]             .kaizen を整理 = 物理削除（破壊的・明示時のみ）

対象フラグ（archive / delete 共通・省略時は対象を対話で確認）:
  --applied | --rejected | --applied-and-rejected | --forgotten | --all

初回のみ: /kaizen setup（インストール後の hooks 等のセットアップ。「Step 3」参照）
```

例: `/kaizen --all` / `/kaizen forget --list` / `/kaizen archive` / `/kaizen archive --rejected` / `/kaizen delete --applied`

- 自然文でも起動する。対応は次のとおりである。
  - 「振り返って」「kaizen」は抽出
  - 「学びを適用して」は apply
  - 「忘れて」「古い学びを整理して」は forget
  - 「整理して」「アーカイブして」「クリーンアップして」は archive
  - 「削除して」「消して」は delete
  - 「セットアップして」「hooks を設定して」は setup
- 忘却はデフォルトで自動に行う。学びを 1 件記録し終えた時点（`kaizen-extract-done.sh`）で、適用されないまま閾値の日数が過ぎ、優先度も上がらなかった pending を `status: forgotten` にする。
  学びを 1 件足すたびに古いものを 1 件外す形なので、調査だけのセッションでは何も書かない。
  閾値に関わらず忘れたいときだけ、手動の `/kaizen forget` を使う（`references/housekeeping.md`「忘却」）。
- `--record-pending` は `extract --current` と同時に指定した場合だけ受け付ける。通常の抽出の承認フローは変えず、apply / archive / delete は行わない。
- 抽出はコミット前のチェックからも起動される。未抽出の活動があり、transcript に候補が見つかるか、安全に判定できないと、PreToolUse のチェックが `git commit` を止めて `kaizen --current` を促す。
  候補が 0 件だと確かめられた場合は、そのまま通す。コミットのときにデフォルトで行うのは抽出と記録までで、apply はユーザーが今すぐ適用すると選んだ場合だけ続ける。

## 前提

- ツール: `git`
- 前提スキル: `multiagent-setup`（Hook とドキュメントの整備のセットアップで使う。`references/setup.md` 参照）。学びを反映したスキルの検証に `skill-creator` も使えるが、必須ではない
- MCP: なし
- シェル: bash（POSIX 互換シェル）。このスキルのコマンド例と、設定する Hook（`mkdir -p` / `date -u` 等）は bash を前提にしている。Windows では WSL / Git Bash 等の bash 環境で実行する
- node / pnpm / python などのランタイムは要らない。transcript の候補を速く探すために `jq` があれば使い、無い場合は判定できないものとして扱い、コミットを止める。

## 基本原則

- 根本原因を分析する。個別の失敗に対策するのではなく、その失敗が起きた理由を分析し、原因に対策する。
- できるだけ決定論的な仕組みで再発を防ぐ。エージェントの挙動は確率的なので、ルールやドキュメントでの指示だけに頼らない。リンター・フォーマッター・pre-commit フック・スクリプトなどの決定論的なチェックを優先して使う。
- 学びはエージェント間で共有する。`.kaizen/` に保存した学びは、プロジェクト内のすべてのエージェント（Claude Code / Codex / GitHub Copilot）が参照できる。あるエージェントで得た学びを、他のエージェントでも生かす。
- 学びはプロジェクト単位で扱う。`.kaizen/` ディレクトリに保存し、このプロジェクトに適用する。

## フロー

### Step 1: 操作の特定

「使い方」のコマンドまたは自然文から、抽出・適用・忘却・整理（アーカイブ・削除）・セットアップのどれかを判定する。判定できないときは AskUserQuestion で確認する。
整理の対象フラグ（`--applied` 等）が省略されたときは、対象を AskUserQuestion で確認する。

### Step 2: コンポーネントの実行

操作に対応するコンポーネントファイルを Read ツールで読み込み、その手順に従う。

- 学び抽出 → `references/extract.md`
- 学び適用 → `references/apply.md`
- 忘却・整理（アーカイブ・削除）→ `references/housekeeping.md`
- セットアップ → `references/setup.md`

コンポーネントファイルは、SKILL.md と同じディレクトリの `references/` の下にある。インストール先に応じて、次の場所を順に試す。

- `~/.claude/skills/kaizen/references/<file>.md`
- `.claude/skills/kaizen/references/<file>.md`
- `.agents/skills/kaizen/references/<file>.md`

### Step 3: セットアップ（インストール後・初回のみ）

`references/setup.md` を Read ツールで読み込み、その手順に従う。kaizen を自動で回すための設定をまとめている。

- 3 つの Hook（終了時のセンチネルの記録、コミット前の PreToolUse のチェック、セッション開始時の参照の注入）
- 基底ドキュメント（`AGENTS.md` 等）への、自己設定の編集の制約の追記
- `.gitignore` への一時ファイルの除外
- `multiagent-setup` への依存

任意で、pending の棚卸しを週次で Issue にする定期実行（GitHub Actions。同梱テンプレート `assets/kaizen-schedule.yml`）も同じガイドにある。

---

## 出典

根本原因分析の要素（繰り返しの深掘り・KEDB 照合・横断スコープの確認）は、[karaage0703/ai-assistant-workspace の xangi-kaizen スキル](https://github.com/karaage0703/ai-assistant-workspace/tree/main/skills/xangi-kaizen) を参考に取り入れた。
