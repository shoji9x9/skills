#!/usr/bin/env bash
# review_tool の解決を決定論的に行い、値と**出所の層**を出力する。
#
# なぜ要るか: 多層の解決順（CLI → 環境変数 → 共有 YAML → 既定）を人が頭で引くと、
# 正本を読む前に環境変数名を推測して「未設定」と判定し、別のツールへ 3 回依頼した事故が起きた。
# 解決は正本（references/review-tool.md）の順序をそのまま実行し、**どの層から来た値か**を
# 表示してから使う。
#
# 使い方:
#   resolve-review-tool.sh [--review-tool <tool>] [--config <path>]
#
# 出力（key=value の 2 行。パースして使う）:
#   value=<copilot|claude-code|codex|none>
#   source=<cli|env|config|default>
#
# 終了コード: 0=解決できた / 2=受理しない値（黙って既定へ倒さず停止する） / 64=引数が不正。
set -euo pipefail

ACCEPTED="copilot claude-code codex none"
DEFAULT_TOOL="copilot"
config_path=".config/skills/shoji9x9/skills.yml"
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
		cli_value="$2"
		shift 2
		;;
	--config)
		[ "$#" -ge 2 ] || {
			echo "error: --config に値がない" >&2
			usage
			exit 64
		}
		config_path="$2"
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
	config_value="$(read_config || true)"
	if [ -n "${config_value}" ]; then
		value="${config_value}"
		source="config"
	else
		value="${DEFAULT_TOOL}"
		source="default"
	fi
fi

if ! is_accepted "${value}"; then
	echo "error: 受理しない review_tool: '${value}'（出所: ${source}）。受理するのは ${ACCEPTED}" >&2
	exit 2
fi

echo "value=${value}"
echo "source=${source}"
