---
date: 2026-09-10
type: other
priority: medium
status: pending
applied-to: []
session: codex
---

# 再インストール失敗時に既存のインストール状態を保持する

## 事象

`scripts/reinstall-skill.sh kaizen` が `.agents/skills/kaizen` の書き込み拒否で失敗する前に、
`.claude/skills/kaizen` の symlink を削除し、一時的にインストール済みコピーが不整合になった。
承認付きの sandbox 外実行で再実行すると同期は完了した。

2026-09-11 に `scripts/reinstall-skill.sh parity-suite` でも再発した。複数コマンドをまとめた sandbox 内実行で
`.agents/skills/parity-suite` の削除が書き込み拒否になった一方、先に `.claude/skills/parity-suite` が削除され、
`check-skills-sync.js` が symlink 欠落と installed copy の drift を検出した。承認付きの単独再実行で復旧した。

## 根本原因

1. なぜ一時的な不整合が残ったか → 再インストール処理が symlink を先に削除し、後続の `.agents` 更新で停止した。
2. なぜ後続の失敗前に既存状態を失ったか → 更新対象すべての書き込み可能性を、破壊的な変更より前に検査していなかった。
3. なぜ途中停止から自動回復できなかったか → 複数箇所を同期する処理に事前検査またはロールバックを含むトランザクション境界がない。

KEDB を `reinstall-skill.sh` / `Read-only file system` / `symlink` で照合したが、直接一致はなかった。
横断スコープは、複数のインストール先・索引・symlink を順次更新する再インストール処理とセットアップ処理。

## 提案

複数箇所を同期する再インストール処理は、既存状態を削除する前に全更新先の書き込み可能性を検査し、途中失敗時も既存インストールを保持する。

`scripts/reinstall-skill.sh` に更新先の事前検査を追加し、検査に失敗した場合は既存の
`.agents/skills/<name>` と `.claude/skills/<name>` を変更せず非 0 で停止する。
書き込み可能な一時領域で新しい状態を組み立ててから置換する方式、または失敗時のロールバックも検討する。
