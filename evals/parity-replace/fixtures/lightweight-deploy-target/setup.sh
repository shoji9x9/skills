#!/usr/bin/env bash
# new-app と記録（.replace/）を git のリポジトリに入れ、記録の仮の commit と tree を new-app の commit の値に置き換える。
set -euo pipefail

record=.replace/parity/order-list/new/local-dev/replace-metadata.json

git init -q -b main
git config user.name "Eval User"
git config user.email "eval@example.invalid"
mkdir -p new-app/src
printf '%s\n' 'export const title = "注文一覧";' >new-app/src/order-list.ts
git add -- new-app
GIT_AUTHOR_DATE='2026-05-01T00:00:00Z' GIT_COMMITTER_DATE='2026-05-01T00:00:00Z' \
	git -c commit.gpgsign=false commit -q -m 'feat: 注文一覧の新側の実装'

sha=$(git rev-parse --verify HEAD)
tree=$(git rev-parse --verify HEAD:new-app)
for v in "$sha" "$tree"; do
	case "$v" in
	*[!0-9a-f]* | '') echo "setup: 新側のバージョンを読めない: $v" >&2 && exit 1 ;;
	esac
done
# sed -i は GNU と BSD で引数が違うので、別のファイルに書いてから置き換える
sed -e "s/abc1234def5678/$sha/" -e "s/9f2c4e1a7b3d5c6e8f0a1b2c3d4e5f6a7b8c9d0e/$tree/" "$record" >"$record.tmp"
mv -- "$record.tmp" "$record"
# 仮の値が残っていないことを確かめる（grep の終了コードは 0 が残っている、1 が無い）
rc=0
grep -qE 'abc1234def5678|9f2c4e1a7b3d5c6e8f0a1b2c3d4e5f6a7b8c9d0e' "$record" || rc=$?
if [ "$rc" -ne 1 ]; then
	echo "setup: $record の仮の値を置き換えられない（grep の終了コード $rc）" >&2
	exit 1
fi
git add -- .replace .config setup.sh
GIT_AUTHOR_DATE='2026-05-01T01:00:00Z' GIT_COMMITTER_DATE='2026-05-01T01:00:00Z' \
	git -c commit.gpgsign=false commit -q -m 'chore: local-dev の green の記録'
