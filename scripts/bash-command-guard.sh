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

# Hook payload の形はエージェントごとに違う。Claude Code は `tool_input.command`、Codex は
# `toolArgs`（オブジェクトのことも JSON 文字列のこともある）、Copilot は `input.command` /
# 素の `command`。`.tool_input.command` だけを読むと、他 2 エージェントでは command が空になり、
# **JSON は読めているので警告も出ないまま全件素通り**する（3 エージェントへ配線したのに
# 効くのは 1 つだけ、という形で実測した）。同居する kaizen-precommit-gate.sh と同じ集合を読む。
extract_command() {
	if command -v jq >/dev/null 2>&1; then
		# 各取り出しに `?` を付ける——`.toolArgs.command` は toolArgs が**文字列**のとき
		# 「Cannot index string with string」で filter ごと失敗し、jq 経路が丸ごと落ちる
		# （実測: jq 1.8.2 で rc=5）。node が居れば後段が拾うので症状が出ないが、
		# jq だけの環境では Codex の JSON 文字列形が検査されないまま通る。
		# 候補を順に並べ、文字列のものだけを残して先頭を採る（優先順位は並び順）。
		printf '%s' "${input}" | jq -r '
			[ .tool_input.command?, .toolArgs.command?,
			  (.toolArgs | fromjson? | .command?),
			  .command?, .input.command? ]
			| map(select(type == "string" and . != "")) | first // empty
		' 2>/dev/null && return 0
	fi
	if command -v node >/dev/null 2>&1; then
		printf '%s' "${input}" |
			node -e 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{let d;try{d=JSON.parse(s);}catch{process.exit(3);}const pick=(o)=>o&&typeof o==="object"&&typeof o.command==="string"?o.command:"";let c=pick(d?.tool_input)||pick(d?.toolArgs);if(!c&&typeof d?.toolArgs==="string"){try{c=pick(JSON.parse(d.toolArgs));}catch{c="";}}if(!c&&typeof d?.command==="string")c=d.command;if(!c)c=pick(d?.input);process.stdout.write(c);});' &&
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

# ここまで来た入力は hot path で危険語を含むと判定済みなので、command が取れないのは
# 「危険語が command 以外の場所にある」か「payload の形を読めていない」のどちらか。
# 後者を黙って通すと 0 件と未実行が同じ見え方になるので、理由を残して通す。
if [ -z "${command_text}" ]; then
	echo "bash-command-guard: 危険語を含む入力から command を取り出せなかったため検査していない（payload の形が未対応）" >&2
	exit 0
fi

violations=""

# セグメント先頭から「コマンド位置に立てる前置き」を剥ぐ。
# 剥いだ結果の先頭語が、そのセグメントで実行されるコマンド。
# 剥ぐのは:
#   - 空白（TAB を含む。区切りを ' ' 固定にすると TAB 区切りで剥ぎ残す）
#   - `(` `{` `!` と、コマンド置換の口 `$(` / `` ` ``（前に引用符が付く形も含む）
#   - 制御構文の語（do then else elif if while until）
#   - ラッパーコマンド（time env command exec builtin nohup sudo timeout xargs）とその数値引数
#   - env 代入（VAR=value）。**値が引用されていれば閉じ引用符まで飛ばす**——
#     「次の空白まで」で切ると、多語の代入値の途中がコマンド位置へ繰り上がって誤検知になり
#     （note="see gh api ..." を止めた）、逆に FOO="a b" gh api ... は剥ぎ足りずに素通りする。
strip_command_prefix() {
	local s="$1" prev="" rest=""
	while [ "${s}" != "${prev}" ]; do
		prev="${s}"
		s="${s#"${s%%[![:space:]]*}"}"
		# コマンド置換の口。引用符付き（out="$(...)"）も同じく中身が実行される。
		case "${s}" in
		\"\$\(* | \'\$\(* | \"\`* | \'\`*) s="${s#?}" ;;
		esac
		case "${s}" in
		\$\(*) s="${s#?}" ;;
		\`*) s="${s#?}" ;;
		esac
		case "${s}" in
		'('* | '{'* | '!'*) s="${s#?}" ;;
		do | do[[:space:]]* | then | then[[:space:]]* | else | else[[:space:]]* | elif | elif[[:space:]]* | if | if[[:space:]]* | while | while[[:space:]]* | until | until[[:space:]]*)
			s="${s#*[[:space:]]}"
			;;
		time | time[[:space:]]* | env | env[[:space:]]* | command | command[[:space:]]* | exec | exec[[:space:]]* | builtin | builtin[[:space:]]* | nohup | nohup[[:space:]]* | sudo | sudo[[:space:]]* | timeout | timeout[[:space:]]* | xargs | xargs[[:space:]]*)
			s="${s#*[[:space:]]}"
			;;
		# ラッパーの数値引数（timeout 30 gh api ...）。
		[0-9]*[[:space:]]*)
			s="${s#*[[:space:]]}"
			;;
		[A-Za-z_]*=*)
			case "${s%%=*}" in
			*[!A-Za-z0-9_]*) break ;;
			esac
			rest="${s#*=}"
			case "${rest}" in
			# 代入値がコマンド置換なら、その中身が実行されるので中を見る（out=$(gh api ...)）。
			# 引用符付き（out="$(...)"、推奨形）も同じ。**引用値の分岐より先に**置く——
			# 後ろに置くと「閉じ引用符まで飛ばす」に食われて中身が検査されない。
			\$\(* | \`*) s="${rest}" ;;
			\"\$\(* | \'\$\(* | \"\`* | \'\`*) s="${rest#?}" ;;
			# 引用された値は閉じ引用符まで飛ばす（値の中の語をコマンド位置に上げない）。
			\"*)
				rest="${rest#?}"
				rest="${rest#*\"}"
				s="${rest}"
				;;
			\'*)
				rest="${rest#?}"
				rest="${rest#*\'}"
				s="${rest}"
				;;
			# 通常の env 代入（GH_TOKEN=x gh api ...）は次の語へ進む。
			*) s="${s#*[[:space:]]}" ;;
			esac
			;;
		esac
	done
	printf '%s' "${s}"
}
# 免除の目印は **1 文字の文字クラス**（`[d]`）だけにする。
# 範囲クラス（`[0-9]`）や複数文字（`[cC]`）は、括弧の中の文字が自分のコマンドライン上に
# そのまま現れるため、パターンが**自分自身に一致する**（`chrome.*[0-9]+` は
# 引数リテラルの `0` に一致する。実測）。自爆を避けられない形を免除にはできない。
# 配列添字は ${...} を取り除いた時点で消えているので、ここで位置は問わない。
class_escape_re='\[[^][[:space:]]\]'
add_violation() { violations="${violations}${violations:+$'\n'}  - $1"; }

# セグメントへ分割する。区切りは改行と、&& || ; | の各演算子。
segments="$(printf '%s' "${command_text}" | sed -e 's/&&/\n/g' -e 's/||/\n/g' -e 's/|/\n/g' -e 's/;/\n/g')"

while IFS= read -r segment; do
	[ -n "${segment}" ] || continue

	# 1. gh api と --body-file が同じセグメントにある。
	#    `gh api` が**コマンド位置**にあるときだけ見る。引数の中にこのゲート自身の話題
	#    （`gh` の別サブコマンドに関する文章）が入っただけで正当な呼び出しを止めないため。
	#    「セグメントの先頭」に限ると狭すぎる——`for ...; do gh api ...; done` の `do` の後、
	#    `then` の後、`out=$(gh api ...)` のコマンド置換の中、`GH_TOKEN=x gh api ...` の
	#    env 代入の後はどれも先頭ではないが、実行されるのは同じ形（実測で 6 形が素通りした）。
	#    コマンド位置に立てる前置き（制御構文の語・env 代入・`(`・`$(`・`{`）を剥いでから見る。
	trimmed="$(strip_command_prefix "${segment}")"
	case "${trimmed}" in
	"gh api "* | "gh api")
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
			# 免除の判定は**パターン本体に文字クラスがあるか**で行う。
			# 位置（語頭かどうか）で決めると、`"node .*[d]ump-dom"` や `"^[c]hrome"`、
			# `"my-[s]erver"` のような正しい回避形まで落ちる（ブロック時の指示に
			# 従った形が通らない）。一方「どこかに [ ] があれば通す」だと、配列添字
			# `"${procs[0]}"` や行コメントの `[notes]` で素通りする。
			# そこで **${...} 展開と行コメントを取り除いてから**文字クラスの有無を見る。
			scan="$(printf '%s' "${segment}" | sed -e 's/\${[^}]*}//g' -e 's/[[:space:]]#.*$//')"
			if [[ ${scan} =~ ${class_escape_re} ]]; then
				:
			else
				add_violation "pkill/killall -f の照合対象は full command line で、この呼び出し自身にも一致する（シェルごと落ちる）。PID 指定（kill \"\$PID\"）にするか、パターンを [d]ump-dom の形にする: ${segment}"
			fi
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
