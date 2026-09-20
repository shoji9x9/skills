---
date: 2026-06-08
type: doc
priority: high
status: applied
session: claude-code
---

## 事象

実開発セッション複数（`5a15e3c6` / `0b949947` / `fd4d7506` ほか）で、エージェントが **npm を前提**にコマンド・CI・lefthook 設定を提案し、ユーザーが繰り返し修正した:

- 「このリポジトリーでは npm ではなく **pnpm** を利用したい」
- 「**prettier** はできれば利用したくありません」
- 「`./node_modules/.bin/oxfmt` のような書き方は避けたい。本当に **lefthook で pnpm を使えない**のでしょうか？」

同種の修正が複数セッションにまたがって**繰り返し**発生している。

## 根本原因

最低 3 階層の「なぜ」（証拠付き）:

- なぜ npm を前提にしたか? → このリポジトリのパッケージマネージャがエージェント向けドキュメントに明文化されていないため。
  - なぜ明文化されていないか? → `AGENTS.md`「技術スタック」に環境管理（mise）は記載があるが、**PM（pnpm）の記載が欠落**している（`AGENTS.md:10-14`）。
    - なぜ放置されたか? → リポジトリには `packageManager: pnpm@11.5.0`（`package.json`）と `pnpm-lock.yaml` という決定論的な手掛かりがあるのに、**エージェントに必ず読ませる／npm 誤用を検出する決定論的なゲートが無い**ため。← 根本原因

KEDB 照合: 該当する既存の学びなし（新規）。
横断スコープ: npm 前提は各 `skills/<name>/SKILL.md` のコマンド例・lefthook 設定（ハードパス `node_modules/.bin`）・CI ワークフローにも混入しうる。lefthook からのツール起動も同根（PATH 上の pnpm/mise shim を解決しない前提の誤解）。

## 提案

エージェントが必ず参照する場所に PM 規約を明文化し、誤用を決定論的にゲートする。

1. **`AGENTS.md`「技術スタック」に追記**（type: doc）:
   - 「**パッケージマネージャ: pnpm**（mise で管理）。正本は `package.json` の `packageManager` フィールドと `pnpm-lock.yaml`。**npm は使わない**。フォーマッタは prettier ではなく markdownlint-cli2 / oxfmt を使う。」
2. **ツール起動の規約**: スクリプト・lefthook・CI ではツールを `./node_modules/.bin/<tool>` のハードパスで叩かず、`pnpm exec <tool>`（または mise の shim）経由で起動する。
3. **宣言的ゲート**: `package.json` の `devEngines.packageManager`（`name: pnpm` / `onFail: warn`）で誤った PM 利用を警告する（`packageManager` フィールドと併用）。

教訓（一般化）: **リポジトリのパッケージマネージャ・フォーマッタ規約は、lockfile/`packageManager` 任せにせず AGENTS.md に明文化し、誤った PM の混入を決定論的にゲートする。**
