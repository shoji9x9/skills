---
date: 2026-09-10
type: other
priority: high
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

2026-09-18 に 3 回目の再発。今回の引き金は書き込み権限ではなく**入力の不正**だった——
`skills/kaizen/SKILL.md` の description に `（status: forgotten）` と書いたため、引用符なしの YAML
スカラに `": "` が入り、`failed to install skill "kaizen": could not inject metadata: invalid frontmatter
YAML: yaml: line 2: mapping values are not allowed in this context` で install が失敗した。
このとき `.agents/skills/kaizen/scripts/` は既に削除済みで、`check-skills-sync.js` が 4 件の
`missing in installed copy` を検出した。description を直して再実行すると復旧した。

## 根本原因

1. なぜ一時的な不整合が残ったか → 再インストール処理が symlink を先に削除し、後続の `.agents` 更新で停止した。
2. なぜ後続の失敗前に既存状態を失ったか → 更新対象すべての書き込み可能性を、破壊的な変更より前に検査していなかった。
3. なぜ途中停止から自動回復できなかったか → 複数箇所を同期する処理に事前検査またはロールバックを含むトランザクション境界がない。
4. なぜ入力不正でも既存を失ったか → 事前検査の対象を「書き込み可能性」だけで考えており、
   **入力（frontmatter）の妥当性**を破壊前の検査に入れていなかった。`scripts/check-skill-frontmatter.js` は
   存在するが lefthook pre-commit と CI でしか走らず、スキルを編集した直後に最初に踏むのは `reinstall-skill.sh`。
   失敗の停止点が検査より手前にあるため、検査が存在しても既存状態の保護には効いていない。

KEDB を `reinstall-skill.sh` / `Read-only file system` / `symlink` で照合したが、直接一致はなかった。
横断スコープは、複数のインストール先・索引・symlink を順次更新する再インストール処理とセットアップ処理。

3 回目（2026-09-18）の横断スコープ: 既存の成果物を消してから作り直す処理すべて。
`reinstall-skill.sh` のほか、索引を作り直す `kaizen-archive.sh --reindex`（`>` で INDEX.md を開いてから
生成するため、生成中の失敗で索引が空になる）が同じ形を持つ。

## 提案

複数箇所を同期する再インストール処理は、既存状態を削除する前に全更新先の書き込み可能性を検査し、途中失敗時も既存インストールを保持する。

`scripts/reinstall-skill.sh` に更新先の事前検査を追加し、検査に失敗した場合は既存の
`.agents/skills/<name>` と `.claude/skills/<name>` を変更せず非 0 で停止する。
書き込み可能な一時領域で新しい状態を組み立ててから置換する方式、または失敗時のロールバックも検討する。

**事前検査の対象は書き込み可能性だけでなく入力の妥当性まで広げる。** `reinstall-skill.sh` は破壊的な
操作へ進む前に `node scripts/check-skill-frontmatter.js` 相当の検査を対象スキルに通し、落ちたら
既存の installed copy を一切触らずに非 0 で停止する。これで「編集直後に最初に踏むのが reinstall」
という順序のまま、検査が既存状態の保護に効くようになる。
