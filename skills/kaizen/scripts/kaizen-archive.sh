#!/usr/bin/env bash
# kaizen archive helper
#
# 学びの整理（アーカイブ）で「ファイル移動」と「サマリー索引 INDEX.md の再生成」を
# 1 コマンドに畳み込み、索引更新の取りこぼし（手動ステップの飛ばし）を防ぐ。
# INDEX.md は KEDB 照合（references/extract.md）がアーカイブ済みノートを
# サマリーだけで照合するための索引。本文は載せないのでコンテキストを圧迫しない。
#
#   kaizen-archive.sh FILE...     FILE を .kaizen/archive/ へ移動し INDEX.md を再生成する
#   kaizen-archive.sh --reindex   .kaizen/archive/INDEX.md だけを再生成する（削除後の同期用）
#
# 索引は archive/*.md の frontmatter から毎回作り直す（追記管理せず再生成＝drift・二重管理なし）。
# 移動は git 管理下なら履歴を残す git mv、管理外なら mv を使う。
# 詳細手順は references/housekeeping.md を参照。
set -euo pipefail

kaizen_dir=".kaizen"
archive_dir="${kaizen_dir}/archive"

# archive/*.md の frontmatter と要約から INDEX.md を作り直す。
regenerate_index() {
	mkdir -p "${archive_dir}"
	{
		echo "# アーカイブ済みの学び（サマリー索引）"
		echo ""
		for f in "${archive_dir}"/*.md; do
			[ -e "${f}" ] || continue
			[ "$(basename "${f}")" = "INDEX.md" ] && continue
			meta=$(grep -E "^(date|type|priority):" "${f}" 2>/dev/null | tr '\n' ' ' || true)
			# 優先: 「## 事象」見出し直後の最初の非空行。
			summary=$(awk '/^## 事象/{flag=1; next} flag && NF {print; exit}' "${f}" 2>/dev/null || true)
			# フォールバック: 見出しが無いフォーマットなら、frontmatter 以降の最初の本文行を使う。
			if [ -z "${summary}" ]; then
				summary=$(awk 'BEGIN{fm=0} /^---[[:space:]]*$/{fm++; next} fm>=2 && NF && $0 !~ /^#/ {print; exit}' "${f}" 2>/dev/null || true)
			fi
			# 80 文字に切り詰め。bash のパラメータ展開は UTF-8 ロケールで文字単位なので
			# 日本語をバイト境界で割らない（mawk の substr / cut -c はバイト単位で割れる）。
			summary=${summary:0:80}
			echo "- \`$(basename "${f}")\` — ${meta}— ${summary}"
		done
	} >"${archive_dir}/INDEX.md"
}

if [ "$#" -eq 0 ]; then
	{
		echo "usage: kaizen-archive.sh FILE...    # move FILEs into ${archive_dir} and rebuild INDEX.md"
		echo "       kaizen-archive.sh --reindex  # only rebuild ${archive_dir}/INDEX.md"
	} >&2
	exit 2
fi

if [ "$1" = "--reindex" ]; then
	regenerate_index
	echo "reindexed ${archive_dir}/INDEX.md"
	exit 0
fi

mkdir -p "${archive_dir}"
archive_abs=$(cd "${archive_dir}" && pwd)
moved=0
for f in "$@"; do
	if [ ! -f "${f}" ]; then
		echo "skip (not a file): ${f}" >&2
		continue
	fi
	# 既に archive 配下のファイルはスキップする。同一ディレクトリへの mv は失敗し、
	# set -e で INDEX 再生成前に終了してしまうため（冪等に・安全に実行できるようにする）。
	if [ "$(cd "$(dirname "${f}")" && pwd)" = "${archive_abs}" ]; then
		echo "skip (already archived): ${f}" >&2
		continue
	fi
	if git ls-files --error-unmatch "${f}" >/dev/null 2>&1; then
		git mv -- "${f}" "${archive_dir}/"
	else
		mv -- "${f}" "${archive_dir}/"
	fi
	moved=$((moved + 1))
done

regenerate_index
echo "archived ${moved} file(s) into ${archive_dir} and rebuilt INDEX.md"
