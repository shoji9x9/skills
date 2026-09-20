---
date: 2026-06-10
type: rule
priority: medium
status: applied
session: claude-code
---

## 事象

Issue #18 対応で `skills/` 配下 5 ファイルを編集した後、`scripts/reinstall-skill.sh` による
インストール済みコピー（`.agents/skills/`）の再同期を実行せず、ユーザーの指摘で初めて実行した。

## 根本原因

- なぜ再インストールしなかったか? → 実装フェーズの手順に再インストールが含まれていなかった。
  - なぜ手順を参照しなかったか? → issue-start の規約解決は AGENTS.md を「ブランチ/commit」キーワードで
    grep するだけで、ワークフローへのポインタ（AGENTS.md「詳細手順は docs/skill-development.md を参照」）は
    キーワードに合致せず読まれなかった。
    - なぜ編集時に気づける仕組みが無いのか? → 「skills/ を編集したら再インストール」の指示が
      `docs/skill-development.md` にしか無く、`skills/**` 編集時にエージェントへ注入されるルールが
      存在しなかった。← 根本原因

KEDB 照合: [[2026-06-08-skills-agents-sync-drift]]（applied）と同軸（skills/ ↔ .agents/skills の同期）。
同エントリの決定論ゲート（lefthook / CI の `skills-sync`）は機能しており commit 時には必ず捕まるが、
「編集直後の再同期」を促す編集時の仕組みが欠けていた。applied ファイルには追記せず、恒久側を直接更新した。

## 提案（適用済み）

`.agents/rules/skill-reinstall.md`（`paths` / `applyTo` を `skills/**` にスコープ）を作成し、
`.claude/rules/` と `.github/instructions/` にシンボリックリンク、AGENTS.md の参照ルールガイドに追記して
3 エージェントへ配線した。
