#!/usr/bin/env bash
# 記録（.replace/）と新側（設定の new.repo: ./new-app）を同じ git のリポジトリに置き、記録を commit した後の状態を作る。
# 1 つ目の commit で新側のソースを入れ、記録の仮のバージョンをその commit の値に置き換えてから、記録を 2 つ目の commit に入れる。
# そのため HEAD は記録の new.commit より 1 つ進み、.replace/ を除いた new-app のツリー（new.tree）は記録と同じになる。
set -euo pipefail

placeholder_commit=abc1234def5678
placeholder_tree=9f2c4e1a7b3d5c6e8f0a1b2c3d4e5f6a7b8c9d0e
record=.replace/parity/order-list/new/local-dev/replace-metadata.json

# 作業ディレクトリ自身がリポジトリの最上位でなければ作る。CDPATH が設定されていると cd がパスを出すので外す
top=$(git rev-parse --show-toplevel 2>/dev/null || true)
here=$(CDPATH='' cd -- . && pwd -P)
if [ "$top" != "$here" ]; then
	git init -q -b main
fi
git config user.name "Eval User"
git config user.email "eval@example.invalid"

mkdir -p new-app/src
printf '%s\n' '# 新側の実装（eval の fixture）' >new-app/README.md
printf '%s\n' 'export const title = "注文一覧";' >new-app/src/order-list.ts
git add -- new-app
GIT_AUTHOR_DATE='2026-05-02T00:00:00Z' GIT_COMMITTER_DATE='2026-05-02T00:00:00Z' \
	git -c commit.gpgsign=false commit -q -m 'feat: 注文一覧の新側の実装'

sha=$(git rev-parse --verify HEAD)
tree=$(git rev-parse --verify HEAD:new-app)
for v in "$sha" "$tree"; do
	case "$v" in
	*[!0-9a-f]* | '') echo "setup: 新側のバージョンを読めない: $v" >&2 && exit 1 ;;
	esac
done

sed -i -e "s/$placeholder_commit/$sha/" -e "s/$placeholder_tree/$tree/" "$record"
# 置き換えの後の確かめ。grep の終了コードは、0 が残っている、1 が無い、2 が読めない
for p in "$placeholder_commit" "$placeholder_tree"; do
	rc=0
	grep -q "$p" "$record" || rc=$?
	if [ "$rc" -ne 1 ]; then
		echo "setup: $record の仮の値 $p を置き換えられない（grep の終了コード $rc）" >&2
		exit 1
	fi
done

git add -- .replace
GIT_AUTHOR_DATE='2026-05-02T01:00:00Z' GIT_COMMITTER_DATE='2026-05-02T01:00:00Z' \
	git -c commit.gpgsign=false commit -q -m 'chore: local-dev の green の記録'
