---
date: 2026-06-08
type: rule
priority: high
status: applied
session: claude-code
---

## 事象

PR #13 で全6スキルの `skills/<name>/SKILL.md` に「前提」節を追加したが、`.agents/skills/`（リポジトリ内の installed copy）は
`references/` 移設をした multiagent-setup / kaizen の2つしか `reinstall-skill.sh` で再同期せず、**残り4スキル（issue-create / issue-start /
pr-review-handle / dependabot-merge）の `.agents/skills/<name>/SKILL.md` が stale のまま**になった。Copilot レビューで「installed copy が
更新されていない」と4件指摘された。

## 根本原因

最低 3 階層の「なぜ」:

- なぜ installed copy が古いままか? → 編集したスキルのうち2つしか `reinstall-skill.sh` を実行しなかったため。
  - なぜ実行漏れが起きたか? → 「前提」節の追加は全6スキルに及ぶのに、再同期は `references/` を触った2スキルだけ意識していたため。
    - なぜ漏れが検知されずに通ったか? → `skills/`（配布元）→ `.agents/skills/`（dogfood 実体）の同期が**手動・スキル単位**（`reinstall-skill.sh <name>` を1つずつ）で、**ドリフトを検出する決定論的な仕組みが無い**ため。← 根本原因

KEDB 照合: 関連 [[2026-06-08-eval-isolation-cd-not-persisted]]（同 PR の別失敗）。横断スコープ: 二重コピー（source + installed）を持つ構造すべてに共通する drift リスク。

## 提案

source と installed の同期を**決定論的に検証**する。適用済み（本 PR）:

- `scripts/check-skills-sync.mjs`: `skills/<name>/` と `.agents/skills/<name>/` のドリフト（SKILL.md は frontmatter 正規化を考慮、他ファイルは byte 一致）を検出し非ゼロ終了。
- lefthook pre-commit と CI Lint（`.github/workflows/ci.yml`）に組み込み、再同期漏れのコミットをブロック。
- `scripts/reinstall-skill.sh --all` を追加し、全スキルを一括再同期できるようにした。

教訓（一般化）: **source と派生コピーの二重管理は、手動同期だけに頼らず決定論的な drift チェックでゲートする。**
