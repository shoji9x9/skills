---
date: 2026-06-22
type: doc
priority: medium
status: pending
session: claude-code
---

## 事象

`actions/checkout@v4.3.1`（node20 ターゲット）が出す Node.js 20 非推奨警告が、複数の
CI run にわたり誰にも気付かれず蓄積していた（Issue #51）。ジョブは成功するため警告は
annotation として残るだけで、ユーザーが run ログを見て初めて発覚した。解消には
v4 → v7 の **major bump** が必要だった。

## 根本原因

major 更新を自動で可視化する仕組みが一切ないこと。

- `dependabot.yml` は **npm / github-actions の両エコシステムで** major を明示的に除外:
  `ignore: [{ dependency-name: "*", update-types: ["version-update:semver-major"] }]`
- `outdated.yml`（mise ツール）も `current` と `bump/latest` のメジャー番号が一致する
  項目だけを残し、major を意図的に除外している。

意図は「破壊的変更を伴う major を自動 PR / 自動通知しない」ことで妥当。しかし副作用として、
**ランタイム非推奨（例: node20→node24）のように major bump でしか解消できない問題**が、
Dependabot からも outdated workflow からも一切シグナルが出ず、非失敗の CI 警告として
静かに溜まり続ける。同じ構造の見落としは、今後どのアクション / ツールの major 起因の
非推奨でも再発する。

## 提案

major 更新を「自動マージはしないが、可視化はする」状態にする。決定論的な仕組みを優先する。

- 案 A（推奨・軽量）: `outdated.yml` と同型の「major 更新を FYI として 1 件の Issue に
  集約する」定期ワークフローを足す（自動 PR でなく Issue 通知のみ）。github-actions と
  npm の major を対象に、既存 Issue があれば更新・無くなれば close する outdated.yml の
  パターンを流用する。
- 案 B: `AGENTS.md` の依存更新運用に「major 更新は Dependabot / outdated いずれも対象外。
  ランタイム非推奨等は手動で追跡する必要がある」と明記し、定期レビューの導線を残す。
- いずれにせよ、横断スコープ: npm 側の major にも同じ盲点があるため、対策は github-actions
  だけでなく npm も対象に含める。
