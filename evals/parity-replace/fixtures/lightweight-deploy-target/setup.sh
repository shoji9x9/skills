#!/usr/bin/env bash
# 新側（設定の new.repo: ./new-app）を git のリポジトリにし、local-dev の記録の new.commit と new.tree を、その commit の値にする。
# 記録は 2 つ目の commit に入れるので、HEAD は記録の new.commit より 1 つ進み、new.tree は記録と同じになる。作業ツリーは clean である。
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

# 記録の commit の値は、記録を入れる前の commit にする（記録の commit で HEAD が進んでも new.tree は変わらない）
sha=$(git rev-parse --verify HEAD)
tree=$(git rev-parse --verify HEAD:new-app)
for v in "$sha" "$tree"; do
	case "$v" in
	*[!0-9a-f]* | '') echo "setup: 新側のバージョンを読めない: $v" >&2 && exit 1 ;;
	esac
done
# 仮の値を置き換え、置き換えた後に仮の値が残っていないことを確かめる（grep の終了コードは 0 が残っている、1 が無い）
sed -i -e "s/abc1234def5678/$sha/" -e "s/9f2c4e1a7b3d5c6e8f0a1b2c3d4e5f6a7b8c9d0e/$tree/" "$record"
rc=0
grep -qE 'abc1234def5678|9f2c4e1a7b3d5c6e8f0a1b2c3d4e5f6a7b8c9d0e' "$record" || rc=$?
if [ "$rc" -ne 1 ]; then
	echo "setup: $record の仮の値を置き換えられない（grep の終了コード $rc）" >&2
	exit 1
fi
git add -- .replace .config
GIT_AUTHOR_DATE='2026-05-01T01:00:00Z' GIT_COMMITTER_DATE='2026-05-01T01:00:00Z' \
	git -c commit.gpgsign=false commit -q -m 'chore: local-dev の green の記録'
