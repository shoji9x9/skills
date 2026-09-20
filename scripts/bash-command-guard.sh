#!/usr/bin/env bash
# Bash 呼び出しの PreToolUse ゲート（このリポジトリのセッション用。配布物ではない）。
#
# 常時ロードの文章規約で防げず再発した 2 クラスを、決定論的に止める。
#
#   1. `gh api ... --body-file <path>`
#      `gh api` に `--body-file` は無く unknown flag で落ちる（`-F body=@<path>` か `--input <path>`）。
#      AGENTS.md に書いてあり、applied の学びもあるのに再発した。
#      `gh pr` / `gh issue` の `--body-file` は正当なので、**同じセグメントに `gh api` がある場合だけ**落とす。
#
#   2. パターンで撃つ `pkill -f` / `killall -f`
#      照合対象は full command line なので、そのコマンドを実行している自分のシェルにも一致し、
#      シェルごと落ちる（3 回踏んだ。症状は非 0 終了だけで、対象が死んだのか自分が死んだのか読めない）。
#      自分に一致しない形（`[d]ump-dom` のような文字クラス）と、PID 指定（`kill "$PID"`）は通す。
#
# 判定はセグメント単位で行う。`&&` / `||` / `;` / `|` / 改行で切り、セグメントごとに評価する
# （`gh pr create --body-file a && gh api x --body-file b` の後段だけを落とすため）。
#
# 終了コード: 0=通す / 2=ブロック（Claude Code / Codex は exit 2 だけがブロック）。
set -euo pipefail

input=""
if [ ! -t 0 ]; then
	IFS= read -r -d '' input || true
fi

# hot path: 危険語が生 JSON に現れない呼び出しはここで抜ける。
case "${input}" in
*--body-file*) ;;
*pkill*) ;;
*killall*) ;;
*) exit 0 ;;
esac

extract_command() {
	if command -v jq >/dev/null 2>&1; then
		printf '%s' "${input}" | jq -r '.tool_input.command // empty' 2>/dev/null && return 0
	fi
	if command -v node >/dev/null 2>&1; then
		printf '%s' "${input}" |
			node -e 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{try{process.stdout.write(JSON.parse(s)?.tool_input?.command??"");}catch{process.exit(3);}});' &&
			return 0
	fi
	return 3
}

command_text=""
if ! command_text="$(extract_command)"; then
	# 入力を読めないときは判定不能。fail-closed にすると全 Bash 呼び出しが止まるので通すが、
	# 「検査が動いていない」ことを黙らせない（0 件と未実行を同じ見え方にしない）。
	echo "bash-command-guard: 入力を解析できないため検査していない（jq / node が無いか JSON が不正）" >&2
	exit 0
fi

[ -n "${command_text}" ] || exit 0

violations=""
add_violation() { violations="${violations}${violations:+$'\n'}  - $1"; }

# セグメントへ分割する。区切りは改行と、&& || ; | の各演算子。
segments="$(printf '%s' "${command_text}" | sed -e 's/&&/\n/g' -e 's/||/\n/g' -e 's/|/\n/g' -e 's/;/\n/g')"

while IFS= read -r segment; do
	[ -n "${segment}" ] || continue

	# 1. gh api と --body-file が同じセグメントにある
	case "${segment}" in
	*"gh api"*)
		case "${segment}" in
		*--body-file*)
			add_violation "gh api に --body-file は無い（unknown flag で落ちる）。-F body=@<path> か --input <path> を使う: ${segment}"
			;;
		esac
		;;
	esac

	# 2. pkill / killall をパターン（-f）で撃っている
	case "${segment}" in
	*pkill* | *killall*)
		case "${segment}" in
		*-f*)
			# 文字クラス（[d]ump-dom）で自分のコマンドラインを避けている形は通す。
			case "${segment}" in
			*\[*\]*) ;;
			*)
				add_violation "pkill/killall -f の照合対象は full command line で、この呼び出し自身にも一致する（シェルごと落ちる）。PID 指定（kill \"\$PID\"）にするか、パターンを [d]ump-dom の形にする: ${segment}"
				;;
			esac
			;;
		esac
		;;
	esac
done <<<"${segments}"

if [ -n "${violations}" ]; then
	echo "bash-command-guard: 実行前に止めた（過去に再発した形）:" >&2
	echo "${violations}" >&2
	exit 2
fi
exit 0
