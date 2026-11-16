#!/usr/bin/env bash
# 現行のリポジトリ（設定の current.repo: ./current-app）を git で作り、2 つの commit を置く。
# 記録（.replace/ の target と current）は 1 つ目の commit のバージョンを指し、HEAD は 2 つ目の commit に進んでいる。
# .replace/ は current-app の外にあるので、記録の tree（replace-strategy の references/project-config.md「現行側のバージョンの記録」）は
# 1 つ目の commit のツリーのハッシュと同じになる。
set -euo pipefail

# 前の実行が途中で止まっていても作り直す。current-app 自身がリポジトリの最上位でないか、commit が 2 つでなければ作り直す
top=$(git -C current-app rev-parse --show-toplevel 2>/dev/null || true)
here=$(CDPATH='' cd -- current-app 2>/dev/null && pwd -P || true)
count=$(git -C current-app rev-list --count HEAD 2>/dev/null || echo 0)
if [ -z "$here" ] || [ "$top" != "$here" ] || [ "$count" != 2 ] ||
	[ -n "$(git -C current-app status --porcelain 2>/dev/null || echo unreadable)" ]; then
	rm -rf current-app
	mkdir -p current-app/src
	git -C current-app init -q -b main
	git -C current-app config user.name "Eval User"
	git -C current-app config user.email "eval@example.invalid"
	printf '%s\n' "export const formatDate = (d: Date) => d.toISOString().slice(0, 10);" >current-app/src/orders.ts
	git -C current-app add src/orders.ts
	GIT_AUTHOR_DATE='2026-06-01T00:00:00Z' GIT_COMMITTER_DATE='2026-06-01T00:00:00Z' \
		git -C current-app -c commit.gpgsign=false commit -q -m 'feat: 注文一覧を作る'
	printf '%s\n' "export const formatDate = (d: Date) => d.toLocaleDateString('ja-JP');" >current-app/src/orders.ts
	git -C current-app add src/orders.ts
	GIT_AUTHOR_DATE='2026-07-10T00:00:00Z' GIT_COMMITTER_DATE='2026-07-10T00:00:00Z' \
		git -C current-app -c commit.gpgsign=false commit -q -m 'fix: 注文一覧の日付を和暦の書式で表示する'
fi
sha=$(git -C current-app rev-parse --verify 'HEAD~1')
tree=$(git -C current-app rev-parse --verify 'HEAD~1^{tree}')
for v in "$sha" "$tree"; do
	case "$v" in
	*[!0-9a-f]* | '') echo "setup: 1 つ目の commit を読めない: $v" >&2 && exit 1 ;;
	esac
done

# 記録に書いた仮のバージョンを、1 つ目の commit とそのツリーに置き換える
placeholder=aaa1111bbb2222
tree_placeholder=ccc3333ddd4444
for f in .replace/parity/order-list/metadata.json .replace/dataset/metadata.json; do
	[ -f "$f" ] || { echo "setup: $f が無い" >&2 && exit 1; }
	sed -i -e "s/$placeholder/$sha/g" -e "s/$tree_placeholder/$tree/g" "$f"
	# 置き換えた後に、記録が 1 つ目の commit とツリーを指していることを確かめる（1 は無い、2 は読めない）
	for want in "$sha" "$tree"; do
		rc=0
		grep -q "$want" "$f" || rc=$?
		if [ "$rc" -ne 0 ]; then
			echo "setup: $f に $want が無い（grep の終了コード $rc）" >&2
			exit 1
		fi
	done
done
