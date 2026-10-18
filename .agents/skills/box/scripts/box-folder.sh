#!/usr/bin/env bash
# 操作の対象のフォルダの ID を標準出力に出す（設定の root_folder_id。どの層にも無ければ Box のルートの 0）。
#
# 設定は shoji9x9/skills の共通の置き場所の box.jsonc（リポジトリ）と box.local.jsonc（このリポジトリの自分だけ）に置き、
# 同梱の skill-config/skill-config.mjs（Node.js）で読む。置き場所と解決の順序は references/config-files.md にある。
# box は curl と jq だけで動くので、設定ファイルが 1 つも無ければ Node.js を使わずに 0 を出す。
# 設定ファイルがあって Node.js が無ければ、0 で続けずに止める（書いた設定を警告なしに無視しないため）。
#
# 終了コード: 0=ID を出した / 1=設定の誤り・旧い環境変数・Node.js が無い（stderr に理由）。
set -euo pipefail

# 旧い置き場所の環境変数が残っていれば止める（空の値でも、置いたつもりの値を無視しないよう止める）
if [ "${BOX_ROOT_FOLDER_ID+set}" = "set" ]; then
	echo "box-folder: 環境変数 BOX_ROOT_FOLDER_ID は使わなくなった。値を .config/skills/shoji9x9/box.jsonc（全員が同じ共有フォルダを使う）か box.local.jsonc（このリポジトリの自分だけ）の root_folder_id に文字列で移し、環境変数を .env などから消す（references/config-files.md「移行」）" >&2
	exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
xdg="${XDG_CONFIG_HOME:-}"
case "${xdg}" in
/*) ;;
*)
	# HOME が無いか空なら、読み取り（Node の os.homedir()）と同じく、ユーザーのデータベースのホームを使う
	home_dir="${HOME:-}"
	[ -n "${home_dir}" ] || home_dir=$(
		unset HOME
		printf '%s' ~
	)
	# ユーザーのデータベースにエントリが無いと ~ が展開されずに残る。読み取りと同じく、絶対パスでなければ止める
	case "${home_dir}" in
	/*) ;;
	*)
		echo "box-folder: 人ごとの設定の置き場所を決められない（HOME: ${home_dir:-空}）。HOME か XDG_CONFIG_HOME を絶対パスで渡す" >&2
		exit 1
		;;
	esac
	xdg="${home_dir}/.config"
	;;
esac

# Node.js で読む必要があるファイル。人ごとの層の box.jsonc（置けない層）と、旧い skills.yml も含める。
# どちらも読み取りがエラーにするので、Node.js なしで 0 を出すと、その誤りを見逃す。
# 人ごとの層を読まない指定は、読み取りと同じく 1 だけを受け付け、1 なら人ごとのファイルを数えない
user_file="${xdg}/skills/shoji9x9/box.jsonc"
if [ "${SHOJI9X9_SKILLS_IGNORE_USER_CONFIG+set}" = "set" ]; then
	if [ "${SHOJI9X9_SKILLS_IGNORE_USER_CONFIG}" != "1" ]; then
		printf 'box-folder: 環境変数 SHOJI9X9_SKILLS_IGNORE_USER_CONFIG は 1 だけを受け付ける（%q）。人ごとの層を読むなら変数を消す\n' "${SHOJI9X9_SKILLS_IGNORE_USER_CONFIG}" >&2
		exit 1
	fi
	user_file=""
fi
needs_node=""
for f in "${root}/.config/skills/shoji9x9/box.jsonc" "${root}/.config/skills/shoji9x9/box.local.jsonc" "${user_file}" "${root}/.config/skills/shoji9x9/skills.yml"; do
	if [ -n "${f}" ] && [ -e "${f}" ]; then
		needs_node="${f}"
		break
	fi
done

if [ -z "${needs_node}" ]; then
	printf '0'
	exit 0
fi

if ! command -v node >/dev/null 2>&1; then
	echo "box-folder: 設定ファイル（${needs_node}）があるが、読むための Node.js が無い。Node.js を入れてから実行する（0 のフォルダでは続けない）" >&2
	exit 1
fi

folder="$(node "${script_dir}/skill-config/skill-config.mjs" get box root_folder_id --raw --root "${root}")"
printf '%s' "${folder}"
