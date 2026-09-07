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
# アンカーは姉妹スクリプト（kaizen-context-inject.sh / kaizen-precommit-gate.sh）と揃える。
# FILE 引数は移動前の cwd を基準に絶対パス化するので、どのディレクトリから渡しても解決できる。
orig_pwd=$(pwd)
orig_pwd=${orig_pwd%/} # 末尾スラッシュ（cwd が / のとき）を除き、resolve_path で // を作らない
kaizen_lib="$(dirname "${BASH_SOURCE[0]}")/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
[ -r "${kaizen_lib}" ] && . "${kaizen_lib}"
# `.kaizen/` は**いま作業している作業ツリー**基準で解決する（他の kaizen スクリプトと統一）。
# $CLAUDE_PROJECT_DIR を最優先にすると、git worktree で作業しているときにコミット対象と
# 別の `.kaizen/` を見てしまう（Issue #218）。
if declare -f kaizen_resolve_project_root >/dev/null 2>&1; then
	project_root=$(kaizen_resolve_project_root "")
else
	project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
fi
if [ -n "${project_root}" ]; then
	cd "${project_root}" || {
		echo "kaizen-archive: failed to cd to project root: ${project_root}" >&2
		exit 1
	}
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

# 見出し直後の**先頭段落**を 1 行に連結して返す。索引の要約は最初の非空行だけを読んでいたため、
# 先頭段落が折り返されたノートでは要約が文の途中で切れ、しかも `…` が付かないので完結した文に
# 見えた（Issue #303）。INDEX.md は人が読む索引でエージェント文脈へは注入されないため、
# 注入側（kaizen-context-inject.sh）のように「折り返しを検査してブロック」ではなく連結を選ぶ。
# 節の切り出し方は kaizen-status-check.sh の section_lead_state() と揃える（見出しは前方一致、
# 見出し・空行・`---` 行・箇条書きの開始は段落の境界）。折り返しを検出するだけの
# section_lead_state() と違い、こちらは連結した文字列を出力するため、段落の直後に始まる
# リストも境界にする（継続行として繋ぐと `…2 つ。- A- B` のような文になる）。
# 第 1 引数が空文字なら見出しを使わず frontmatter 以降の最初の段落を対象にする（フォールバック）。
lead_paragraph() {
	awk -v h="$1" '
		# 日本語の折り返しは空白を伴わないので、両側が ASCII のときだけ空白で継ぐ。
		# `[ -~]` は非 UTF-8 ロケール（mawk のバイト処理）でも多バイト文字の境界に一致しない。
		function join(a, b) {
			if (a ~ /[ -~]$/ && b ~ /^[ -~]/) return a " " b
			return a b
		}
		# 段落を読み始める前の `---` だけの行は frontmatter の境界か区切り線。どちらも要約では
		# ないので読み飛ばす（フォールバックは 2 本目の `---` の後から本文として読む）。
		!found && /^---[[:space:]]*$/ { if (h == "" && !in_sec && ++fm >= 2) in_sec = 1; next }
		h != "" && index($0, h) == 1 { in_sec = 1; next }
		# 見出しは節と段落の境界。段落を読み始める前の見出しは、フォールバックでは読み飛ばし
		# （タイトル行 `# ...` の後に本文が来るため）、見出し指定時は「節が空」として打ち切る。
		in_sec && /^#/ { if (h == "" && !found) next; exit }
		in_sec && !found && NF { found = 1; lead = $0; next }
		# 先頭段落に続く `---` / `===` だけの行は setext 見出しの下線か区切り線で、いずれも段落の
		# 境界。`{3,}` は古い mawk が区間指定を解さないため使わない。
		in_sec && found && /^(---+|===+)[[:space:]]*$/ { exit }
		in_sec && found {
			if (!NF) exit
			# 箇条書きの項目は継続行ではない。先頭項目に続く兄弟項目も、段落の直後に始まる
			# リストも境界として打ち切り、要約には先頭段落（箇条書きなら先頭項目）だけを使う。
			marker = "^[[:space:]]*([-*+]|[0-9]+\\.)[[:space:]]"
			if ($0 ~ marker) exit
			line = $0
			sub(/^[[:space:]]+/, "", line)
			lead = join(lead, line)
			next
		}
		END { if (found) print lead }
	' "$2" 2>/dev/null || true
}

# archive/*.md の frontmatter と要約から INDEX.md を作り直す。
regenerate_index() {
	mkdir -p "${archive_dir}"
	{
		echo "# アーカイブ済みの学び（サマリー索引）"
		echo ""
		for f in "${archive_dir}"/*.md; do
			[ -e "${f}" ] || continue
			[ "$(basename "${f}")" = "INDEX.md" ] && continue
			# frontmatter（最初の `---` ブロック）内の date/type/priority/status だけを拾う。
			# ファイル全体への grep だと本文中の `type:` 等まで索引へ混入するため範囲を区切る。
			# 行は一旦バッファし、閉じフェンス `---` を確認できたときだけ出力する。
			# こうすると閉じフェンスを欠く不正 frontmatter では、本文まで読み進めても
			# buf を出力しないため meta を空にできる。
			meta=$(awk '
				/^---[[:space:]]*$/ {
					fm++
					if (fm >= 2) { printf "%s", buf; exit }
					next
				}
				fm == 1 && /^(date|type|priority|status):/ { buf = buf $0 " " }
			' "${f}" 2>/dev/null || true)
			# 優先: 「## 事象」見出し直後の先頭段落。
			summary=$(lead_paragraph "## 事象" "${f}")
			# フォールバック: 見出しが無いフォーマットなら、frontmatter 以降の最初の段落を使う。
			if [ -z "${summary}" ]; then
				summary=$(lead_paragraph "" "${f}")
			fi
			# 80 文字に切り詰め。bash のパラメータ展開は UTF-8 ロケールでは文字単位なので
			# 日本語をバイト境界で割らない（mawk の substr / cut -c はバイト単位で割れる）。
			# 非 UTF-8 ロケールではバイト単位になり UTF-8 を壊しうるため、UTF-8 のときだけ切り詰める。
			# python 等の追加ランタイムには依存しない方針なので、非 UTF-8 では切り詰めず安全側に倒す。
			if locale charmap 2>/dev/null | grep -qi 'utf-\{0,1\}8' && [ "${#summary}" -gt 80 ]; then
				summary=${summary:0:79}…
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
rewritten=""
trap '[ -z "${rewritten}" ] || rm -f "${rewritten}"' EXIT
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
	tracked=0
	if git ls-files --error-unmatch "${f}" >/dev/null 2>&1; then
		tracked=1
		git mv -- "${f}" "${archive_dir}/"
	else
		mv -- "${f}" "${archive_dir}/"
	fi
	# ノートは .kaizen/ から .kaizen/archive/ へ 1 階層深く移るため、ノート位置を
	# 基準にする ../ リンクも 1 階層分補正する。リンク先の残りや title は触らない。
	# 一時ファイルから元ファイルへ書き戻し、mv 済みファイルの mode は維持する。
	dest="${archive_dir}/$(basename "${f}")"
	rewritten="${dest}.kaizen-archive-tmp"
	sed 's#](\.\./#](../../#g' "${dest}" >"${rewritten}"
	cat "${rewritten}" >"${dest}"
	rm -f "${rewritten}"
	rewritten=""
	# git mv で stage した rename の後に本文を書き換えたため、tracked ノートは
	# 移動先を再度 stage して index にもリンク補正を反映する。
	if [ "${tracked}" -eq 1 ]; then
		git add -- "${dest}"
	fi
	moved=$((moved + 1))
done

regenerate_index
echo "archived ${moved} file(s) into ${archive_dir} and rebuilt INDEX.md"
