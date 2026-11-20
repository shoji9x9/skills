#!/usr/bin/env bash
# 1 つの GitHub Actions の run が完了するか、人の操作を待つ状態になるか、上限に達するまで待つ。終わったときの状態を 1 回だけ返す。
#
# なぜ要るか: run を追うたびに `gh run view` を呼び直すと、照会の結果を毎回読むことになる。
# 待つ処理を 1 つの呼び出しにまとめ、終わったときの run の ID・SHA・状態だけを返す。
#
# 使い方は次のとおりである。
#
#     wait-run.sh --repo <owner>/<repo> --run <run の ID> --timeout <秒> [--interval <秒>] [--hostname <host>]
#
#   --timeout   待つ上限（秒）。上限に達したら、もう 1 回取得してから timeout を返す。0 なら 1 回だけ取得する。
#   --interval  取得の間隔（秒）。デフォルトは 15。
#   --hostname  GitHub Enterprise Server のホスト名。github.com なら渡さない。
#
# 出力は key=value の行である。パースして使う。
#   run=<id>                  待った run の ID。
#   head_sha=<sha>            run の head_sha。
#   status=<status>           終わったときの run の status（completed・waiting・queued・in_progress など）。
#   conclusion=<conclusion>   終わったときの run の conclusion。完了していなければ空。
#   result=<value>            completed・waiting・timeout のどれか（status と conclusion の値は
#                             https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run で確かめた）。
#                             completed: status が completed で、conclusion が action_required でない。conclusion を読む。
#                             waiting: 人の操作を待っている（status が waiting か、conclusion が action_required）。
#                             timeout: 上限まで、上のどちらにもならなかった。
#   polls=<n>                 取得した回数。
#
# 終了コード: 0 は completed。1 は timeout。2 は取得に続けて失敗した（判定できない）。4 は waiting。引数が不正なら 64。
# completed の exit 0 は、run が成功したことを表さない。conclusion で判定する。
set -euo pipefail

FAIL_LIMIT=3

usage() {
	cat >&2 <<'EOF'
usage: wait-run.sh --repo <owner>/<repo> --run <run の ID> --timeout <秒> [--interval <秒>] [--hostname <host>]
EOF
}

die_usage() {
	echo "error: $1" >&2
	usage
	exit 64
}

repo=""
run=""
timeout=""
interval=""
hostname=""
given=" "
while [ "$#" -gt 0 ]; do
	flag="$1"
	case "${flag}" in
	-h | --help)
		usage
		exit 0
		;;
	--repo | --run | --timeout | --interval | --hostname) ;;
	*) die_usage "不明な引数: ${flag}" ;;
	esac
	{ [ "$#" -ge 2 ] && [ -n "$2" ]; } || die_usage "${flag} に値が無いか、値が空"
	# 値を持つ引数は、重ねて渡したら拒否する（後の値で警告なしに上書きしない）
	[[ "${given}" != *" ${flag} "* ]] || die_usage "${flag} が 2 回渡された"
	given="${given}${flag} "
	printf -v "${flag#--}" '%s' "$2"
	shift 2
done

[ -n "${repo}" ] || die_usage "--repo が無い"
[ -n "${run}" ] || die_usage "--run が無い"
[ -n "${timeout}" ] || die_usage "--timeout が無い（上限の無い待ちにしない）"
[[ "${repo}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die_usage "--repo は <owner>/<repo> の形にする: ${repo}"
[[ "${run}" =~ ^[1-9][0-9]{0,19}$ ]] || die_usage "--run は run の ID（正の整数）にする: ${run}"
[[ "${timeout}" =~ ^(0|[1-9][0-9]{0,5})$ ]] || die_usage "--timeout は 0 以上の整数（秒）にする: ${timeout}"
interval="${interval:-15}"
[[ "${interval}" =~ ^(0|[1-9][0-9]{0,4})$ ]] || die_usage "--interval は 0 以上の整数（秒）にする: ${interval}"
host_args=()
if [ -n "${hostname}" ]; then
	[[ "${hostname}" =~ ^[A-Za-z0-9.-]+$ ]] || die_usage "--hostname はホスト名にする: ${hostname}"
	host_args=(--hostname "${hostname}")
fi

err=$(mktemp)
trap 'rm -f "${err}"' EXIT

finish() {
	echo "run=${run}"
	echo "head_sha=${head_sha}"
	echo "status=${status}"
	echo "conclusion=${conclusion}"
	echo "result=$2"
	echo "polls=${polls}"
	exit "$1"
}

polls=0
fails=0
head_sha=""
status=""
conclusion=""
deadline=$(($(date +%s) + timeout))
while :; do
	polls=$((polls + 1))
	polled=no
	# 取得を始めた時刻で上限と比べる。取得に時間がかかって上限を過ぎても、上限より前に始めた取得は、上限の後の取得に数えない
	started=$(date +%s)
	if line=$(gh api ${host_args[@]+"${host_args[@]}"} "repos/${repo}/actions/runs/${run}" \
		--jq '[(.id | tostring), (.head_sha // ""), (.status // ""), (.conclusion // "")] | join("\u001f")' </dev/null 2>"${err}"); then
		IFS=$'\x1f' read -r id sha st concl <<<"${line}" || true
		if [ "${id:-}" = "${run}" ] && [[ "${sha:-}" =~ ^[0-9a-f]{40}$ ]] && [ -n "${st:-}" ]; then
			polled=yes
			fails=0
			head_sha="${sha}"
			status="${st}"
			conclusion="${concl:-}"
		else
			echo "note: run の応答を解析できない: '${line}'" >&2
		fi
	else
		echo "note: run を取得できない: $(tr '\n' ' ' <"${err}")" >&2
	fi
	if [ "${polled}" = "yes" ]; then
		if [ "${status}" = "waiting" ] || [ "${conclusion}" = "action_required" ]; then
			finish 4 waiting
		fi
		[ "${status}" != "completed" ] || finish 0 completed
	else
		fails=$((fails + 1))
		if [ "${fails}" -ge "${FAIL_LIMIT}" ]; then
			echo "run=${run}"
			echo "polls=${polls}"
			echo "error: run の取得に ${FAIL_LIMIT} 回続けて失敗した。状態を判定できない" >&2
			exit 2
		fi
	fi
	# 上限に達した後の取得を最後の取得にする。最後の取得が失敗したら、成功するまで（失敗が FAIL_LIMIT 回続くまで）取得し直す
	if [ "${polled}" = "yes" ] && [ "${started}" -ge "${deadline}" ]; then
		finish 1 timeout
	fi
	# 上限より後に次の取得を始めないよう、残りの時間が間隔より短ければ残りの時間だけ待つ（失敗した取得は間隔を空けてやり直す）
	left=$((deadline - $(date +%s)))
	if [ "${polled}" = "no" ] || [ "${left}" -ge "${interval}" ]; then
		sleep "${interval}"
	else
		sleep $((left > 0 ? left : 0))
	fi
done
