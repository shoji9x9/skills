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

# セグメントへの分割と「コードとして実行される部分」の抽出を、同じ引用状態の解釈で行う。
#
# 判定の土台を「前置きを剥いで先頭語を見る」から変えた理由——
# 前置き（制御構文・env 代入・ラッパー・コマンド置換）は列挙しても尽きず、
# 4 巡のレビューで毎回どちらかの方向へ穴が出た（正当な呼び出しを止める／実行される形を通す）。
# 実際に効くのは「その文字列がコードとして実行されるか、引用符の中のデータか」だけなので、
# そこだけを解釈する。
#
#   - 単引用符の中は**データ**（$( ) も展開されない）。丸ごと落とす
#   - 二重引用符の中もデータだが、`$( ... )` と `` ` ` `` の中は**コード**なので拾う
#   - 引用符の外はコード
#   - 区切り（; & | 改行）は**コード状態のときだけ**セグメント境界にする
#     （`git commit -m "fix; pkill ..."` のような引用内の ; で切らない）
#
# 各セグメントについて 2 行を出す: コード部分（#C#）と元の全文（#F#）。
# ルール 1・2 の**発動**はコード部分で見る。ルール 2 の**免除**（文字クラス）は
# パターン本体＝引用の中に書かれるので全文で見る。
split_segments() {
	awk '
	BEGIN { RS = "\0" }
	{
		n = length($0); code = ""; full = ""; state = 0; depth = 0
		for (i = 1; i <= n; i++) {
			c = substr($0, i, 1)
			nx = substr($0, i + 1, 1)
			if (state == 0) {                      # コード
				if (c == "\\") { full = full nx; code = code nx; i++; continue }
				if (c == "\047") { state = 1; full = full c; continue }
				if (c == "\"") { state = 2; full = full c; continue }
				if (c == "`") { state = 4; full = full c; continue }
				if (c == ";" || c == "&" || c == "|" || c == "\n") { emit(); continue }
				code = code c; full = full c; continue
			}
			if (state == 1) {                      # 単引用符の中（データ。展開されない）
				full = full c
				if (c == "\047") state = 0
				continue
			}
			if (state == 2) {                      # 二重引用符の中（データ。ただし $( ) と ` はコード）
				full = full c
				if (c == "\\") { full = full nx; i++; continue }
				if (c == "\"") { state = 0; continue }
				if (c == "$" && nx == "(") { state = 3; depth = 0; i++; code = code " "; continue }
				if (c == "`") { state = 5; code = code " "; continue }
				continue
			}
			if (state == 3) {                      # 二重引用符の中のコマンド置換
				full = full c
				if (c == "(") { depth++; code = code c; continue }
				if (c == ")") { if (depth == 0) { state = 2; code = code " "; continue } depth--; code = code c; continue }
				code = code c; continue
			}
			if (state == 4) {                      # コード中のバッククォート（中身もコード）
				full = full c
				if (c == "`") { state = 0; continue }
				code = code c; continue
			}
			if (state == 5) {                      # 二重引用符の中のバッククォート
				full = full c
				if (c == "`") { state = 2; code = code " "; continue }
				code = code c; continue
			}
		}
		emit()
	}
	function emit() {
		gsub(/\n/, " ", code); gsub(/\n/, " ", full)
		if (full ~ /[^[:space:]]/) { print "#C#" code; print "#F#" full }
		code = ""; full = ""
	}
	'
}
# 免除の目印は **1 文字の文字クラス**（`[d]`）だけにする。
# 範囲クラス（`[0-9]`）や複数文字（`[cC]`）は、括弧の中の文字が自分のコマンドライン上に
# そのまま現れるため、パターンが**自分自身に一致する**（`chrome.*[0-9]+` は
# 引数リテラルの `0` に一致する。実測）。自爆を避けられない形を免除にはできない。
# 配列添字は ${...} を取り除いた時点で消えているので、ここで位置は問わない。
class_escape_re='\[[^][[:space:]]\]'
add_violation() { violations="${violations}${violations:+$'\n'}  - $1"; }

# 分割は split_segments に委ねる（区切りの解釈と引用状態の解釈を 1 箇所にまとめる）。
segments="$(printf '%s\0' "${command_text}" | split_segments)"

seg_code=""
while IFS= read -r line; do
	case "${line}" in
	'#C#'*)
		seg_code="${line#\#C\#}"
		continue
		;;
	'#F#'*) segment="${line#\#F\#}" ;;
	*) continue ;;
	esac

	# 1. gh api と --body-file が同じセグメントにある。
	#    コード部分で見るので、引用符の中の文章（このゲート自身の話題を書いた --title 等）では
	#    発動せず、実行される形（制御構文の後・ラッパー越し・コマンド置換の中）は位置に依らず拾う。
	case "${seg_code}" in
	*"gh api"*)
		case "${seg_code}" in
		*--body-file*)
			add_violation "gh api に --body-file は無い（unknown flag で落ちる）。-F body=@<path> か --input <path> を使う: ${segment}"
			;;
		esac
		;;
	esac

	# 2. pkill / killall をパターン（-f）で撃っている。
	#    発動はコード部分で見る（コミットメッセージや echo で**話題にしているだけ**の
	#    呼び出しを止めないため。ルール 1 と同じ扱いに揃える）。
	case "${seg_code}" in
	*pkill* | *killall*)
		case "${seg_code}" in
		*-f*)
			# 免除（文字クラス）はパターン本体＝引用の中に書かれるので**全文**で見る。
			# 配列添字 ${...} と行コメントは取り除いてから見る（免除に数えない）。
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
