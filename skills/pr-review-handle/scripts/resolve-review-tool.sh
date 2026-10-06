#!/usr/bin/env bash
# review_tool の値を決定論的に決め、値と**出所の層**を出力する。
#
# なぜ要るか: 決める順序（CLI → 環境変数 → 共有 YAML → デフォルト）を人が頭の中でたどると、
# 原本を読む前に環境変数名を推測して「未設定」と判定し、別のツールへ 3 回依頼したことがある。
# このスクリプトは原本（references/review-tool.md）の順序をそのまま実行し、**どの層から来た値か**を
# 表示する。利用者はそれを見てから値を使う。
#
# 使い方:
#   resolve-review-tool.sh [--review-tool <tool>] [--config <path>]
#
# `--config` を省いたときの共有設定のパスは、cwd ではなく `git rev-parse --show-toplevel` を基準に
# 決める（どこから起動しても同じ層を読む）。
#
# 出力（key=value の 2 行。パースして使う）:
#   value=<copilot|claude-code|codex|none>
#   source=<cli|env|config|default>
#
# 終了コード: 0=値を決められた / 2=受理しない値（警告なしにデフォルトとして扱わず、止まる） / 64=引数が不正。
set -euo pipefail

ACCEPTED="copilot claude-code codex none"
DEFAULT_TOOL="copilot"
# 共有設定のデフォルトのパスは、**リポジトリルートを基準**に決める。cwd からの相対パスのままだと、
# サブディレクトリから起動しただけで config 層が警告なしに飛ばされ、`source=default` を
# 正しい結果として報告してしまう（このスクリプトが防ぐはずの誤った報告そのもの）。
CONFIG_REL=".config/skills/shoji9x9/skills.yml"
config_path=""
config_explicit=""
cli_value=""

usage() {
	echo "usage: resolve-review-tool.sh [--review-tool <tool>] [--config <path>]" >&2
}

while [ "$#" -gt 0 ]; do
	case "$1" in
	--review-tool)
		[ "$#" -ge 2 ] || {
			echo "error: --review-tool に値がない" >&2
			usage
			exit 64
		}
		# 空文字は「未指定」と同じに扱われ、CLI の指定が警告なしに下の層（env / config）の値になる。
		# 指定したつもりの層と報告される層がずれるので、ここでエラーにする。
		[ -n "$2" ] || {
			echo "error: --review-tool の値が空" >&2
			usage
			exit 64
		}
		cli_value="$2"
		shift 2
		;;
	--config)
		[ "$#" -ge 2 ] || {
			echo "error: --config に値がない" >&2
			usage
			exit 64
		}
		[ -n "$2" ] || {
			echo "error: --config の値が空" >&2
			usage
			exit 64
		}
		config_path="$2"
		config_explicit="1"
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

# --config が無ければ、リポジトリルートを基準にしたデフォルトのパスを使う。git の外なら cwd からの相対パスにする。
# 判定には「--config が渡されたか」を使う。空文字は上でエラーにしてあるが、
# 値が空かどうかで分けると、`--config ""` のような入力が警告なしにデフォルトとして扱われる形に戻りやすい。
if [ -z "${config_explicit}" ]; then
	repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
	if [ -n "${repo_root}" ]; then
		config_path="${repo_root}/${CONFIG_REL}"
	else
		config_path="${CONFIG_REL}"
	fi
fi

is_accepted() {
	local candidate="$1" accepted
	for accepted in ${ACCEPTED}; do
		[ "${candidate}" = "${accepted}" ] && return 0
	done
	return 1
}

# skills.common.review_tool を読む。インデントで階層を追い、行末コメントと引用符を落とす。
# 深さを見ずに `review_tool:` を拾うと、別セクションの同名キーを掴む。
read_config() {
	[ -f "${config_path}" ] || return 1
	awk '
		function strip(v) {
			sub(/#.*/, "", v)
			gsub(/^[ \t]+|[ \t]+$/, "", v)
			gsub(/^["'"'"']|["'"'"']$/, "", v)
			return v
		}
		{
			line = $0
			sub(/\r$/, "", line)
			if (line ~ /^[ \t]*(#|$)/) next
			match(line, /^[ \t]*/)
			indent = RLENGTH
			key = line
			sub(/^[ \t]*/, "", key)
			sub(/:.*$/, "", key)
			rest = line
			sub(/^[^:]*:/, "", rest)

			if (indent == 0) { in_skills = (key == "skills"); in_common = 0; next }
			if (!in_skills) next
			if (key == "common") { in_common = 1; common_indent = indent; next }
			if (in_common && indent <= common_indent) { in_common = 0 }
			if (in_common && key == "review_tool") { print strip(rest); exit }
		}
	' "${config_path}"
}

value=""
source=""

if [ -n "${cli_value}" ]; then
	value="${cli_value}"
	source="cli"
elif [ -n "${SKILLS_REVIEW_TOOL:-}" ]; then
	value="${SKILLS_REVIEW_TOOL}"
	source="env"
else
	# env が「設定したのに空」のまま次の層へ進むと、指定したつもりの層と報告される層がずれる。
	# ただし `SKILLS_REVIEW_TOOL= cmd` は env 層を無効にするよく使われる書き方なので、CLI の空の値
	# （exit 64）とは扱いを分ける。飛ばしたことを出力に残してから、下の層へ進む。
	if [ "${SKILLS_REVIEW_TOOL+set}" = "set" ]; then
		echo "note: SKILLS_REVIEW_TOOL が空のため env 層を飛ばす（無効化として扱う）" >&2
	fi
	config_value="$(read_config || true)"
	if [ -n "${config_value}" ]; then
		value="${config_value}"
		source="config"
	else
		value="${DEFAULT_TOOL}"
		source="default"
		# デフォルトを使った理由と参照先を必ず残す。`--config` を指定したときも出す。
		# パスを渡し間違えたときに出さないと、「ファイルが無い」と「キーが無い」が同じ
		# `source=default` になり、誤ったパスを警告なしに受け入れることになる。
		if [ -f "${config_path}" ]; then
			echo "note: 共有設定に review_tool が無いため既定を使う（参照: ${config_path}）" >&2
		else
			echo "note: 共有設定が見つからないため既定を使う（参照: ${config_path}）" >&2
		fi
	fi
fi

if ! is_accepted "${value}"; then
	echo "error: 受理しない review_tool: '${value}'（出所: ${source}）。受理するのは ${ACCEPTED}" >&2
	exit 2
fi

echo "value=${value}"
echo "source=${source}"
