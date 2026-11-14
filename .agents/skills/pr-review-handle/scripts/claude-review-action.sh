#!/usr/bin/env bash
# review_tool: claude-code-action で、PR の HEAD をレビューし終えたかを判定し（check）、
# 重ねて依頼しないことを確かめてから workflow_dispatch でレビューを依頼する（request）。
#
# なぜ要るか: claude-code-action のレビューは github-actions[bot] が投稿するので、ほかのワークフローのコメントと
# 作成者で区別できない。指摘が 0 件の回はレビューのレコードも作らず、workflow_dispatch の run の check-run は
# PR の HEAD に付かないことがある。
# そのため、ワークフロー（pr-finalize-loop に同梱した assets/claude-review.yml）が総評のコメントの 1 行目に書く目印を読む。
# そして、目印の run がその SHA を対象にした成功した run であることを、run の一覧と突き合わせる。
# 同じ SHA の run が進行中か済んでいるのに依頼すると、同じ HEAD のレビューが重なって使用量を使うので、
# 依頼の前に同じ一覧で判定する。
#
# 使い方は次のとおりである。
#
#     claude-review-action.sh check --pr <PR URL|番号> [--effort <effort>] [--since <時刻>]
#     claude-review-action.sh request --pr <PR URL|番号> --sha-file <file> [--effort <effort>] [--since <時刻>]
#
#   --sha-file  依頼する HEAD の完全な SHA を保存したファイル。
#
#   --effort  low・medium・high・xhigh・max のどれか。check は、目印の effort がこの値と一致するときだけレビュー済みとする。
#             request は、この値を workflow_dispatch の入力 effort に渡す。省くと、check はどの effort の目印も数え、
#             request は入力を渡さない（ワークフローのデフォルトの effort になる）。
#   --since   GitHub の時刻の形（YYYY-MM-DDTHH:MM:SSZ。UTC）。この時刻より前に作られた run は、レビュー済みの根拠にも、
#             一時停止と依頼の失敗の判定にも使わない。返信やコメントで対応した後に、その対応を見ていない run を数えないために渡す。
#             進行中の run は、この時刻に依らず数える（重ねて依頼しない）。
#
# 目印（総評のコメントの 1 行目。github-actions[bot] が書いたものだけを読む）:
#   <!-- claude-review sha=<40 桁の SHA> findings=<件数> open=<総評に書いた件数> effort=<effort> run=<run の ID> -->
#
# run の一覧は、ワークフロー claude-review.yml の run のうち、PR を作った時刻より後に作られ、
# run-name が「Claude review PR #<番号> <HEAD の SHA>」のものである。ページを追ってすべて読む。
#
# check は key=value の行を出力する。パースして使う。
#   head=<sha>             現在の headRefOid。
#   status=<value>         reviewed・in-progress・not-reviewed・paused・failed のどれか。
#                          reviewed: HEAD を対象にした成功した run が、目印（effort が一致するもの）を書いている。
#                          in-progress: HEAD を対象にした run が終わっていない。終わるまで待つ。
#                          paused: HEAD を対象にした最後の run が成功したのに目印が無い（一時停止の変数で止めた回）。依頼しても同じになる。
#                          failed: HEAD を対象にした最後の run が、失敗した workflow_dispatch の run である。依頼し直しても同じ原因で止まりうる。
#                          not-reviewed: 上のどれでもない。依頼してよい。
#   requestable=<yes|no>   request が依頼するか。not-reviewed のときだけ yes。
#   run=<id>               reviewed のときは目印の run の ID。paused と failed のときは、その判定の元になった最後の run の ID。
#   findings=<n>           reviewed のときの指摘の件数。
#   open=<n>               reviewed のときの、行に付けずに総評に書いた指摘の件数。
#   effort=<effort>        reviewed のときの effort。
#   runs=<n>               HEAD を対象にした run の件数（--since と conclusion に依らない）。
#   in_progress=<ids>      終わっていない run の ID（カンマ区切り）。in-progress のときだけ出す。
#   ignored=<n>            HEAD の SHA を書いた目印のうち、数えなかったものの件数。理由は stderr に 1 件ずつ出す。
#
# request は、check と同じ判定で requestable=yes のときだけ依頼する。依頼しないとき（exit 4）は check と同じ行を出す。
# 依頼したときは head=・status=requested を出し、run を確かめられたら（exit 0）run=<依頼した run の ID> も出す。
#
# 終了コード:
#   check:   0 は reviewed。1 はそれ以外の状態。2 は判定できない。3 はワークフロー claude-review.yml がリポジトリに無い。
#   request: 0 は依頼し、run を確かめた。1 は --sha-file の SHA が PR の HEAD と違う（依頼しない）。2 は取得か依頼に失敗した。
#            3 はワークフローが無い。4 は状態が依頼を許さない（status を見る。依頼しない）。
#            5 は依頼したが、run を一覧で確かめられなかった（依頼し直さずに、check で run が現れるのを待つ）。
#   どちらも、引数が不正なら 64 を返す。
set -euo pipefail

WORKFLOW_FILE="claude-review.yml"
MARKER_LOGIN="github-actions[bot]"
MARKER_PREFIX="<!-- claude-review "
# 依頼した run が一覧に現れるのを待つ間隔（秒）と回数。テストは環境変数で短くする。
POLL_SECONDS="${CLAUDE_REVIEW_POLL_SECONDS:-5}"
POLL_TRIES="${CLAUDE_REVIEW_POLL_TRIES:-12}"

usage() {
	cat >&2 <<'EOF'
usage: claude-review-action.sh check --pr <PR URL|番号> [--effort <effort>] [--since <時刻>]
       claude-review-action.sh request --pr <PR URL|番号> --sha-file <file> [--effort <effort>] [--since <時刻>]
EOF
}

die_usage() {
	echo "error: $1" >&2
	usage
	exit 64
}

[ "$#" -ge 1 ] || die_usage "モード（check か request）が無い"
mode="$1"
shift
case "${mode}" in
check | request) ;;
-h | --help)
	usage
	exit 0
	;;
*) die_usage "不明なモード: ${mode}" ;;
esac

pr=""
sha_file=""
effort=""
since=""
# 値を持つ引数は、重ねて渡したら拒否する（後の値で警告なしに上書きしない）
seen=" "
while [ "$#" -gt 0 ]; do
	flag="$1"
	case "${flag}" in
	--pr | --sha-file | --effort | --since) ;;
	*) die_usage "不明な引数: ${flag}" ;;
	esac
	{ [ "$#" -ge 2 ] && [ -n "$2" ]; } || die_usage "${flag} に値が無いか、値が空"
	[[ "${seen}" != *" ${flag} "* ]] || die_usage "${flag} が 2 回渡された"
	seen="${seen}${flag} "
	# --sha-file は sha_file に入れる（引数の名前から変数の名前を作る）
	name="${flag#--}"
	printf -v "${name//-/_}" '%s' "$2"
	shift 2
done

[ -n "${pr}" ] || die_usage "--pr が無い"
if [ -n "${effort}" ] && [[ ! "${effort}" =~ ^(low|medium|high|xhigh|max)$ ]]; then
	die_usage "--effort は low・medium・high・xhigh・max のどれか: ${effort}"
fi
if [ -n "${since}" ] && [[ ! "${since}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
	die_usage "--since は GitHub の時刻の形（YYYY-MM-DDTHH:MM:SSZ。UTC）にする: ${since}"
fi
sha=""
if [ "${mode}" = "check" ]; then
	[ -z "${sha_file}" ] || die_usage "check は --sha-file を受け取らない"
else
	[ -n "${sha_file}" ] || die_usage "request には --sha-file が要る（依頼する HEAD の SHA を、表示から書き写さずに渡す）"
	[ -f "${sha_file}" ] && [ -r "${sha_file}" ] || die_usage "--sha-file のファイルを読めない: ${sha_file}"
	sha=$(<"${sha_file}")
	[[ "${sha}" =~ ^[0-9a-f]{40}$ ]] || die_usage "--sha-file の中身は 40 桁の小文字の 16 進数にする（短縮した SHA は受け取らない）: ${sha}"
fi

err=$(mktemp)
trap 'rm -f "${err}"' EXIT

# PR の URL・HEAD・head のブランチ・作成の時刻を取得する。番号だけなら、gh が現在の repo の PR として扱う。
# 欄の区切りは U+001F にする。タブは read の IFS で空白として扱われ、空の欄が詰まって後ろの値が前の欄に入る。
# 取得か解析に失敗したら、判定できないとして exit 2 で止まる
fail_fetch() {
	echo "error: $1" >&2
	exit 2
}
pr_line=$(gh pr view "${pr}" --json url,headRefOid,headRefName,createdAt \
	--jq '[.url, .headRefOid, .headRefName, .createdAt] | join("\u001f")' </dev/null 2>"${err}") ||
	fail_fetch "PR を取得できない: $(tr '\n' ' ' <"${err}")"
IFS=$'\x1f' read -r pr_url head head_ref pr_created <<<"${pr_line}" || true
[[ "${pr_url:-}" =~ ^https://([^/]+)/([^/]+)/([^/]+)/pull/([0-9]+)$ ]] || fail_fetch "PR の URL を解析できない: '${pr_url:-}'"
repo_path="repos/${BASH_REMATCH[2]}/${BASH_REMATCH[3]}"
number="${BASH_REMATCH[4]}"
host_args=()
if [ "${BASH_REMATCH[1]}" != "github.com" ]; then
	host_args=(--hostname "${BASH_REMATCH[1]}")
fi
[[ "${head:-}" =~ ^[0-9a-f]{40}$ ]] || fail_fetch "PR の headRefOid が完全な SHA でない: '${head:-}'"
[[ "${pr_created:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || fail_fetch "PR の作成の時刻を解析できない: '${pr_created:-}'"

if [ "${mode}" = "request" ] && [ "${sha}" != "${head}" ]; then
	echo "head=${head}"
	echo "error: --sha-file の SHA（${sha}）が PR の HEAD（${head}）と違う。今の HEAD を取得し直してから依頼する" >&2
	exit 1
fi

title="Claude review PR #${number} ${head}"

# HEAD を対象にした run を、id・event・status・conclusion・created_at の順に 1 行ずつ出す。
# title は数字と 16 進数だけから作るので、jq の文字列にそのまま入れてよい。
list_runs() {
	gh api ${host_args[@]+"${host_args[@]}"} --paginate \
		"${repo_path}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=100&created=%3E%3D${pr_created}" \
		--jq '.workflow_runs[] | select(.display_title == "'"${title}"'") | [(.id | tostring), .event, (.status // ""), (.conclusion // ""), .created_at] | join("\u001f")' \
		</dev/null 2>"${err}"
}

load_runs() {
	if ! runs=$(list_runs); then
		if grep -q "HTTP 404" "${err}"; then
			echo "error: ワークフロー ${WORKFLOW_FILE} がリポジトリに無い（pr-finalize-loop に同梱した assets/claude-review.yml を .github/workflows/ にコピーする）" >&2
			exit 3
		fi
		echo "error: run の一覧を取得できない: $(tr '\n' ' ' <"${err}")" >&2
		exit 2
	fi
}

load_runs

# 目印の候補（github-actions[bot] が書いた、本文が目印の前置きで始まるトップレベルのコメント）の 1 行目を取得する。
# コメントは作成の順に返る。
if ! markers=$(gh api ${host_args[@]+"${host_args[@]}"} --paginate "${repo_path}/issues/${number}/comments?per_page=100" \
	--jq '.[] | select((.user.login // "") == "'"${MARKER_LOGIN}"'") | select((.body // "") | startswith("'"${MARKER_PREFIX}"'")) | [(.id | tostring), ((.body | split("\n")[0]) | rtrimstr("\r"))] | join("\u001f")' \
	</dev/null 2>"${err}"); then
	echo "error: PR のコメントを取得できない: $(tr '\n' ' ' <"${err}")" >&2
	exit 2
fi

# run の ID から、その run の欄（event・status・conclusion・created_at）を返す。無ければ 1 を返す。
run_fields() {
	local id event status conclusion created
	while IFS=$'\x1f' read -r id event status conclusion created; do
		if [ -n "${id}" ] && [ "${id}" = "$1" ]; then
			printf '%s\x1f%s\x1f%s\x1f%s\n' "${event}" "${status}" "${conclusion}" "${created}"
			return 0
		fi
	done <<<"${runs}"
	return 1
}

marker_re='^<!-- claude-review sha=([0-9a-f]{40}) findings=(0|[1-9][0-9]{0,8}) open=(0|[1-9][0-9]{0,8}) effort=(low|medium|high|xhigh|max) run=([1-9][0-9]{0,19}) -->$'

# 状態を決める。結果は次の変数に入れる。
#   status・requestable・found_run・found_findings・found_open・found_effort・run_count・in_progress・ignored
evaluate() {
	local id event st conclusion created line comment_id fields
	local marked_runs=" " latest_id="" latest_event="" latest_conclusion=""
	run_count=0
	in_progress=""
	while IFS=$'\x1f' read -r id event st conclusion created; do
		[ -n "${id}" ] || continue
		run_count=$((run_count + 1))
		if [ "${st}" != "completed" ]; then
			in_progress="${in_progress:+${in_progress},}${id}"
			continue
		fi
		# 対象外の PR で job を飛ばした run は、レビューも一時停止もしていないので数えない
		[ "${conclusion}" != "skipped" ] || continue
		# --since より前の run は、対応を見ていないので数えない
		if [ -n "${since}" ] && [[ "${created}" < "${since}" ]]; then
			continue
		fi
		# run の ID は作られた順に大きくなるので、ID の最も大きい run を最後の run とする
		if [ -z "${latest_id}" ] || [ "${id}" -gt "${latest_id}" ]; then
			latest_id="${id}"
			latest_event="${event}"
			latest_conclusion="${conclusion}"
		fi
	done <<<"${runs}"

	found_run=""
	found_findings=""
	found_open=""
	found_effort=""
	ignored=0
	while IFS=$'\x1f' read -r comment_id line; do
		[ -n "${comment_id}" ] || continue
		if [[ ! "${line}" =~ ${marker_re} ]]; then
			# HEAD の SHA を書いたものだけを、数えなかった目印として報告する
			case "${line}" in *"sha=${head} "*)
				echo "note: 目印 ${comment_id} を数えない（1 行目の形が違う）" >&2
				ignored=$((ignored + 1))
				;;
			esac
			continue
		fi
		local m_sha="${BASH_REMATCH[1]}" m_findings="${BASH_REMATCH[2]}" m_open="${BASH_REMATCH[3]}"
		local m_effort="${BASH_REMATCH[4]}" m_run="${BASH_REMATCH[5]}"
		[ "${m_sha}" = "${head}" ] || continue
		if [ "${m_open}" -gt "${m_findings}" ]; then
			echo "note: 目印 ${comment_id} を数えない（open が findings より大きい）" >&2
			ignored=$((ignored + 1))
			continue
		fi
		if ! fields=$(run_fields "${m_run}"); then
			echo "note: 目印 ${comment_id} を数えない（run ${m_run} は、この HEAD を対象にした ${WORKFLOW_FILE} の run でない）" >&2
			ignored=$((ignored + 1))
			continue
		fi
		IFS=$'\x1f' read -r event st conclusion created <<<"${fields}"
		if [ "${st}" != "completed" ] || [ "${conclusion}" != "success" ]; then
			echo "note: 目印 ${comment_id} を数えない（run ${m_run} が成功で終わっていない: ${st}/${conclusion:-なし}）" >&2
			ignored=$((ignored + 1))
			continue
		fi
		marked_runs="${marked_runs}${m_run} "
		if [ -n "${since}" ] && [[ "${created}" < "${since}" ]]; then
			continue
		fi
		if [ -n "${effort}" ] && [ "${m_effort}" != "${effort}" ]; then
			continue
		fi
		found_run="${m_run}"
		found_findings="${m_findings}"
		found_open="${m_open}"
		found_effort="${m_effort}"
	done <<<"${markers}"

	requestable=no
	last_run="${latest_id}"
	if [ -n "${in_progress}" ]; then
		status=in-progress
	elif [ -n "${found_run}" ]; then
		status=reviewed
	elif [ "${latest_event}" = "workflow_dispatch" ] && [ "${latest_conclusion}" != "success" ]; then
		# 最後の run が失敗した dispatch なら、依頼し直しても同じ原因で止まりうる
		status=failed
	elif [ "${latest_conclusion}" = "success" ] && [[ "${marked_runs}" != *" ${latest_id} "* ]]; then
		status=paused
	else
		status=not-reviewed
		requestable=yes
	fi
}

print_state() {
	echo "head=${head}"
	echo "status=${status}"
	echo "requestable=${requestable}"
	case "${status}" in paused | failed) echo "run=${last_run}" ;; esac
	if [ "${status}" = "reviewed" ]; then
		echo "run=${found_run}"
		echo "findings=${found_findings}"
		echo "open=${found_open}"
		echo "effort=${found_effort}"
	fi
	echo "runs=${run_count}"
	[ -z "${in_progress}" ] || echo "in_progress=${in_progress}"
	echo "ignored=${ignored}"
}

evaluate

if [ "${mode}" = "check" ]; then
	print_state
	# 出力と終了コードを同じ分岐で決める
	if [ "${status}" = "reviewed" ]; then
		exit 0
	fi
	exit 1
fi

if [ "${requestable}" != "yes" ]; then
	print_state
	echo "note: 状態が ${status} なので依頼しない" >&2
	exit 4
fi

# 依頼の前の run の ID を控え、依頼の後に増えた workflow_dispatch の run を、依頼した run として確かめる。
# 同じ時に別の人が同じ HEAD を依頼すると、その run を取り違えうる。どちらも同じ HEAD をレビューする run なので、待つ対象として扱っても判定は変わらない。
before=" "
while IFS=$'\x1f' read -r id _; do
	[ -z "${id}" ] || before="${before}${id} "
done <<<"${runs}"

dispatch_args=(-f "ref=${head_ref}" -f "inputs[pr]=${number}" -f "inputs[sha]=${head}")
[ -z "${effort}" ] || dispatch_args+=(-f "inputs[effort]=${effort}")
if ! dispatched=$(gh api ${host_args[@]+"${host_args[@]}"} --method POST \
	"${repo_path}/actions/workflows/${WORKFLOW_FILE}/dispatches" "${dispatch_args[@]}" </dev/null 2>"${err}"); then
	# ブランチにワークフローが無いときは 404 でなく 422（Workflow does not have 'workflow_dispatch' trigger）が返る（実測）
	if grep -q -e "HTTP 404" -e "does not have 'workflow_dispatch' trigger" "${err}"; then
		echo "error: ワークフロー ${WORKFLOW_FILE} がリポジトリに無いか、ブランチ ${head_ref} に無い（workflow_dispatch を持たない古いバージョンを含む）" >&2
		exit 3
	fi
	echo "error: 依頼できない: $(tr '\n' ' ' <"${err}")" >&2
	exit 2
fi
echo "note: ${head} を effort ${effort:-（ワークフローのデフォルト）} で依頼した（${dispatched:+応答: ${dispatched}}）" >&2

new_run=""
tries=0
while [ -z "${new_run}" ] && [ "${tries}" -lt "${POLL_TRIES}" ]; do
	tries=$((tries + 1))
	sleep "${POLL_SECONDS}"
	if ! runs=$(list_runs); then
		continue
	fi
	while IFS=$'\x1f' read -r id event _; do
		if [ -n "${id}" ] && [ "${event}" = "workflow_dispatch" ] && [[ "${before}" != *" ${id} "* ]]; then
			new_run="${id}"
		fi
	done <<<"${runs}"
done

echo "head=${head}"
echo "status=requested"
if [ -z "${new_run}" ]; then
	echo "error: 依頼したが、run を一覧で確かめられなかった。依頼し直さずに、check で run が現れるのを待つ" >&2
	exit 5
fi
echo "run=${new_run}"
exit 0
