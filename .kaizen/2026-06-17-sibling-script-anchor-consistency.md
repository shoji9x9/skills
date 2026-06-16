---
date: 2026-06-17
type: rule
priority: medium
status: pending
session: claude-code
---

## 事象

Issue #34 で `kaizen-archive.sh` の「サブディレクトリ実行で stray `.kaizen/` を作る」不具合を直す際、
`.kaizen/` を **git トップレベル**にアンカーする実装を入れた。しかし同じ `.kaizen/` を扱う姉妹スクリプト
`kaizen-context-inject.sh` / `kaizen-precommit-gate.sh` は **cwd 相対**（Claude Code がフックを起動する
プロジェクトルート）で `.kaizen/` を解決している。基準が食い違うため、プロジェクトルートが git リポジトリの
サブディレクトリになっているネスト構成では、archive だけ別の `.kaizen/` を操作してしまう。
自分の code-review（consistency 観点）で検出し、`$CLAUDE_PROJECT_DIR` 優先（未設定なら git ルート、
git 外は cwd）に統一して解消した。

## 根本原因

最低 3 階層の「なぜ」:

1. なぜ基準が食い違ったか → archive にパス解決を新規実装する際、同じ `.kaizen/` を扱う他スクリプトの
   解決方法を確認せず、その場で妥当に見えた git トップレベルを選んだから。
2. なぜ確認しなかったか → 「同じ `.kaizen/` を複数スクリプトが共有する」前提がコードにもドキュメントにも
   明示されておらず、横断確認の必要に気づきにくいから。
3. なぜ気づきにくいか → 単体テストでは root==toplevel で必ず一致し、ネスト構成でしか差が出ない（潜在的）。
   ← 根本原因。

KEDB 照合: consistency 系の系譜（`2026-06-09-intra-doc-consistency-pass`＝同一ドキュメント内の用語・構造統一）
の、**スクリプト群 × パス解決基準**への新形態。`2026-06-16-relative-path-hook-cd-stray-sentinel`（相対パス
× cd の落とし穴／絶対パス・固定基準を使え）とも同根。

横断スコープ: `.kaizen/` を読む他の経路（参照注入・コミットゲート・将来追加するスクリプト）も同じ基準
（プロジェクトルート ＝ `$CLAUDE_PROJECT_DIR`）に揃えるべき。

## 提案

ルール文面（`.agents/rules/` 候補 or AGENTS.md 追記）:

> 同じリソース（特に `.kaizen/` のような共有ディレクトリ）を扱うスクリプトが複数あるときは、その解決基準
> （アンカー）を**統一**する。新しくパス／ディレクトリ解決を追加するスクリプトは、既存の姉妹スクリプトが
> どの基準で解決しているかを先に確認し、合わせる。kaizen 系では `$CLAUDE_PROJECT_DIR`（未設定なら
> `git rev-parse --show-toplevel`、git 外は cwd）をプロジェクトルートの基準とする。

適用状況: `kaizen-archive.sh` は `$CLAUDE_PROJECT_DIR` 優先に修正済み（Issue #34）。残りの横断確認
（`kaizen-context-inject.sh` / `kaizen-precommit-gate.sh` を共通の解決ヘルパーへ寄せるか、フックは常に
プロジェクトルート cwd で起動される前提を doc 化するか）は apply フローで検討する。
