#!/usr/bin/env bash
# 依頼したレビューが PR の HEAD に届くのを、上限を決めて待つ。
# 届いたかは、次の 3 つの方法を毎回すべて見て判定する。
#   review:      PR の作成者以外のレビュー（bot か、リポジトリへの書き込み権限を持つ人のもの）で、commit が HEAD のもの。
#   check-run:   --check-run-name で名前を渡したレビュー用の check-run のうち、HEAD に付いて完了したもの。
#   bot-comment: PR の作成者以外の bot のトップレベルのコメントのうち、本文に HEAD の SHA を書いたもの。
#                短縮した SHA は、HEAD に解決できるものだけを数える。
#
# なぜ要るか: 同じレビューツールでも、起動のきっかけによって結果の置き場所が変わる。
# pull_request で起動したレビューは HEAD に check-run を付けるが、issue_comment（`@claude review` など）で起動した
# レビューは HEAD に check-run を付けず、bot のコメントだけで届くことがある。
# issue_comment で起動したワークフローの GITHUB_SHA はデフォルトブランチの commit だからである
# （https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issue_comment）。
# 1 つの方法だけを見て待つと、届いたレビューを上限まで待ち続けるので、起動のきっかけで方法を選ばずに 3 つとも見る。
#
# 使い方は次のとおりである。
#
#     wait-review.sh --pr <PR URL|番号> --head-file <file> --since <時刻> --timeout <秒>
#                    [--interval <秒>] [--check-run-name <名前>]... [--seen <種類>:<id>@<時刻>]...
#
#   --head-file       待つ HEAD の完全な SHA を保存したファイル。表示から書き写さずに渡す。
#   --since           GitHub の時刻の形（YYYY-MM-DDTHH:MM:SSZ。UTC）。依頼した時刻（push した反復では push が終わった時刻、
#                     返信だけの反復では最後に投稿した返信の createdAt）。これより前のレビュー・check-run・コメントは数えない。
#   --timeout         待つ上限（秒）。上限に達したら、3 つの方法でもう 1 回取得してから timeout を返す。0 なら 1 回だけ取得する。
#   --interval        取得の間隔（秒）。デフォルトは 30。
#   --check-run-name  レビュー用の check-run の名前（完全一致）。何度でも渡せる。名前を渡さないと、check-run では届いたと判定しない。
#                     名前の部分一致は根拠にしない（dependency-review のような通常の CI を数えてしまう）。
#   --seen            前の呼び出しで返した根拠のうち、中身を読んでレビューの完了ではないと判断したもの。
#                     <種類> は check-run か bot-comment。<時刻> は返した行の時刻（check-run は completed_at、bot-comment は updated_at）。
#                     同じ id でも時刻が変われば（作業中のコメントが完了の表記に編集されたなど）、もう一度根拠にする。
#
# 出力は key=value の行である。パースして使う。
#   head=<sha>          待った HEAD。
#   result=<value>      arrived・timeout・head-changed・closed・check-run-failed のどれか。
#                       arrived: 3 つの方法のどれかで届いた。evidence の行を読む。
#                       timeout: 上限まで、どの方法でも届かなかった。
#                       head-changed: PR の HEAD が --head-file の SHA と違う（別の push があった）。待たずに状態を取得し直す。
#                       closed: PR が OPEN でない。
#                       check-run-failed: 名前を渡したレビュー用の check-run が、success・neutral 以外で完了した。
#   evidence=<種類>\t<id>\t<時刻>\t<URL>
#                       届いた根拠。1 回の取得で見つけたものをすべて、review・check-run・bot-comment の順に出す。
#                       review は bot か書き込み権限を確かめたものなので、そのまま根拠にしてよい。
#                       check-run は出力（output.title・output.summary）を、bot-comment は本文を切り詰めずに読み、
#                       レビューが行われて完了したこと（skip・spend cap・作業中の表記でないこと）を確かめてから根拠にする。
#                       完了でなければ、その行を --seen に渡して呼び直す。
#   polls=<n>           取得した回数。
#   pending_check_runs=<名前>
#                       名前を渡した check-run のうち、HEAD で終わっていないもの（カンマ区切り）。無ければ出さない。
#   unnamed_check_run=<id>\t<名前>\t<app>\t<conclusion>
#                       timeout のときに、名前を渡していない check-run のうち、--since より後に HEAD で完了したもの。
#                       レビュー用かを app・名前・出力から仕分ける材料にする（この行だけでは届いた根拠にしない）。
#   failed_check_run=<id>\t<名前>\t<conclusion>
#                       check-run-failed のときの、その check-run。
#
# 終了コード: 0 は arrived。1 は timeout。2 は取得に続けて失敗した（判定できない）。
#   3 は head-changed か closed。4 は check-run-failed。引数が不正なら 64。
set -euo pipefail

FAIL_LIMIT=3
SHA_RE='^[0-9a-f]{40}$'
TIME_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'

usage() {
	cat >&2 <<'EOF'
usage: wait-review.sh --pr <PR URL|番号> --head-file <file> --since <時刻> --timeout <秒>
                      [--interval <秒>] [--check-run-name <名前>]... [--seen <種類>:<id>@<時刻>]...
EOF
}

die_usage() {
	echo "error: $1" >&2
	usage
	exit 64
}

pr=""
head_file=""
since=""
timeout=""
interval=""
names=()
seen=()
given=" "
while [ "$#" -gt 0 ]; do
	flag="$1"
	case "${flag}" in
	-h | --help)
		usage
		exit 0
		;;
	--pr | --head-file | --since | --timeout | --interval | --check-run-name | --seen) ;;
	*) die_usage "不明な引数: ${flag}" ;;
	esac
	{ [ "$#" -ge 2 ] && [ -n "$2" ]; } || die_usage "${flag} に値が無いか、値が空"
	case "${flag}" in
	--check-run-name) names+=("$2") ;;
	--seen)
		[[ "$2" =~ ^(check-run|bot-comment):[1-9][0-9]*@[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
			die_usage "--seen は <check-run|bot-comment>:<id>@<YYYY-MM-DDTHH:MM:SSZ> の形にする: $2"
		seen+=("$2")
		;;
	*)
		# 値を 1 つだけ持つ引数は、重ねて渡したら拒否する（後の値で警告なしに上書きしない）
		[[ "${given}" != *" ${flag} "* ]] || die_usage "${flag} が 2 回渡された"
		given="${given}${flag} "
		name="${flag#--}"
		printf -v "${name//-/_}" '%s' "$2"
		;;
	esac
	shift 2
done

[ -n "${pr}" ] || die_usage "--pr が無い"
[ -n "${head_file}" ] || die_usage "--head-file が無い（待つ HEAD の SHA を、表示から書き写さずに渡す）"
[ -n "${since}" ] || die_usage "--since が無い（依頼した時刻より前のレビューを、届いた根拠にしないために要る）"
[ -n "${timeout}" ] || die_usage "--timeout が無い（上限の無い待ちにしない）"
[[ "${since}" =~ ${TIME_RE} ]] || die_usage "--since は GitHub の時刻の形（YYYY-MM-DDTHH:MM:SSZ。UTC）にする: ${since}"
[[ "${timeout}" =~ ^(0|[1-9][0-9]{0,5})$ ]] || die_usage "--timeout は 0 以上の整数（秒）にする: ${timeout}"
interval="${interval:-30}"
[[ "${interval}" =~ ^(0|[1-9][0-9]{0,4})$ ]] || die_usage "--interval は 0 以上の整数（秒）にする: ${interval}"
[ -f "${head_file}" ] && [ -r "${head_file}" ] || die_usage "--head-file のファイルを読めない: ${head_file}"
head=$(<"${head_file}")
[[ "${head}" =~ ${SHA_RE} ]] || die_usage "--head-file の中身は 40 桁の小文字の 16 進数にする（短縮した SHA は受け取らない）: ${head}"

err=$(mktemp)
trap 'rm -f "${err}"' EXIT

# 1 回の取得の失敗は、次の取得でやり直す。FAIL_LIMIT 回続いたら判定できないとして止まる
fails=0
note_fail() {
	echo "note: $1: $(tr '\n' ' ' <"${err}")" >&2
	fails=$((fails + 1))
	if [ "${fails}" -ge "${FAIL_LIMIT}" ]; then
		echo "head=${head}"
		echo "polls=${polls}"
		echo "error: 取得に ${FAIL_LIMIT} 回続けて失敗した。届いたかを判定できない" >&2
		exit 2
	fi
}

is_seen() {
	local key="$1" s
	for s in ${seen[@]+"${seen[@]}"}; do
		[ "${s}" != "${key}" ] || return 0
	done
	return 1
}

is_named() {
	local n
	for n in ${names[@]+"${names[@]}"}; do
		[ "${n}" != "$1" ] || return 0
	done
	return 1
}

# 取得した値を、呼び出しの間で覚えておく（連想配列は bash 4 が要るので、「キー<US>値」の行で持つ）
cache_get() {
	local table="$1" key="$2" k v
	while IFS=$'\x1f' read -r k v; do
		if [ -n "${k}" ] && [ "${k}" = "${key}" ]; then
			printf '%s' "${v}"
			return 0
		fi
	done <<<"${table}"
	return 1
}

# login の書き込み権限を確かめる（admin か write）。取得できなければ、その取得では権限が無いとして扱う。
# 失敗した結果は覚えず、次の取得で問い合わせ直す（一時的な失敗で、届いたレビューを上限まで数えなくならないようにする）
perm_cache=""
has_write() {
	local login="$1" p
	if ! p=$(cache_get "${perm_cache}" "${login}"); then
		if p=$(gh api ${host_args[@]+"${host_args[@]}"} "${repo_path}/collaborators/${login}/permission" --jq '.permission' </dev/null 2>"${err}"); then
			perm_cache="${perm_cache}${login}"$'\x1f'"${p}"$'\n'
		else
			echo "note: ${login} の権限を取得できないので、そのレビューを数えない: $(tr '\n' ' ' <"${err}")" >&2
			p=""
		fi
	fi
	[ "${p}" = "admin" ] || [ "${p}" = "write" ]
}

# 短縮した SHA を完全な SHA に解決し、HEAD と一致するかを返す。解決できなければ、その取得では一致しないとして扱う。
# 失敗した結果は覚えず、次の取得で問い合わせ直す
sha_cache=""
resolves_to_head() {
	local token="$1" full
	if ! full=$(cache_get "${sha_cache}" "${token}"); then
		if full=$(gh api ${host_args[@]+"${host_args[@]}"} "${repo_path}/commits/${token}" --jq '.sha' </dev/null 2>"${err}"); then
			sha_cache="${sha_cache}${token}"$'\x1f'"${full}"$'\n'
		else
			echo "note: ${token} を完全な SHA に解決できない: $(tr '\n' ' ' <"${err}")" >&2
			full=""
		fi
	fi
	[ "${full}" = "${head}" ]
}

# 1 回の取得。結果は evidence・result_now・pending・unnamed・failed_run に入れる。取得に失敗したら 1 を返す
poll() {
	local line url cur_head author state id login type commit_id submitted html_url
	local name status conclusion completed app tokens updated token matched
	evidence=()
	pending=""
	unnamed=()
	failed_run=""
	failed_cands=()
	result_now=""

	line=$(gh pr view "${pr}" --json url,headRefOid,state,author \
		--jq '[.url, .headRefOid, .state, .author.login] | join("\u001f")' </dev/null 2>"${err}") || {
		note_fail "PR を取得できない"
		return 1
	}
	IFS=$'\x1f' read -r url cur_head state author <<<"${line}" || true
	if [[ ! "${url:-}" =~ ^https://([^/]+)/([^/]+)/([^/]+)/pull/([0-9]+)$ ]] || [ -z "${author:-}" ]; then
		echo "note: PR の応答を解析できない: '${line}'" >&2
		: >"${err}"
		note_fail "PR の応答が想定と違う"
		return 1
	fi
	repo_path="repos/${BASH_REMATCH[2]}/${BASH_REMATCH[3]}"
	number="${BASH_REMATCH[4]}"
	host_args=()
	if [ "${BASH_REMATCH[1]}" != "github.com" ]; then
		host_args=(--hostname "${BASH_REMATCH[1]}")
	fi
	if [ "${state}" != "OPEN" ]; then
		result_now="closed"
		return 0
	fi
	if [ "${cur_head}" != "${head}" ]; then
		result_now="head-changed"
		return 0
	fi

	# review: 作成者以外で、commit が HEAD、--since より後に submit したもの（PENDING は submitted_at が無い）
	local reviews
	reviews=$(gh api ${host_args[@]+"${host_args[@]}"} --paginate "${repo_path}/pulls/${number}/reviews?per_page=100" \
		--jq '.[] | select(.submitted_at != null) | [(.id | tostring), (.user.login // ""), (.user.type // ""), (.commit_id // ""), .submitted_at, (.html_url // "")] | join("\u001f")' \
		</dev/null 2>"${err}") || {
		note_fail "レビューを取得できない"
		return 1
	}
	while IFS=$'\x1f' read -r id login type commit_id submitted html_url; do
		[ -n "${id}" ] || continue
		[ "${login}" != "${author}" ] || continue
		[ "${commit_id}" = "${head}" ] || continue
		[[ ! "${submitted}" < "${since}" ]] || continue
		if [ "${type}" = "Bot" ] || has_write "${login}"; then
			evidence+=("review"$'\t'"${id}"$'\t'"${submitted}"$'\t'"${html_url}")
		fi
	done <<<"${reviews}"

	# check-run: HEAD に付いたもの。名前を渡したものだけを届いた根拠にする
	local runs
	runs=$(gh api ${host_args[@]+"${host_args[@]}"} --paginate "${repo_path}/commits/${head}/check-runs?filter=all&per_page=100" \
		--jq '.check_runs[] | [(.id | tostring), .name, (.status // ""), (.conclusion // ""), (.completed_at // ""), (.app.slug // ""), (.html_url // "")] | join("\u001f")' \
		</dev/null 2>"${err}") || {
		note_fail "check-run を取得できない"
		return 1
	}
	while IFS=$'\x1f' read -r id name status conclusion completed app html_url; do
		[ -n "${id}" ] || continue
		if ! is_named "${name}"; then
			if [ "${status}" = "completed" ] && [ -n "${completed}" ] && [[ ! "${completed}" < "${since}" ]]; then
				unnamed+=("${id}"$'\t'"${name}"$'\t'"${app}"$'\t'"${conclusion}")
			fi
			continue
		fi
		if [ "${status}" != "completed" ]; then
			pending="${pending:+${pending},}${name}"
			continue
		fi
		[[ ! "${completed}" < "${since}" ]] || continue
		is_seen "check-run:${id}@${completed}" && continue
		case "${conclusion}" in
		success | neutral) evidence+=("check-run"$'\t'"${id}"$'\t'"${completed}"$'\t'"${html_url}") ;;
		*) failed_cands+=("${id}"$'\t'"${name}"$'\t'"${conclusion}") ;;
		esac
	done <<<"${runs}"
	# filter=all は同じ名前の古い試行も返す。同じ名前の試行がまだ終わっていなければ（再実行中など）、失敗した試行で待つのをやめない
	local cand cand_name
	for cand in ${failed_cands[@]+"${failed_cands[@]}"}; do
		IFS=$'\t' read -r _ cand_name _ <<<"${cand}"
		if [[ ",${pending}," != *",${cand_name},"* ]]; then
			failed_run="${cand}"
			break
		fi
	done

	# bot-comment: 作成者以外の bot のコメントで、--since より後に作るか編集したもの。本文の SHA で HEAD と結ぶ
	local comments
	comments=$(gh api ${host_args[@]+"${host_args[@]}"} --paginate "${repo_path}/issues/${number}/comments?per_page=100" \
		--jq '.[] | select((.user.type // "") == "Bot") | [(.id | tostring), (.user.login // ""), (.updated_at // .created_at), (.html_url // ""), ([(.body // "") | scan("[0-9A-Za-z]+") | select(test("^[0-9a-f]{7,40}$"))] | unique | join(" "))] | join("\u001f")' \
		</dev/null 2>"${err}") || {
		note_fail "PR のコメントを取得できない"
		return 1
	}
	while IFS=$'\x1f' read -r id login updated html_url tokens; do
		[ -n "${id}" ] || continue
		[ "${login}" != "${author}" ] || continue
		[[ ! "${updated}" < "${since}" ]] || continue
		is_seen "bot-comment:${id}@${updated}" && continue
		matched=""
		for token in ${tokens}; do
			if [ "${token}" = "${head}" ]; then
				matched=yes
			elif [ "${#token}" -lt 40 ] && [ "${head#"${token}"}" != "${head}" ] && resolves_to_head "${token}"; then
				# HEAD の前方と一致する短縮した SHA だけを、API で完全な SHA に解決して確かめる
				matched=yes
			fi
			[ -z "${matched}" ] || break
		done
		[ -n "${matched}" ] || continue
		evidence+=("bot-comment"$'\t'"${id}"$'\t'"${updated}"$'\t'"${html_url}")
	done <<<"${comments}"

	fails=0
	if [ "${#evidence[@]}" -gt 0 ]; then
		result_now="arrived"
	elif [ -n "${failed_run}" ]; then
		result_now="check-run-failed"
	fi
	return 0
}

finish() {
	local code="$1" e
	echo "head=${head}"
	echo "result=${result_now}"
	for e in ${evidence[@]+"${evidence[@]}"}; do
		echo "evidence=${e}"
	done
	echo "polls=${polls}"
	[ -z "${pending}" ] || echo "pending_check_runs=${pending}"
	if [ "${result_now}" = "timeout" ]; then
		for e in ${unnamed[@]+"${unnamed[@]}"}; do
			echo "unnamed_check_run=${e}"
		done
	fi
	[ "${result_now}" != "check-run-failed" ] || echo "failed_check_run=${failed_run}"
	exit "${code}"
}

polls=0
evidence=()
unnamed=()
pending=""
failed_run=""
result_now=""
deadline=$(($(date +%s) + timeout))
while :; do
	polls=$((polls + 1))
	polled=no
	# 取得を始めた時刻で上限と比べる。取得に時間がかかって上限を過ぎても、上限より前に始めた取得は、上限の後の取得に数えない
	started=$(date +%s)
	if poll; then
		polled=yes
		case "${result_now}" in
		arrived) finish 0 ;;
		head-changed | closed) finish 3 ;;
		check-run-failed) finish 4 ;;
		esac
	fi
	# 上限に達した後の取得を、最後の取得し直しにする（上限を超えたことだけで、届いていないと判定しない）。
	# 最後の取得が失敗したら、届いていないとは言えないので、成功するまで（失敗が FAIL_LIMIT 回続くまで）取得し直す
	if [ "${polled}" = "yes" ] && [ "${started}" -ge "${deadline}" ]; then
		result_now="timeout"
		finish 1
	fi
	# 失敗した取得は間隔を空けてやり直す。成功した取得は、上限を越えない範囲で間隔を空ける
	wait_for="${interval}"
	if [ "${polled}" = "yes" ]; then
		now=$(date +%s)
		[ $((deadline - now)) -ge "${interval}" ] || wait_for=$((deadline - now))
		[ "${wait_for}" -ge 0 ] || wait_for=0
	fi
	sleep "${wait_for}"
done
