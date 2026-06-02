---
date: 2026-06-02
type: skill
priority: high
status: pending
session: claude-code
---

## 事象

kaizen のセットアップや hook 更新で `.claude/settings.json` を編集しようとする
たびに auto モード分類器にブロックされた（「エージェント自身の起動設定の自己
改変」）。本セッション中に複数回発生し、その都度ユーザーに `! cp` で適用して
もらう必要があった。

## 根本原因

`.claude/settings.json` は Claude Code 自身の起動設定で、エージェントの自律編集が
安全ガードで禁止されている。一方 kaizen の SKILL.md Step 3 は「各エージェントの
Hook を設定する」とだけ指示し、Claude Code についてもエージェント自身が
`.claude/settings.json` を書き換える前提になっていた。前提と実際の制約が食い違う。

## 提案

kaizen の SKILL.md / extract.md の Claude Code セットアップ手順に明記する:

- `.claude/settings.json` はエージェントが直接編集できない場合がある（自己改変ガード）。
- その場合は適用すべき JSON を一時ファイルに書き出し、ユーザーに
  `! cp <tmp> .claude/settings.json` での適用を依頼する手順を案内する。
- Codex (`.codex/hooks.json`) / Copilot (`.github/hooks/...`) は直接編集できるため、
  この注意は Claude Code 固有である旨も添える。
