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

# .kaizen/ はプロジェクトルート直下に置く前提。サブディレクトリで実行されても、その cwd 配下に
# 別の .kaizen/ を作ってしまわないよう、ルートへ移動してから .kaizen/ を解決する。
# アンカーは姉妹スクリプト（kaizen-context-inject.sh / kaizen-precommit-gate.sh）と揃える:
# それらは cwd（= Claude Code がフックを起動するプロジェクトルート）相対で .kaizen/ を見るため、
# 同じ基準になる $CLAUDE_PROJECT_DIR を最優先する。未設定（Codex/Copilot/手動）なら git ルート、
# git 管理外なら従来どおり cwd を基準にする。
# FILE 引数は移動前の cwd を基準に絶対パス化するので、どのディレクトリから渡しても解決できる。
orig_pwd=$(pwd)
orig_pwd=${orig_pwd%/} # 末尾スラッシュ（cwd が / のとき）を除き、resolve_path で // を作らない
project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
if [ -n "${project_root}" ]; then
	cd "${project_root}"
fi

# 移動前の cwd を基準にパス引数を絶対パス化する（ルートへ cd した後も相対パスが効くように）。
resolve_path() {
	case "$1" in
	/*) printf '%s' "$1" ;;
	*) printf '%s/%s' "${orig_pwd}" "$1" ;;
	esac
}

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
			# frontmatter（最初の `---` ブロック）内の date/type/priority だけを拾う。
			# ファイル全体への grep だと本文中の `type:` 等まで索引へ混入するため範囲を区切る。
			# 行は一旦バッファし、閉じフェンス `---` を確認できたときだけ出力する。
			# こうすると閉じフェンスを欠く不正 frontmatter では本文まで走査せず meta を空にできる。
			meta=$(awk '
				/^---[[:space:]]*$/ {
					fm++
					if (fm >= 2) { printf "%s", buf; exit }
					next
				}
				fm == 1 && /^(date|type|priority):/ { buf = buf $0 " " }
			' "${f}" 2>/dev/null || true)
			# 優先: 「## 事象」見出し直後の最初の非空行。
			summary=$(awk '/^## 事象/{flag=1; next} flag && NF {print; exit}' "${f}" 2>/dev/null || true)
			# フォールバック: 見出しが無いフォーマットなら、frontmatter 以降の最初の本文行を使う。
			if [ -z "${summary}" ]; then
				summary=$(awk 'BEGIN{fm=0} /^---[[:space:]]*$/{fm++; next} fm>=2 && NF && $0 !~ /^#/ {print; exit}' "${f}" 2>/dev/null || true)
			fi
			# 80 文字に切り詰め。bash のパラメータ展開は UTF-8 ロケールでは文字単位なので
			# 日本語をバイト境界で割らない（mawk の substr / cut -c はバイト単位で割れる）。
			# 非 UTF-8 ロケールではバイト単位になり UTF-8 を壊しうるため、UTF-8 のときだけ切り詰める。
			# python 等の追加ランタイムには依存しない方針なので、非 UTF-8 では切り詰めず安全側に倒す。
			if locale charmap 2>/dev/null | grep -qi 'utf-\{0,1\}8'; then
				summary=${summary:0:80}
			fi
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
for arg in "$@"; do
	f=$(resolve_path "${arg}")
	if [ ! -f "${f}" ]; then
		echo "skip (not a file): ${arg}" >&2
		continue
	fi
	# 既に archive 配下のファイルはスキップする。同一ディレクトリへの mv は失敗し、
	# set -e で INDEX 再生成前に終了してしまうため（冪等に・安全に実行できるようにする）。
	if [ "$(cd "$(dirname "${f}")" && pwd)" = "${archive_abs}" ]; then
		echo "skip (already archived): ${arg}" >&2
		continue
	fi
	# 移動先に同名がある場合はスキップする。mv / git mv は後勝ちで上書きし、非破壊の
	# アーカイブのはずが黙ってファイルを失う（同名 basename の同時アーカイブ・既存衝突）。
	dest="${archive_dir}/$(basename "${f}")"
	if [ -e "${dest}" ]; then
		echo "skip (name collision in archive): ${arg} -> ${dest}" >&2
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
