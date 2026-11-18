#!/usr/bin/env bash
# 使い捨てのプロジェクトを git のリポジトリにして commit し、サイドバーの検索の部品の変更を commit していない差分として残す。
# --scope uncommitted の eval が、差分のファイルから確かめるページと機能を導く入力になる。
set -euo pipefail
if ! git rev-parse --verify -q HEAD >/dev/null 2>&1; then
	git init -q -b main
	git add -A
	git -c user.name="Eval User" -c user.email="eval@example.invalid" -c commit.gpgsign=false commit -q -m "feat: ノートのアプリ"
fi
sed -i 's/aria-label="ノートを検索"/aria-label="ノートをタイトルで検索"/' src/components/Sidebar/Search.tsx
git diff --quiet -- src/components/Sidebar/Search.tsx && {
	echo "setup: 差分を作れなかった" >&2
	exit 1
}
exit 0
