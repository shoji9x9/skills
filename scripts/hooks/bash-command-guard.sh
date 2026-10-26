#!/usr/bin/env bash
# Bash 呼び出しを PreToolUse で止めるチェック（このリポジトリのセッション用。配布物ではない）。
#
# 止めるのは、パターンで指定する `pkill -f` と `killall -f` だけである。
# 照合する対象はコマンドライン全体なので、そのコマンドを実行している自分のシェルにも一致し、シェルごと終了する
# （3 回起きた。症状は 0 以外の終了だけで、対象が終了したのか自分が終了したのかを出力から読めない）。
# PID の指定（`kill "$PID"`）と、パターンに英字 1 文字だけの文字クラスを含む形（`[d]ump-dom`）は通す。
# 範囲の文字クラス（`[0-9]`）は自分のコマンドラインにも一致するので、免除しない。
#
# この Hook に規則を足さない。シェルの引用を解釈して判定する規則は、書き方の数だけ誤検知と見逃しが出て、
# 維持の費用が効果に見合わない。判定は下の正規表現 1 本で行い、シェルの構文は解析しない。
# 語として現れる `pkill` と `killall`（直前が英数字・`_`・`-`・`.` でない。`/usr/bin/pkill` や引用の直後も含む）を、
# コマンドの位置かどうかを問わずに見る。そのため、引用の中の文章（commit message など）や heredoc の本文に書いた
# `pkill -f` でも止める。止められたら書き方を変える（ファイルに書いて渡す、語を分けるなど）。
# 変数で組み立てたコマンド名は見逃す。
#
# `.claude/settings.json` の handler に `if` を付けない。`if` は `bash -c "…"` と heredoc の中のコマンドに
# 一致しないので、`if` で絞ると改行の後に書いた形を取りこぼす。
#
# 終了コード: 0=通す / 2=ブロック（Claude Code / Codex は exit 2 だけがブロック）。
set -euo pipefail

input=""
if [ ! -t 0 ]; then
	IFS= read -r -d '' input || true
fi

# 危険語が JSON に現れない呼び出しは、command を取り出さずに通す。
case "${input}" in
*pkill*) ;;
*killall*) ;;
*) exit 0 ;;
esac

# Hook payload の形はエージェントごとに違う。Claude Code は `tool_input.command`、Codex は
# `toolArgs`（オブジェクトのことも JSON 文字列のこともある）、Copilot は `input.command` /
# 素の `command`。`.tool_input.command` だけを読むと、他の 2 つのエージェントでは command が空になり、
# 警告も出ないまま全件を通す。同居する kaizen-precommit-gate.sh と同じ集合を読む。
extract_command() {
	if command -v jq >/dev/null 2>&1; then
		# 各取り出しに `?` を付ける。`.toolArgs.command` は toolArgs が文字列のとき
		# 「Cannot index string with string」で filter ごと失敗する（jq 1.8.2 で rc=5）。
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
	# 入力を読めないときは判定できない。失敗として扱うと全 Bash 呼び出しが止まるので通すが、
	# 検査していないことは stderr に残す（0 件と未実行を同じ見え方にしない）。
	echo "bash-command-guard: 入力を解析できないため検査していない（jq / node が無いか JSON が不正）" >&2
	exit 0
fi

# 危険語を含む入力から command を取り出せないのは、危険語が command 以外の場所にあるか、
# payload の形を読めていないかのどちらかである。後者を警告なしに通さないよう、理由を残して通す。
if [ -z "${command_text}" ]; then
	echo "bash-command-guard: 危険語を含む入力から command を取り出せなかったため検査していない（payload の形が未対応）" >&2
	exit 0
fi

# 語として現れる pkill / killall から次の区切り（; & | 改行）までに、-f（束ねたオプションを含む）か --full があり、
# 印が無い形。印は、英字 1 文字だけの文字クラス（`[d]`）を置き換えた文字である。
# 数字のクラスは配列の添字（`${pats[0]}`）と区別できないので、免除しない。記号のクラス（`[_]`）も免除しない。
# 次の見逃しは受け入れる。正規表現を広げると、照合の時間と誤検知が増えるからである。
# - 区間のどこかに印があれば止めないので、パターンの外の `out[x].log` や `# [x]`、英字の添字（`${pats[i]}`）でも通す
# - 行継続（\ と改行）の後に書いた `-f` は、改行を区切りとして読むので見逃す（オプションの前後の空白に改行を含めない）
nl=$'\n'
mark=$'\001'
pkill_re="(^|[^[:alnum:]_.-])(pkill|killall)([[:blank:]][^;&|${nl}${mark}]*)?[[:blank:]](-[[:alnum:]]*f[[:alnum:]]*|--full)[^;&|${nl}${mark}]*(\$|[;&|${nl}])"

# 置き換えは対象の長さの 2 乗の時間がかかるので、一致した区間だけに当てる。
# 区間が免除されたら、その後ろの入力で次の区間を探す。
rest="${command_text}"
while [[ ${rest} =~ ${pkill_re} ]]; do
	segment="${BASH_REMATCH[0]}"
	if [[ ${segment//\[[[:alpha:]]\]/${mark}} =~ ${pkill_re} ]]; then
		echo "bash-command-guard: 実行前に止めた。pkill/killall -f の照合対象は full command line で、この呼び出し自身にも一致する（シェルごと終了する）。PID 指定（kill \"\$PID\"）にするか、パターンを [d]ump-dom の形にする: ${segment}" >&2
		exit 2
	fi
	rest="${rest#*"${segment}"}"
done
exit 0
