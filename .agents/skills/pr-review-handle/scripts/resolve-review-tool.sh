#!/usr/bin/env bash
# review_tool の値を決定論的に決め、値と**出所の層**を出力する。
#
# なぜ要るか: 決める順序（references/review-tool.md「設定の解決」）を人が頭の中でたどると、
# 原本を読む前に設定の名前を推測して「未設定」と判定し、別のツールへ 3 回依頼したことがある。
# このスキルは順序をそのまま実行し、**どの層から来た値か**を表示する。利用者はそれを見てから値を使う。
#
# 使い方:
#   resolve-review-tool.sh [--review-tool <tool>] [--root <dir>]
#
# 層は CLI → common.local.jsonc → 人ごとの common.jsonc → common.jsonc → デフォルト copilot の順で、
# ファイルの層の読み取りと検証は同梱の skill-config.mjs（Node.js）に任せる。
# `--root` を省いたときのリポジトリのルートは、cwd ではなく `git rev-parse --show-toplevel` で決める
# （どこから起動しても同じ層を読む）。git の外なら cwd を使う。
#
# 設定ファイルが 1 つも無ければ、Node.js なしで決める（CLI の値か、デフォルト）。
# 設定ファイルがあって Node.js が無ければ、書いた設定を警告なしに無視しないように止まる。
#
# 出力（key=value の 2 行。パースして使う）:
#   value=<copilot|claude-code|codex|local|none>
#   source=<cli|local|user|repo|default>
#
# 終了コード: 0=値を決められた / 2=決められない（受け付けない値・設定の誤り・旧い場所の設定・Node.js が無い）/
# 64=引数が不正。
set -euo pipefail

ACCEPTED="copilot claude-code codex local none"
DEFAULT_TOOL="copilot"
NAMESPACE="shoji9x9"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
READER="${SCRIPT_DIR}/skill-config/skill-config.mjs"
root=""
cli_value=""
cli_given=""

usage() {
	echo "usage: resolve-review-tool.sh [--review-tool <tool>] [--root <dir>]" >&2
}

while [ "$#" -gt 0 ]; do
	case "$1" in
	--review-tool | --root)
		[ "$#" -ge 2 ] || {
			echo "error: $1 に値がない" >&2
			usage
			exit 64
		}
		# 空文字を「未指定」と同じに扱うと、指定したつもりの層と報告される層がずれる。ここでエラーにする。
		[ -n "$2" ] || {
			echo "error: $1 の値が空" >&2
			usage
			exit 64
		}
		if [ "$1" = "--review-tool" ]; then
			cli_value="$2"
			cli_given="1"
		else
			root="$2"
		fi
		shift 2
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		echo "error: 不明な引数: $1" >&2
		usage
		exit 64
		;;
	esac
done

is_accepted() {
	local candidate="$1" accepted
	for accepted in ${ACCEPTED}; do
		[ "${candidate}" = "${accepted}" ] && return 0
	done
	return 1
}

if [ -z "${root}" ]; then
	root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

if [ -n "${cli_given}" ] && ! is_accepted "${cli_value}"; then
	echo "error: 受理しない review_tool: '${cli_value}'（出所: cli）。受理するのは ${ACCEPTED}" >&2
	exit 2
fi

# 旧い場所の設定は、Node.js が無くても検出する（読み取りも同じものを検出するが、Node.js が無いと届かない）。
legacy=""
if [ "${SKILLS_REVIEW_TOOL+set}" = "set" ]; then
	legacy="${legacy}
- 環境変数 SKILLS_REVIEW_TOOL は使わなくなった。値を common.local.jsonc（このリポジトリの自分だけ）か人ごとの common.jsonc（自分のすべてのリポジトリ）の review_tool に移し、環境変数を .env などから消す。1 回だけ変えるなら、--review-tool で渡す"
fi
yml="${root}/.config/skills/shoji9x9/skills.yml"
if [ -e "${yml}" ]; then
	legacy="${legacy}
- ${yml} が残っている。skills.common の節を common.jsonc に、skills.<スキル名> の節を <スキル名>.jsonc に移し、skills.yml を消す"
fi
if [ -n "${legacy}" ]; then
	echo "error: 旧い場所の設定が残っているので止める（references/config-files.md「移行」）。${legacy}" >&2
	exit 2
fi

case "${XDG_CONFIG_HOME:-}" in
/*) user_home="${XDG_CONFIG_HOME}" ;;
*)
	# HOME が無いか空なら、読み取りと同じく、ユーザーのデータベースのホームを使う
	home_dir="${HOME:-}"
	[ -n "${home_dir}" ] || home_dir=$(
		unset HOME
		printf '%s' ~
	)
	# ユーザーのデータベースにエントリが無いと ~ が展開されずに残るので、空として扱う
	[ "${home_dir}" != "~" ] || home_dir=""
	user_home="${home_dir:+${home_dir}/}.config"
	;;
esac
# 人ごとの層を読まない指定は、読み取りと同じく 1 だけを受け付ける。設定ファイルが無いときも同じ結果にするため、ここでも確かめる
user_file="${user_home}/skills/${NAMESPACE}/common.jsonc"
if [ "${SHOJI9X9_SKILLS_IGNORE_USER_CONFIG+set}" = "set" ]; then
	if [ "${SHOJI9X9_SKILLS_IGNORE_USER_CONFIG}" != "1" ]; then
		printf 'error: 環境変数 SHOJI9X9_SKILLS_IGNORE_USER_CONFIG は 1 だけを受け付ける（%q）。人ごとの層を読むなら変数を消す\n' "${SHOJI9X9_SKILLS_IGNORE_USER_CONFIG}" >&2
		exit 2
	fi
	user_file=""
fi
# 人ごとの層の置き場所が絶対パスに決まらなければ、読み取りと同じく人ごとの層を読まない（リポジトリのファイルと同じパスを指しうる）
case "${user_home}" in
/*) ;;
*) user_file="" ;;
esac
present=""
for f in \
	"${root}/.config/skills/${NAMESPACE}/common.local.jsonc" \
	"${user_file}" \
	"${root}/.config/skills/${NAMESPACE}/common.jsonc"; do
	[ -n "${f}" ] && [ -e "${f}" ] && present="${present} ${f}"
done

if [ -z "${present}" ]; then
	if [ -n "${cli_given}" ]; then
		echo "value=${cli_value}"
		echo "source=cli"
		exit 0
	fi
	# デフォルトを使った理由と参照先を必ず残す。残さないと、ルートを取り違えたときも source=default を正しい結果として報告する。
	echo "note: common の設定ファイルが無いため既定を使う（参照: ${root}/.config/skills/${NAMESPACE}/common.jsonc ほか）" >&2
	echo "value=${DEFAULT_TOOL}"
	echo "source=default"
	exit 0
fi

if ! command -v node >/dev/null 2>&1; then
	echo "error: 設定ファイル（${present# }）があるのに Node.js が無いので読めない。Node.js を入れるか、--review-tool で渡す" >&2
	exit 2
fi

args=(get common review_tool --root "${root}")
[ -n "${cli_given}" ] && args+=(--cli-value "\"${cli_value}\"")
rc=0
out="$(node "${READER}" "${args[@]}")" || rc=$?
if [ "${rc}" -ne 0 ]; then
	# 読み取りが理由を stderr に出している。exit 3（値が無い）はデフォルトがあるので起きない
	echo "error: review_tool を決められない（skill-config.mjs の終了コード ${rc}）" >&2
	exit 2
fi
value=""
source=""
while IFS= read -r line; do
	case "${line}" in
	value=*) value="${line#value=}" ;;
	source=*) source="${line#source=}" ;;
	esac
done <<<"${out}"
# 値は JSON の文字列（"copilot"）なので、引用符を外す。受け付ける値は引用符もエスケープも含まない
value="${value#\"}"
value="${value%\"}"

if ! is_accepted "${value}"; then
	echo "error: 受理しない review_tool: '${value}'（出所: ${source}）。受理するのは ${ACCEPTED}" >&2
	exit 2
fi
if [ "${source}" = "default" ]; then
	echo "note: common の設定ファイルに review_tool が無いため既定を使う（参照: ${present# }）" >&2
fi
echo "value=${value}"
echo "source=${source}"
