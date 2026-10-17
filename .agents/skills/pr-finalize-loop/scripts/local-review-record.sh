#!/usr/bin/env bash
# review_tool: local の記録を PR に残し（post）、現在の HEAD をレビューした記録があるかを判定する（check）。
#
# なぜ要るか: エージェントが手元で実行するレビュー（Claude Code の code-review --comment など）は、
# 指摘が 0 件だと PR に何も投稿しない。記録が無いと、HEAD をレビューしてから merge したのかを
# GitHub の上で確かめられない。そこで、レビューした HEAD の完全な SHA と指摘の件数を、
# 決まった形のトップレベルのコメントとして残し、判定はそのコメントの SHA と HEAD の一致で行う。
#
# 使い方:
#   local-review-record.sh post --pr <PR URL|番号> --sha <レビューした HEAD の完全な SHA> --findings <件数> \
#     [--reviewer <レビューに使った機能>] [--details <追記する本文のファイル>]
#   local-review-record.sh check --pr <PR URL|番号>
#
# 記録の 1 行目（判定はこの行だけを読む）:
#   <!-- pr-finalize-loop:local-review sha=<40 桁の SHA> findings=<件数> -->
#
# check は key=value の行を出力する。パースして使う。
#   head=<sha>        現在の headRefOid。
#   status=<value>    reviewed か not-reviewed。
#   record=<id>       HEAD と一致する記録のコメントの id。reviewed のときだけ出す。
#   findings=<n>      その記録の指摘の件数。reviewed のときだけ出す。
#   records=<n>       形の正しい記録の件数。SHA は問わない。
#   ignored=<n>       読み飛ばした記録の件数。理由は stderr に 1 件ずつ出す。
#
# 終了コードは次のとおりである。どちらのモードも、引数が不正なら 64 を返す。
#   check: 0 は HEAD をレビューした記録がある。1 は無い。2 は判定できない。
#   post:  0 は投稿した。1 は渡した SHA が HEAD と違う（投稿しない）。2 は取得か投稿に失敗した。
#          3 は gh のユーザーが PR の作成者でも担当者でもない（投稿しない）。
#
# post が投稿しない 2 つの理由は、呼び出し側の対処が違う（1 はレビューし直す、3 は投稿する人を変える）ので、終了コードを分ける。
set -euo pipefail

MARKER_PREFIX="<!-- pr-finalize-loop:local-review "

usage() {
	cat >&2 <<'EOF'
usage: local-review-record.sh post --pr <PR URL|番号> --sha <SHA> --findings <件数> [--reviewer <text>] [--details <file>]
       local-review-record.sh check --pr <PR URL|番号>
EOF
}

die_usage() {
	echo "error: $1" >&2
	usage
	exit 64
}

[ "$#" -ge 1 ] || die_usage "モード（post か check）が無い"
mode="$1"
shift
case "${mode}" in
post | check) ;;
-h | --help)
	usage
	exit 0
	;;
*) die_usage "不明なモード: ${mode}" ;;
esac

pr=""
sha=""
findings=""
reviewer="local"
details=""
# 値を持つ引数は、重ねて渡したら拒否する（後の値で警告なしに上書きしない）
seen=" "
while [ "$#" -gt 0 ]; do
	case "$1" in
	--pr | --sha | --findings | --reviewer | --details)
		[ "$#" -ge 2 ] || die_usage "$1 に値がない"
		[ -n "$2" ] || die_usage "$1 の値が空"
		case "${seen}" in *" $1 "*) die_usage "$1 が 2 回渡された" ;; esac
		seen="${seen}$1 "
		case "$1" in
		--pr) pr="$2" ;;
		--sha) sha="$2" ;;
		--findings) findings="$2" ;;
		--reviewer) reviewer="$2" ;;
		--details) details="$2" ;;
		esac
		shift 2
		;;
	*) die_usage "不明な引数: $1" ;;
	esac
done

[ -n "${pr}" ] || die_usage "--pr が無い"
if [ "${mode}" = "check" ]; then
	[ "${seen}" = " --pr " ] || die_usage "check は --pr だけを受け取る"
else
	[ -n "${sha}" ] || die_usage "--sha が無い"
	[ -n "${findings}" ] || die_usage "--findings が無い"
	[[ "${sha}" =~ ^[0-9a-f]{40}$ ]] || die_usage "--sha は 40 桁の小文字の 16 進数にする（短縮した SHA は受け取らない）: ${sha}"
	[[ "${findings}" =~ ^(0|[1-9][0-9]*)$ ]] || die_usage "--findings は 0 以上の整数にする: ${findings}"
	if [ -n "${details}" ] && [ ! -r "${details}" ]; then
		die_usage "--details のファイルを読めない: ${details}"
	fi
	case "${reviewer}" in *$'\n'*) die_usage "--reviewer に改行を入れない" ;; esac
fi

# PR の URL・HEAD・作成者・担当者を取得する。番号だけなら、gh が現在の repo の PR として扱う。
# 欄の区切りは U+001F にする。タブは read の IFS で空白として扱われ、空の欄が詰まって後ろの値が前の欄に入る。
pr_err=$(mktemp)
trap 'rm -f "${pr_err}"' EXIT
if ! pr_tsv=$(gh pr view "${pr}" --json url,headRefOid,author,assignees \
	--jq '[.url, .headRefOid, (.author.login // ""), ([.assignees[].login] | join(","))] | join("\u001f")' </dev/null 2>"${pr_err}"); then
	echo "error: PR を取得できない: $(tr '\n' ' ' <"${pr_err}")" >&2
	exit 2
fi
IFS=$'\x1f' read -r pr_url head author assignees <<<"${pr_tsv}" || true
if [[ ! "${pr_url:-}" =~ ^https://([^/]+)/([^/]+)/([^/]+)/pull/([0-9]+)$ ]]; then
	echo "error: PR の URL を解析できない: '${pr_url:-}'" >&2
	exit 2
fi
host="${BASH_REMATCH[1]}"
api_path="repos/${BASH_REMATCH[2]}/${BASH_REMATCH[3]}/issues/${BASH_REMATCH[4]}/comments"
host_args=()
[ "${host}" = "github.com" ] || host_args=(--hostname "${host}")
if [[ ! "${head:-}" =~ ^[0-9a-f]{40}$ ]]; then
	echo "error: PR の headRefOid が完全な SHA でない: '${head:-}'" >&2
	exit 2
fi
if [ -z "${author:-}" ]; then
	echo "error: PR の作成者を取得できない" >&2
	exit 2
fi
# gh pr view は GitHub App の作成者を app/<name> と返し、コメントの user.login は <name>[bot] になる。照合できる形に揃える
case "${author}" in app/*) author="${author#app/}[bot]" ;; esac
# 記録を書けるのは、PR の作成者と担当者だけにする（pr-finalize-loop が push できる人と同じ範囲）
allowed=",${author},${assignees:-},"

if [ "${mode}" = "post" ]; then
	if [ "${sha}" != "${head}" ]; then
		echo "error: 渡した SHA（${sha}）が PR の HEAD（${head}）と違う。HEAD をレビューし直してから記録する" >&2
		exit 1
	fi
	# check が読み飛ばす人の名前で投稿すると、記録が残っても HEAD はレビュー済みにならない
	if ! me=$(gh api ${host_args[@]+"${host_args[@]}"} user --jq '.login' </dev/null) || [ -z "${me}" ]; then
		echo "error: gh のユーザーを取得できない" >&2
		exit 2
	fi
	case "${allowed}" in
	*",${me},"*) ;;
	*)
		echo "error: gh のユーザー（${me}）は PR の作成者でも担当者でもないので、check はこの記録を読み飛ばす。作成者か担当者として投稿する" >&2
		exit 3
		;;
	esac
	body=$(mktemp)
	trap 'rm -f "${pr_err}" "${body}"' EXIT
	{
		printf '%ssha=%s findings=%s -->\n\n' "${MARKER_PREFIX}" "${sha}" "${findings}"
		printf '手元のレビューの記録: HEAD %s を %s でレビューし、指摘は %s 件だった。\n' "\`${sha}\`" "${reviewer}" "${findings}"
		if [ -n "${details}" ]; then
			printf '\n'
			cat "${details}"
		fi
	} >"${body}"
	if ! id=$(gh api ${host_args[@]+"${host_args[@]}"} --method POST "${api_path}" -F body=@"${body}" --jq '.id' </dev/null); then
		echo "error: 記録を投稿できない" >&2
		exit 2
	fi
	echo "record=${id}"
	exit 0
fi

# check: 記録の候補（本文が目印で始まるトップレベルのコメント）を、1 行目だけ取得する
if ! list=$(gh api ${host_args[@]+"${host_args[@]}"} --paginate "${api_path}?per_page=100" \
	--jq '.[] | select((.body // "") | startswith("'"${MARKER_PREFIX}"'")) | [(.id | tostring), (.user.login // ""), ((.body // "") | split("\n")[0] | rtrimstr("\r"))] | join("\u001f")' \
	</dev/null); then
	echo "error: PR のコメントを取得できない" >&2
	exit 2
fi

records=0
ignored=0
record=""
record_findings=""
while IFS=$'\x1f' read -r id login line; do
	[ -n "${id}" ] || continue
	case "${allowed}" in
	*",${login},"*) ;;
	*)
		echo "note: 記録 ${id} を読み飛ばした（${login} は PR の作成者でも担当者でもない）" >&2
		ignored=$((ignored + 1))
		continue
		;;
	esac
	if [[ ! "${line}" =~ ^"${MARKER_PREFIX}sha="([0-9a-f]{40})" findings="(0|[1-9][0-9]*)" -->"$ ]]; then
		echo "note: 記録 ${id} を読み飛ばした（1 行目の形が違う）" >&2
		ignored=$((ignored + 1))
		continue
	fi
	records=$((records + 1))
	# コメントは作成の順に返るので、HEAD と一致する記録のうち最後のものを使う
	if [ "${BASH_REMATCH[1]}" = "${head}" ]; then
		record="${id}"
		record_findings="${BASH_REMATCH[2]}"
	fi
done <<<"${list}"

echo "head=${head}"
# 出力と終了コードを同じ分岐で決める
status=1
if [ -n "${record}" ]; then
	status=0
	echo "status=reviewed"
	echo "record=${record}"
	echo "findings=${record_findings}"
else
	echo "status=not-reviewed"
fi
echo "records=${records}"
echo "ignored=${ignored}"
exit "${status}"
