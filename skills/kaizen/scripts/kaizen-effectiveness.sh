#!/usr/bin/env bash
# kaizen effectiveness report
#
# 適用した学び（`status: applied`）ごとに、適用した日と、適用した後の再発の件数を数え、
# 規約を消すか書き換えるかを人が決めるための候補を挙げる。何も変更しない。
#
#   kaizen-effectiveness.sh list         適用した学びをすべて TSV で出す（1 行目は列名）。
#   kaizen-effectiveness.sh candidates   候補の表を Markdown で出す（週次の報告 kaizen-schedule-report.sh が本文に入れる）。
#
# 判定に使う材料は次のとおりである。
#   - 適用した学び: `.kaizen/*.md` と `.kaizen/archive/*.md` のうち、frontmatter が `status: applied` のノート。
#   - 適用した日: git の履歴で、そのノートの frontmatter の status が最初に applied になった commit の日付（author date）。
#     frontmatter に適用した日の欄は無いので、履歴から求める。履歴が浅い clone・git の外・まだ commit していない適用では、
#     日付を `unknown` と出す（浅い clone では、残った 1 つの commit の日付をすべての学びに付けてしまうので、求めない）。
#   - 再発: 他のノートの frontmatter の `recurrence-of` に、そのノートのファイル名が書かれた件数。
#     `recurrence-of` は、適用した学びと同じ原因で再発したときだけ書く欄なので（references/extract.md）、
#     書かれた件数がそのまま適用した後の再発の件数になる。書いたノートの status は問わない（忘却したノートも再発の記録である）。
#   - 手順の細かさ: `## 提案` の節の、番号付きの手順の行と箇条書きの行の数。コードフェンスの中は数えない。
#
# 候補の条件（`references/housekeeping.md`「適用した学びの効果の測り直し」）は次のとおりである。
#   - 再発が続く: 再発が RECURRING_MIN 件以上。機構（Hook・チェック）への置き換えの候補にする。
#   - 手順を細かく書いた: 番号付きの手順が PROCEDURAL_STEPS_MIN 行以上か、箇条書きが PROCEDURAL_BULLETS_MIN 行以上。
#     短い「〜しない」の規則への書き換えの候補にする（references/rule-writing.md「失敗の種類と書き方」）。
set -euo pipefail

readonly RECURRING_MIN=1
readonly PROCEDURAL_STEPS_MIN=3
readonly PROCEDURAL_BULLETS_MIN=5
# Issue の本文は 65,536 文字が上限なので、候補の表の行数を決めておく（未適用の学びの表とエージェントのレポートと合わせて上限を超えないため）。
# 1 行の長さも決めておく。再発の記録は MAX_RECURRENCE_NOTES 件まで載せ、適用先は MAX_APPLIED_TO_CHARS 文字で切る。
# 1 行はおよそ パス 80 + 理由 130 + 再発の記録 90 × 3 + 適用先 200 で 680 文字、15 行で 10,200 文字になる。
# 本文に入れるときは、kaizen-schedule-report.sh が節の全体を文字数でも切る（パスが長い学びで、この見積もりを超えても上限を守るため）。
readonly MAX_CANDIDATE_ROWS=15
readonly MAX_RECURRENCE_NOTES=3
readonly MAX_APPLIED_TO_CHARS=200

warn() { echo "kaizen-effectiveness: $*" >&2; }

kaizen_lib="$(dirname "${BASH_SOURCE[0]}")/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
if [ -r "${kaizen_lib}" ]; then
	. "${kaizen_lib}"
else
	printf '%s: 共通ライブラリを読めないため、機能を減らして動きます: %s\n' "$(basename "${BASH_SOURCE[0]}")" "${kaizen_lib}" >&2
fi
# frontmatter の欄は、共通ライブラリの kaizen_frontmatter_values で読む（同梱のスクリプトで読み方を 1 つにする）。
# 読めないときは、どの学びが適用済みかを判定できない。0 件と同じ出力にしないよう止める。
# コードフェンスを読み飛ばす規則（KAIZEN_AWK_SKIP_FENCES）が無い古い共通ライブラリでも、手順の行数を数えられないので止める。
if ! declare -f kaizen_frontmatter_values >/dev/null 2>&1 || [ -z "${KAIZEN_AWK_SKIP_FENCES:-}" ]; then
	warn "kaizen-hook-common.sh を読めないか古いため、学びの status と提案の形を読めない: ${kaizen_lib}"
	exit 1
fi
# `.kaizen/` は、いま作業している作業ツリーを基準に解決する（他の kaizen スクリプトと同じ）。
project_root=$(kaizen_resolve_project_root "")
if [ -n "${project_root}" ]; then
	cd "${project_root}" || {
		warn "プロジェクトのルートに移れない: ${project_root}"
		exit 1
	}
fi

# 1 行に収めて出す値の \・タブ・改行・CR を、\\・\t・\n・\r と書く。そのまま出すと、TSV の列や Markdown の表の行がずれる。
one_line() {
	local s=${1//\\/\\\\}
	s=${s//$'\t'/\\t}
	s=${s//$'\n'/\\n}
	s=${s//$'\r'/\\r}
	printf '%s' "${s}"
}

# Markdown の表のセルに入れる値。1 行に収め、列の区切りとして読まれる `|` を `\|` と書く。
table_cell() {
	pipe_cell "$(one_line "$1")"
}

# one_line で 1 行に収めた値を、表のセルに入れる（`|` だけを書き分ける）。one_line を 2 回当てると `\` が重なるので分ける。
pipe_cell() {
	printf '%s' "${1//|/\\|}"
}

# 1 件の学びの、`## 提案` の節の番号付きの手順の行数・箇条書きの行数と、適用先（`applied-to`）を、タブで区切って出す。
# 節は見出しの行の完全一致（後ろの空白は許す）で始め、次の `## ` の見出しで閉じる。
# コードフェンスの中の行は、共通ライブラリの KAIZEN_AWK_SKIP_FENCES で読み飛ばす（判断待ちの判定と同じ読み方）。
# applied-to は、references/extract.md が認める 3 つの形（1 行の flow 配列・折り返した flow 配列・ブロックシーケンス）を読み、
# 1 行の flow 配列の形で出す。共通ライブラリの kaizen_frontmatter_values はキーと同じ行の値だけを読むので、
# 折り返した形とブロックシーケンスでは適用先が空になる。継続行は、字下げした行と桁 0 の `- ` の行で、桁 0 のほかの行（コメントを除く）で終わる。
note_shape() {
	awk "${KAIZEN_AWK_SKIP_FENCES}"'
		NR == 1 && /^---[ \t]*$/ { fm = 1; next }
		fm == 1 && /^---[ \t]*$/ { fm = 2; next }
		fm == 1 {
			if (!seen_at && $0 ~ /^applied-to:/) {
				at = $0
				sub(/^applied-to:[ \t]*/, "", at)
				sub(/[ \t]+$/, "", at)
				seen_at = 1; in_at = 1
				next
			}
			if (in_at && $0 ~ /^[ \t]*-[ \t]+[^ \t]/) {
				item = $0
				sub(/^[ \t]*-[ \t]+/, "", item)
				sub(/[ \t]+$/, "", item)
				items = items (items == "" ? "" : ", ") item
				next
			}
			if (in_at && $0 ~ /^[ \t]+[^ \t#]/) {
				cont = $0
				gsub(/^[ \t]+|[ \t]+$/, "", cont)
				at = at ((at ~ /,$/) ? " " : "") cont
				next
			}
			if ($0 !~ /^#/) in_at = 0
			next
		}
		/^## / {
			line = $0
			sub(/[ \t]+$/, "", line)
			in_section = (line == "## 提案")
			next
		}
		in_section && /^[ \t]*[0-9]+[.)][ \t]/ { steps++ }
		in_section && /^[ \t]*[-*+][ \t]/ { bullets++ }
		END {
			if (items != "") at = "[" items "]"
			sub(/,[ \t]*\]$/, "]", at)
			printf "%d\t%d\t%s\n", steps, bullets, at
		}
	' "$1"
}

# Bash 3.2（macOS の標準の bash）でも動くよう、連想配列（declare -A）と mapfile を使わない。
# ファイル名をキーにした対応づけは、集めた行を awk に渡して 1 回で行い（join_measures）、bash は添字の配列だけを持つ。
# set -u の Bash 4.4 より前は、空の配列の "${a[@]}" を未定義の変数として止めるので、配列を展開する前に件数を確かめる。

# 適用した日の索引を作る。applied_dates の各行は `<ファイル名> <TAB> <YYYY-MM-DD>` で、
# ファイル名ごとに、frontmatter の status が最初に applied になった commit の日付だけを残す。
# 求められないとき（git の外・浅い clone・git log の失敗）は空のままにし、理由を dates_unavailable に入れる。
dates_unavailable=""
applied_dates=""
build_applied_dates() {
	local shallow log name date sha path status dated=$'\n'
	if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		dates_unavailable="git の作業ツリーの外なので、適用した日を求めない"
		return 0
	fi
	shallow=$(git rev-parse --is-shallow-repository 2>/dev/null) || shallow=unknown
	if [ "${shallow}" != false ]; then
		dates_unavailable="履歴が浅い clone なので、適用した日を求めない（全履歴を取得してから実行する。例: actions/checkout の fetch-depth: 0）"
		return 0
	fi
	# --no-renames: 移動（archive）を削除と追加として読み、最初の commit を移動ではなく適用の commit にする。
	# -G の正規表現は、kaizen_frontmatter_values と同じく、コロンの後の空白の数を問わない（`status:  applied` も当てる）。
	# -G は frontmatter と本文を区別せず、追加と削除の行のどちらにも当たる（本文のコードフェンスに `status: applied` の例を足した commit も当たる）。
	# そのため、古い順に並べた候補の commit ごとに、その commit でのノートの frontmatter の status が applied かを確かめ、
	# 最初に確かめられた commit の日付だけを残す。ノートを消した側の候補は、その commit にファイルが無いので読めずに飛ばす。
	if ! log=$(git -c core.quotepath=off log --reverse --no-renames --date=short --format='%x01%H %ad' \
		-G '^status:[[:space:]]*applied[[:space:]]*$' --name-only -- .kaizen 2>/dev/null); then
		dates_unavailable="git log が失敗したので、適用した日を求めない"
		return 0
	fi
	while IFS=$'\t' read -r name date sha path; do
		[ -n "${name}" ] || continue
		case "${dated}" in
		*$'\n'"${name}"$'\n'*) continue ;;
		esac
		status=$(kaizen_frontmatter_values <(git show "${sha}:${path}" 2>/dev/null) status)
		if [ "${status}" = applied ]; then
			applied_dates+="${name}"$'\t'"${date}"$'\n'
			dated+="${name}"$'\n'
		fi
	done < <(printf '%s\n' "${log}" | awk '
		/^\001/ { split(substr($0, 2), head, " "); sha = head[1]; date = head[2]; next }
		NF == 0 { next }
		{ n = split($0, part, "/"); print part[n] "\t" date "\t" sha "\t" $0 }
	')
}

# frontmatter に `recurrence-of:` の欄があれば 0 を返す。kaizen_frontmatter_values は、欄が無いときと値が空のときを区別しない。
has_recurrence_key() {
	awk '
		/^---[[:space:]]*$/ { fm++; if (fm == 2) exit; next }
		fm == 1 && index($0, "recurrence-of:") == 1 { found = 1; exit }
		END { exit found ? 0 : 1 }
	' "$1" 2>/dev/null
}

# 適用した学びと、再発の記録を集める。
# recurrence_lines の各行は `<再発したノートのファイル名> <TAB> <記録したノートのパス>（<date>）` である。
applied_paths=()
applied_names=()
applied_tos=()
recurrence_lines=""
malformed_recurrences=0
collect_notes() {
	local f status recurrence_of date_value name body item entry applied_list=$'\n'
	local -a items
	for f in .kaizen/*.md .kaizen/archive/*.md; do
		[ -e "${f}" ] || continue
		{
			IFS= read -r status
			IFS= read -r recurrence_of
			IFS= read -r date_value
		} <<<"$(kaizen_frontmatter_values "${f}" status recurrence-of date)" || true
		name=${f##*/}
		if [ "${status}" = applied ]; then
			case "${applied_list}" in
			*$'\n'"${name}"$'\n'*) warn "同じファイル名の適用した学びが 2 つある（再発はどちらにも数える）: ${f}" ;;
			esac
			applied_list+="${name}"$'\n'
			applied_paths+=("${f}")
			applied_names+=("${name}")
		fi
		# 値が空でも、欄があれば（`recurrence-of:` の後に block 形式の配列を書いた記録など）、読めない書き方として件数を残す。
		if [ -z "${recurrence_of}" ]; then
			has_recurrence_key "${f}" || continue
			recurrence_of="(空)"
		fi
		# 書き方は 1 行の flow 配列（`[a.md, b.md]`）に決めている（references/extract.md）。ほかの形は読まずに件数を残す。
		case "${recurrence_of}" in
		\[*\]) ;;
		*)
			warn "recurrence-of を 1 行の flow 配列として読めないので数えない: ${f}"
			malformed_recurrences=$((malformed_recurrences + 1))
			continue
			;;
		esac
		body=${recurrence_of#\[}
		body=${body%\]}
		entry="$(one_line "${f}")（$(one_line "${date_value:-unknown}")）"
		items=()
		IFS=',' read -r -a items <<<"${body}"
		[ "${#items[@]}" -gt 0 ] || continue
		for item in "${items[@]}"; do
			item=${item#"${item%%[![:space:]]*}"}
			item=${item%"${item##*[![:space:]]}"}
			# flow 配列の要素は YAML の引用符（"…" か '…'）で囲める。囲んだ形も同じファイル名として数える。
			case "${item}" in
			\"*\" | \'*\') item=${item:1:${#item}-2} ;;
			esac
			[ -n "${item}" ] || continue
			recurrence_lines+="$(one_line "${item}")"$'\t'"${entry}"$'\n'
		done
	done
}

# 適用した学びの添字ごとに、適用した日・再発の件数・再発の記録の一覧（すべて・先頭の MAX_RECURRENCE_NOTES 件）を対応づける。
# 結果は row_date・row_count・row_rec_all・row_rec_short に入れる。一覧が無ければ `-` にする（タブは IFS の空白なので、空の列を詰めないため）。
# 適用した学びに当たらない再発の記録は、数えずに件数（unmatched_recurrences）を残す（ファイル名の誤り・適用していない学びを指した記録）。
# 適用した学びを `<添字> <TAB> <ファイル名>` の行で出す。0 件なら何も出さない（空の配列を展開しない）。
applied_index() {
	local i
	[ "${#applied_names[@]}" -gt 0 ] || return 0
	for i in "${!applied_names[@]}"; do
		printf '%s\t%s\n' "${i}" "${applied_names[i]}"
	done
}

row_date=()
row_count=()
row_rec_all=()
row_rec_short=()
unmatched_recurrences=0
join_measures() {
	local kind a b c d
	# 適用した学びが 0 件でも、再発の記録を読んで、適用した学びに無い名前を指す記録の件数を出す。
	while IFS=$'\t' read -r kind a b c d; do
		case "${kind}" in
		row)
			row_date[a]=${b}
			row_count[a]=${c}
			row_rec_all[a]=${d%%$'\x01'*}
			row_rec_short[a]=${d#*$'\x01'}
			;;
		unmatched)
			warn "recurrence-of が、適用した学びに無いファイル名を指すので数えない: ${a}"
			unmatched_recurrences=$((unmatched_recurrences + b))
			;;
		esac
	done < <(awk -F '\t' -v max="${MAX_RECURRENCE_NOTES}" '
		FILENAME == ARGV[1] { if (!($1 in date)) date[$1] = $2; next }
		FILENAME == ARGV[2] {
			if ($1 == "") next
			count[$1]++
			all[$1] = all[$1] (all[$1] == "" ? "" : "、") $2
			if (count[$1] <= max) short[$1] = short[$1] (short[$1] == "" ? "" : "、") $2
			next
		}
		{ order[++n] = $1; name_of[n] = $2; known[$2] = 1 }
		END {
			for (k = 1; k <= n; k++) {
				name = name_of[k]
				d = (name in date) ? date[name] : "unknown"
				al = (all[name] == "") ? "-" : all[name]
				sh = (short[name] == "") ? "-" : short[name]
				printf "row\t%s\t%s\t%d\t%s\001%s\n", order[k], d, count[name] + 0, al, sh
			}
			for (t in count) if (!(t in known)) printf "unmatched\t%s\t%d\n", t, count[t]
		}
	' <(printf '%s' "${applied_dates}") <(printf '%s' "${recurrence_lines}") <(applied_index))
}

# 文字数で切る。bash のパラメータ展開は UTF-8 のロケールでは文字単位、それ以外ではバイト単位なので、
# UTF-8 でなければ文字の途中で割らないよう切らずに、そのことを出力する。
utf8_locale=0
if grep -qi 'utf-\{0,1\}8' <<<"$(locale charmap 2>/dev/null)"; then
	utf8_locale=1
fi
truncate_chars() {
	local s=$1 max=$2
	if [ "${#s}" -gt "${max}" ]; then
		if [ "${utf8_locale}" = 1 ]; then
			s="${s:0:$((max - 1))}…"
		else
			warn "ロケールが UTF-8 でないため、表のセルを切り詰めない（文字が割れるため）"
		fi
	fi
	printf '%s' "${s}"
}

# 学びごとの集計の結果。添字は applied_paths と同じである（row_date などは join_measures が入れる）。
# row_kinds は候補の理由を `,` でつないだ語（recurring・procedural）で、当たらなければ `-` にする。
# undated_notes は、日付を求めたのに git の履歴から見つからなかった学び（まだ commit していない適用など）の数である。
row_steps=()
row_bullets=()
row_kinds=()
undated_notes=0
measure() {
	local i count steps bullets applied kinds
	build_applied_dates
	collect_notes
	join_measures
	[ "${#applied_paths[@]}" -gt 0 ] || return 0
	for i in "${!applied_paths[@]}"; do
		count=${row_count[i]}
		IFS=$'\t' read -r steps bullets applied <<<"$(note_shape "${applied_paths[i]}")"
		applied_tos[i]=${applied}
		kinds=""
		[ "${count}" -lt "${RECURRING_MIN}" ] || kinds="recurring"
		if [ "${steps}" -ge "${PROCEDURAL_STEPS_MIN}" ] || [ "${bullets}" -ge "${PROCEDURAL_BULLETS_MIN}" ]; then
			kinds="${kinds:+${kinds},}procedural"
		fi
		row_steps[i]=${steps}
		row_bullets[i]=${bullets}
		row_kinds[i]=${kinds:--}
		if [ -z "${dates_unavailable}" ] && [ "${row_date[i]}" = unknown ]; then
			warn "git の履歴に、frontmatter の status を applied にした commit が無いので、適用した日を unknown にする（まだ commit していない適用など）: ${applied_paths[i]}"
			undated_notes=$((undated_notes + 1))
		fi
	done
	[ -z "${dates_unavailable}" ] || warn "${dates_unavailable}"
}

cmd_list() {
	local i
	measure
	printf 'note\tapplied_date\trecurrences\trecurrence_notes\tproposal_steps\tproposal_bullets\tcandidate\tapplied_to\n'
	[ "${#applied_paths[@]}" -gt 0 ] || return 0
	for i in "${!applied_paths[@]}"; do
		printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(one_line "${applied_paths[i]}")" "${row_date[i]}" "${row_count[i]}" \
			"${row_rec_all[i]}" "${row_steps[i]}" "${row_bullets[i]}" "${row_kinds[i]}" "$(one_line "${applied_tos[i]}")"
	done
}

# 候補の理由を、人が読む語で出す。$1 は学びの添字。
reason_text() {
	local i=$1 out=""
	case ",${row_kinds[i]}," in
	*,recurring,*) out="再発 ${row_count[i]} 件。機構への置き換えを検討する" ;;
	esac
	case ",${row_kinds[i]}," in
	*,procedural,*) out="${out:+${out}。}手順 ${row_steps[i]} 行・箇条 ${row_bullets[i]} 行。短い「〜しない」の規則への書き換えを検討する" ;;
	esac
	printf '%s' "${out}"
}

# 表に載せる再発の記録。MAX_RECURRENCE_NOTES 件を超えた分は件数だけを書く。$1 は学びの添字。
recurrence_cell() {
	local count=${row_count[$1]} list=${row_rec_short[$1]}
	[ "${count}" -le "${MAX_RECURRENCE_NOTES}" ] || list="${list}、ほか $((count - MAX_RECURRENCE_NOTES)) 件"
	printf '%s' "${list}"
}

cmd_candidates() {
	local i shown=0 candidates=()
	measure
	# 候補を再発の多い順に並べる（同じ件数の中は、glob が並べたパスの順）。
	if [ "${#applied_paths[@]}" -gt 0 ]; then
		while IFS= read -r i; do
			candidates+=("${i}")
		done < <(for i in "${!applied_paths[@]}"; do
			[ "${row_kinds[i]}" = - ] || printf '%s\t%s\n' "${row_count[i]}" "${i}"
		done | sort -t $'\t' -k1,1nr -k2,2n | cut -f2)
	fi
	echo "## 効果を測り直す規約の候補"
	echo
	echo "適用した学び ${#applied_paths[@]} 件のうち、${#candidates[@]} 件が候補です。"
	echo "候補の規約を消すか書き換えるかは、再発の記録を読んで人が決め、候補ごとに別に直してください。"
	echo "候補でない学びを含む一覧は、\`kaizen-effectiveness.sh list\` で出せます。"
	if [ -n "${dates_unavailable}" ]; then
		echo
		echo "> 適用した日は求めていません（${dates_unavailable}）。"
	elif [ "${undated_notes}" -gt 0 ]; then
		echo
		echo "> ${undated_notes} 件の学びは、git の履歴に frontmatter の status を applied にした commit が無いので、適用した日を unknown にしています（まだ commit していない適用など）。対象は実行のログ（stderr）に出します。"
	fi
	if [ "${unmatched_recurrences}" -gt 0 ] || [ "${malformed_recurrences}" -gt 0 ]; then
		echo
		echo "> 数えなかった再発の記録があります（適用した学びに無いファイル名 ${unmatched_recurrences} 件・読めない書き方 ${malformed_recurrences} 件）。"
	fi
	[ "${#candidates[@]}" -gt 0 ] || return 0
	echo
	echo "| 学び | 適用した日 | 候補の理由 | 再発の記録 | 適用先 |"
	echo "| --- | --- | --- | --- | --- |"
	for i in "${candidates[@]}"; do
		[ "${shown}" -lt "${MAX_CANDIDATE_ROWS}" ] || break
		# SC2016: 表のセルを囲むバックティックはリテラル。展開させない意図で単一引用符が正しい。
		# shellcheck disable=SC2016
		printf '| `%s` | %s | %s | %s | %s |\n' "$(table_cell "${applied_paths[i]}")" "${row_date[i]}" "$(reason_text "${i}")" \
			"$(pipe_cell "$(recurrence_cell "${i}")")" "$(table_cell "$(truncate_chars "${applied_tos[i]}" "${MAX_APPLIED_TO_CHARS}")")"
		shown=$((shown + 1))
	done
	if [ "${#candidates[@]}" -gt "${shown}" ]; then
		echo
		echo "> 再発の多い ${shown} 件だけを載せています（Issue 本文の文字数の上限を超えないため）。残り $((${#candidates[@]} - shown)) 件は \`kaizen-effectiveness.sh list\` で確かめてください。"
	fi
}

case "${1:-}" in
list) cmd_list ;;
candidates) cmd_candidates ;;
*)
	echo "使い方: kaizen-effectiveness.sh list|candidates" >&2
	exit 2
	;;
esac
