#!/usr/bin/env bash
# 新側のリポジトリ（設定の new.repo: ./new-app）を git で作り、記録の new.commit などをその HEAD にそろえる。
# verify の手順 7 は、収束を判定する直前に新側の HEAD と作業ツリーの状態を取得し直すので、新側のリポジトリが要る。
set -euo pipefail

if [ -d new-app/.git ]; then
	exit 0
fi

mkdir -p new-app
git -C new-app init -q -b main
git -C new-app config user.name "Eval User"
git -C new-app config user.email "eval@example.invalid"
printf '%s\n' '# 新側の実装（eval の fixture）' >new-app/README.md
git -C new-app add README.md
GIT_AUTHOR_DATE='2026-05-02T00:00:00Z' GIT_COMMITTER_DATE='2026-05-02T00:00:00Z' \
	git -C new-app -c commit.gpgsign=false commit -q -m 'feat: 注文一覧の新側の実装'
sha=$(git -C new-app rev-parse --verify HEAD)
case "$sha" in
*[!0-9a-f]* | '') echo "setup: 新側の HEAD を読めない: $sha" >&2 && exit 1 ;;
esac

# 記録に書いた仮のバージョンを、作ったリポジトリの HEAD に置き換える
placeholder=abc1234def5678
files=$(grep -rl --include='*.json' --include='*.md' "$placeholder" .replace)
[ -n "$files" ] || { echo "setup: $placeholder を含む記録が無い" >&2 && exit 1; }
printf '%s\n' "$files" | while IFS= read -r f; do
	sed -i "s/$placeholder/$sha/g" "$f"
done
if grep -rq "$placeholder" .replace; then
	echo "setup: $placeholder が残っている" >&2
	exit 1
fi
