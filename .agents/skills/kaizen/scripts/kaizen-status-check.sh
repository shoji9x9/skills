#!/usr/bin/env bash
# kaizen lifecycle status checker
#
# 学びの適用先宣言（applied-to）と status、アーカイブ索引の整合を検査する。
# 不整合は exit 2 + stderr で返し、kaizen-precommit-gate.sh から commit を止める。
set -euo pipefail

# cd する前に解決する（BASH_SOURCE は起動時の cwd 相対になり得るため）。
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)
project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

[ -d .kaizen ] || exit 0

errors=0

frontmatter_state() {
	awk '
		# 空配列は `[]` だけでなく `[ ]` のような空白入りでも、フォーマッタによる折り返しでも
		# 書かれる。内部の空白を落とし、折り返し分を連結してから判定しないと、pending は
		# 誤ブロック（空なのに「適用先あり」）、applied / rejected は検査漏れ（空なのに素通り）になる。
		function emit(  merged) {
			merged = applied_value
			if (merged != "" && merged != "[]" && merged != "null" && merged != "~") nonempty = 1
			printf "%s|%s|%s\n", status, present, nonempty
		}
		BEGIN { fm = 0; present = 0; nonempty = 0; status = ""; in_applied = 0; applied_value = "" }
		/^---[[:space:]]*$/ {
			fm++
			if (fm == 2) {
				emit()
				exit
			}
			next
		}
		fm != 1 { next }
		/^status:[[:space:]]*/ {
			status = $0
			sub(/^status:[[:space:]]*/, "", status)
			sub(/[[:space:]]+#.*$/, "", status)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", status)
			in_applied = 0
			next
		}
		/^applied-to:[[:space:]]*/ {
			present = 1
			value = $0
			sub(/^applied-to:[[:space:]]*/, "", value)
			sub(/[[:space:]]+#.*$/, "", value)
			gsub(/[[:space:]]/, "", value)
			applied_value = value
			in_applied = 1
			next
		}
		in_applied && /^[[:space:]]+-[[:space:]]*[^[:space:]]/ { nonempty = 1; next }
		# ブロックシーケンスは親キーと同じ桁 0 に置いても正しい YAML で、フォーマッタ次第で
		# その形で書かれる。桁 0 というだけで値の終わりに倒すと、非空の applied-to が空と
		# 読まれ、applied / rejected は誤ブロック、pending は検査漏れ（fail open）になる（実測）。
		# 閉じ `---` は先頭のルールが先に next するのでここへは来ない。
		in_applied && /^-[[:space:]]+[^[:space:]]/ { nonempty = 1; next }
		# 折り返された flow 配列（`applied-to:` の次行以降にインデントで続く値）を拾う。
		# Markdown フォーマッタを .kaizen/*.md に掛けていると applied-to が長いだけで折り返される。
		in_applied && /^[[:space:]]+[^[:space:]#]/ {
			cont = $0
			sub(/[[:space:]]+#.*$/, "", cont)
			gsub(/[[:space:]]/, "", cont)
			applied_value = applied_value cont
			next
		}
		# ここへ来る桁 0 の行は applied-to の値の終わり（桁 0 に置ける継続行はブロック
		# シーケンスだけで、それは上のルールが先に next する）。リセット条件を
		# キー名の字種（`[[:alnum:]_-]+:`）で絞ると、それ以外の文字を含むキー（`kedb.ref:` や
		# 引用符付きキー）の後ろで in_applied が残り、そのブロックスカラー本文まで applied_value へ
		# 連結されて、空の `applied-to: []` が非空と判定される（実測）。
		# 桁 0 のコメントだけは値の途中に現れ得るのでリセットしない。
		/^[^[:space:]#]/ { in_applied = 0 }
		END {
			if (fm < 2) emit()
		}
	' "$1"
}

for note in .kaizen/*.md .kaizen/archive/*.md; do
	[ -e "${note}" ] || continue
	[ "$(basename "${note}")" = "INDEX.md" ] && continue
	# 1 件の読み取り失敗でループごと落とさない（set -e で残りのノートが未検査になり、
	# 診断も awk のメッセージだけになって「何の不整合か分からないまま commit できない」状態になる）。
	# 読めないノートは検査できていないので、素通りさせず不整合として数えて fail closed を保つ。
	if ! state=$(frontmatter_state "${note}" 2>/dev/null); then
		# 失敗理由は権限とは限らない（破損・awk の内部エラー等）。捨てると「何の不整合か
		# 分からないまま commit できない」状態に戻るので、失敗時だけ読み直して診断を添える。
		detail=$(frontmatter_state "${note}" 2>&1 >/dev/null | tr '\n' ' ') || true
		echo "kaizen-status-check: ${note}: could not read the frontmatter: ${detail:-no diagnostics from awk}" >&2
		errors=$((errors + 1))
		continue
	fi
	IFS='|' read -r status present nonempty <<<"${state}"

	# applied-to が無い旧形式は後方互換のため検査対象外。新形式としてフィールドを
	# 宣言したノートだけを厳密に検査する。
	[ "${present}" = "1" ] || continue
	# applied-to を宣言したノートは新形式なので status も必須。status 行が無い／読めないと
	# pending / applied / rejected のどれにも一致せず、以降の検査を素通りしてしまう。
	if [ -z "${status}" ]; then
		echo "kaizen-status-check: ${note}: applied-to is declared but status is missing" >&2
		errors=$((errors + 1))
	elif [ "${status}" = "pending" ] && [ "${nonempty}" = "1" ]; then
		echo "kaizen-status-check: ${note}: applied-to is set but status is pending" >&2
		errors=$((errors + 1))
	elif { [ "${status}" = "applied" ] || [ "${status}" = "rejected" ]; } && [ "${nonempty}" = "0" ]; then
		echo "kaizen-status-check: ${note}: status is ${status} but applied-to is empty" >&2
		errors=$((errors + 1))
	elif [ "${status}" != "pending" ] && [ "${status}" != "applied" ] && [ "${status}" != "rejected" ]; then
		# 未知の status は非空なのでどの分岐にも当たらず、全検査を素通りしていた。
		# applied-to を宣言した時点で新形式なので、定義済みの 3 値だけを受け付ける。
		echo "kaizen-status-check: ${note}: unknown status: ${status} (expected pending, applied or rejected)" >&2
		errors=$((errors + 1))
	fi
done

archive_dir=.kaizen/archive
index_file=${archive_dir}/INDEX.md
if [ -d "${archive_dir}" ]; then
	# エントリ一覧は 1 度だけ抽出する。archived note ごとに INDEX.md を読み直すと
	# 件数の二乗に比例して重くなり、コミット前ゲートの実行時間へ効いてくる。
	index_entries=""
	if [ -f "${index_file}" ]; then
		# shellcheck disable=SC2016 # sed の backtick と後方参照はリテラル。
		index_entries=$(sed -n 's/^- `\([^`]*\.md\)` .*$/\1/p' "${index_file}")
	fi
	for note in "${archive_dir}"/*.md; do
		[ -e "${note}" ] || continue
		[ "$(basename "${note}")" = "INDEX.md" ] && continue
		base=$(basename "${note}")
		entry_count=0
		if [ -n "${index_entries}" ]; then
			entry_count=$(awk -v target="${base}" '$0 == target { count++ } END { print count + 0 }' <<<"${index_entries}")
		fi
		if [ "${entry_count}" -ne 1 ]; then
			echo "kaizen-status-check: ${note}: expected exactly one entry in ${index_file}, found ${entry_count}" >&2
			errors=$((errors + 1))
		fi
	done

	if [ -n "${index_entries}" ]; then
		while IFS= read -r base; do
			[ -n "${base}" ] || continue
			if [ ! -f "${archive_dir}/${base}" ]; then
				echo "kaizen-status-check: ${index_file}: stale entry for ${base}" >&2
				errors=$((errors + 1))
			fi
		done <<<"${index_entries}"
	fi
fi

if [ "${errors}" -gt 0 ]; then
	# スクリプトは PATH に無いので、そのまま貼れる形で案内する。
	if [ -n "${script_dir}" ]; then
		reindex_cmd="bash \"${script_dir}/kaizen-archive.sh\" --reindex"
	else
		reindex_cmd="バンドルされた kaizen-archive.sh を --reindex 付きで実行"
	fi
	echo "kaizen-status-check: ${errors} lifecycle inconsistency(s); update status/applied-to or ${reindex_cmd}" >&2
	exit 2
fi

exit 0
