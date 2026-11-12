#!/usr/bin/env bash
# 新側のリポジトリ（設定の new.repo: ./new-app）を git で作り、記録の new.commit をその HEAD に、new.tree などをその HEAD のツリーにそろえる。
# .replace/ は new-app の外にあるので、new.tree（replace-strategy の references/project-config.md「新側のバージョンの記録」）は HEAD のツリーのハッシュと同じになる。
# verify の手順 7 は、収束を判定する直前に新側の HEAD と作業ツリーの状態を取得し直すので、新側のリポジトリが要る。
# verify-unapproved/setup.sh と verify-overflow/setup.sh は同じ中身である（scripts/gates/packaging/copies/identical-copies.json）。
set -euo pipefail

# 前の実行が途中で止まっていても、置き換えまで進める。次のどれかに当たれば作り直す。
# new-app 自身がリポジトリの最上位でない・HEAD を読めない・commit していない変更がある（mkdir や commit の前で止まった場合と、手で試した後を含む）。
# git -C は new-app に .git が無いと親のリポジトリを読むので、最上位を比べる。CDPATH が設定されていると cd がパスを出すので外す
top=$(git -C new-app rev-parse --show-toplevel 2>/dev/null || true)
here=$(CDPATH='' cd -- new-app 2>/dev/null && pwd -P || true)
if [ -z "$here" ] || [ "$top" != "$here" ] || ! git -C new-app rev-parse --verify -q HEAD >/dev/null 2>&1 ||
	[ -n "$(git -C new-app status --porcelain 2>/dev/null || echo unreadable)" ]; then
	rm -rf new-app
	mkdir -p new-app
	git -C new-app init -q -b main
	git -C new-app config user.name "Eval User"
	git -C new-app config user.email "eval@example.invalid"
	printf '%s\n' '# 新側の実装（eval の fixture）' >new-app/README.md
	git -C new-app add README.md
	GIT_AUTHOR_DATE='2026-05-02T00:00:00Z' GIT_COMMITTER_DATE='2026-05-02T00:00:00Z' \
		git -C new-app -c commit.gpgsign=false commit -q -m 'feat: 注文一覧の新側の実装'
fi
sha=$(git -C new-app rev-parse --verify HEAD)
case "$sha" in
*[!0-9a-f]* | '') echo "setup: 新側の HEAD を読めない: $sha" >&2 && exit 1 ;;
esac
tree=$(git -C new-app rev-parse --verify 'HEAD^{tree}')
case "$tree" in
*[!0-9a-f]* | '') echo "setup: 新側の HEAD のツリーを読めない: $tree" >&2 && exit 1 ;;
esac

# 記録に書いた仮のバージョンを、作ったリポジトリの HEAD と HEAD のツリーに置き換える
placeholder=abc1234def5678
tree_placeholder=def5678abc1234
# grep の終了コードは、1 が該当なし、2 が読めない。2 は該当なしとして扱わずに止まる
rc=0
files=$(grep -rlE --include='*.json' --include='*.md' "$placeholder|$tree_placeholder" .replace) || rc=$?
if [ "$rc" -gt 1 ]; then
	echo "setup: .replace を読めない（grep の終了コード $rc）" >&2
	exit 1
fi
if [ -n "$files" ]; then
	printf '%s\n' "$files" | while IFS= read -r f; do
		sed -i -e "s/$placeholder/$sha/g" -e "s/$tree_placeholder/$tree/g" "$f"
	done
fi
# 置き換えの後の確かめも、終了コードを保存して分ける。0 は残っている、2 は読めない
rc=0
grep -rqE "$placeholder|$tree_placeholder" .replace || rc=$?
case "$rc" in
0)
	echo "setup: $placeholder か $tree_placeholder が残っている" >&2
	exit 1
	;;
1) ;;
*)
	echo "setup: 置き換えの後に .replace を読めない（grep の終了コード $rc）" >&2
	exit 1
	;;
esac
# 置き換えた後の記録が、作ったリポジトリの HEAD と HEAD のツリーを指していることを確かめる。1 は無い、2 は読めない
for want in "$sha" "$tree"; do
	rc=0
	grep -rq "$want" .replace || rc=$?
	case "$rc" in
	0) ;;
	1)
		echo "setup: 記録に新側のバージョン（$want）が無い" >&2
		exit 1
		;;
	*)
		echo "setup: バージョンを確かめるときに .replace を読めない（grep の終了コード $rc）" >&2
		exit 1
		;;
	esac
done
