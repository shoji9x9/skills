#!/usr/bin/env bash
# git-worktree branch guard (PreToolUse hook)
#
# worktree の作成手段に branch を作らせる経路を捕捉し、**通知だけ**して素通しする。
# Issue に紐づかない worktree（過去の版を読む・使い捨ての検証）にも正当な用途があるため、
# ブロックはしない。
#
# 捕捉する経路:
#   - Claude Code の `EnterWorktree` で `path` を渡していない呼び出し（`name` 指定・引数なし）。
#     `path` は既存 worktree に入るだけなので対象外。
#   - `git worktree add` のうち branch を作る形（`-b` / `-B` / `--orphan`、
#     および commit-ish も `--detach` も無い形＝git が path の basename から branch を作る DWIM）。
#
# 出力は agent の payload 形式で切り替える:
#   - Claude Code / Codex（snake_case `tool_name`）: exit 0 ＋
#     `hookSpecificOutput.additionalContext`（ブロックせずコンテキストへ足す）
#     <https://code.claude.com/docs/en/hooks> / <https://learn.chatgpt.com/docs/hooks>
#   - GitHub Copilot（camelCase `toolName`）: exit 0 ＋ `permissionDecision: "ask"`。
#     Copilot の preToolUse 出力は permission 決定専用で additionalContext を持たない
#     （<https://docs.github.com/en/copilot/reference/hooks-reference>）ため、通知は
#     `permissionDecisionReason` に載せて `ask` で人へ回す。
#
# **常に exit 0 で終える。** Copilot の preToolUse は非 0 終了を fail-closed（deny）として扱うため、
# 解析に失敗した通知目的のフックが tool 呼び出しを落とすことがあってはならない。
set -uo pipefail

input=""
if [ ! -t 0 ]; then
	IFS= read -r -d '' input || true
fi

# 非 worktree 呼び出しは bash 組み込みの照合だけで落とす（jq / python3 を起動しない）。
case "${input}" in
*worktree* | *Worktree*) ;;
*) exit 0 ;;
esac

# --- payload の取り出し ---------------------------------------------------------
# tool 名とコマンド文字列を取る。Copilot 判定に使うので、どちらのキー名で取れたかを覚えておく。
tool_name=""
command_str=""
worktree_name=""
worktree_path=""
payload_style="snake" # snake（Claude Code / Codex） | camel（Copilot）

extract_with() { # $1: 実行するインタプリタ名
	case "$1" in
	jq)
		printf '%s' "${input}" | jq -r '
			def s(v): if (v | type) == "string" then v else "" end;
			def args: (.tool_input // .toolArgs // .input // {})
				| (if type == "string" then (try fromjson catch {}) else . end)
				| (if type == "object" then . else {} end);
			[ s(.tool_name // .toolName // ""),
			  s(args.command // ""),
			  s(args.name // ""),
			  s(args.path // ""),
			  (if (.toolName | type) == "string" and (.tool_name | type) != "string" then "camel" else "snake" end)
			] | map(gsub("[\r\n]"; " ")) | .[]
		' 2>/dev/null
		;;
	python3)
		printf '%s' "${input}" | python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
if not isinstance(data, dict):
    sys.exit(1)


def s(value):
    return value.replace("\r", " ").replace("\n", " ") if isinstance(value, str) else ""


args = {}
for key in ("tool_input", "toolArgs", "input"):
    value = data.get(key)
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            value = None
    if isinstance(value, dict):
        args = value
        break
style = "camel" if isinstance(data.get("toolName"), str) and not isinstance(data.get("tool_name"), str) else "snake"
for field in (s(data.get("tool_name") or data.get("toolName")), s(args.get("command")), s(args.get("name")), s(args.get("path")), style):
    sys.stdout.write(field + "\n")' 2>/dev/null
		;;
	esac
}

extracted=0
for interp in jq python3; do
	command -v "${interp}" >/dev/null 2>&1 || continue
	out=$(extract_with "${interp}") || out=""
	[ -n "${out}" ] || continue
	{
		IFS= read -r tool_name
		IFS= read -r command_str
		IFS= read -r worktree_name
		IFS= read -r worktree_path
		IFS= read -r payload_style
	} <<<"${out}" || true
	extracted=1
	break
done

# jq も python3 も無い環境では、構造として取り出せないので通知しない。
# ここで縮退照合に倒すと、コマンド文字列の中の `worktree` に反応して無関係な呼び出しへ
# 通知を出し続ける（通知の信頼を落とす方が、取りこぼしより高くつく）。
[ "${extracted}" -eq 1 ] || exit 0

# --- 検出 ---------------------------------------------------------------------

# シェルの 1 トークンから引用・エスケープを外す。展開が要るトークン（`$` / 逆クォート）は
# 値を当てられないので、そのまま返して「オプションではない語」として扱う。
unquote() { # $1: トークン
	local s="${1:-}" out="" c
	while [ -n "${s}" ]; do
		c=${s:0:1}
		case "${c}" in
		"\\")
			out+=${s:1:1}
			s=${s:2}
			;;
		"'")
			s=${s:1}
			# 閉じない `'` は残り全部を中身として食う。`${s%%\'*}` と `${s#*\'}` は
			# 一致が無いと**どちらも s 全体を返す**ため、そのままだと中身を 2 回積んで
			# `'abc` を `abcabc` と読む（実測）。無限ループにはならないが、
			# 別のトークン列として判定することになる。
			case "${s}" in
			*"'"*)
				out+=${s%%\'*}
				s=${s#*\'}
				;;
			*)
				out+=${s}
				s=""
				;;
			esac
			;;
		'"')
			s=${s:1}
			while [ -n "${s}" ]; do
				c=${s:0:1}
				case "${c}" in
				"\\")
					out+=${s:1:1}
					s=${s:2}
					;;
				'"')
					s=${s:1}
					break
					;;
				*)
					out+=${c}
					s=${s:1}
					;;
				esac
			done
			;;
		*)
			out+=${c}
			s=${s:1}
			;;
		esac
	done
	printf '%s' "${out}"
}

# コマンド文字列をトークン列（1 行 1 トークン）へ割る。引用の外の区切り
# （`;` `&` `|` `(` `)` 改行）は `\x1e`（セグメント境界）に変える。
tokenize() { # $1: コマンド文字列
	local s="${1:-}" i=0 c q="" tok="" sep=$'\x1e'
	local -a out=()
	flush() {
		[ -n "${tok}" ] && out+=("${tok}")
		tok=""
	}
	while [ "${i}" -lt "${#s}" ]; do
		c=${s:i:1}
		if [ -n "${q}" ]; then
			tok+=${c}
			if [ "${c}" = "\\" ] && [ "${q}" = '"' ]; then
				tok+=${s:i+1:1}
				i=$((i + 2))
				continue
			fi
			[ "${c}" = "${q}" ] && q=""
			i=$((i + 1))
			continue
		fi
		case "${c}" in
		"\\")
			tok+=${c}${s:i+1:1}
			i=$((i + 2))
			continue
			;;
		"'" | '"')
			q=${c}
			tok+=${c}
			;;
		' ' | $'\t') flush ;;
		';' | '&' | '|' | '(' | ')' | $'\n')
			flush
			# 配列要素の**非引用**展開だけはパス名展開の対象になるため引用する
			# （`\x1e` に glob メタ文字は無く現状は展開されないが、区切り文字を増やした
			# ときに静かに壊れる形を残さない）。`tok+=${c}` 等の代入 RHS は
			# パス名展開されないので対象外（実測）。
			out+=("${sep}")
			;;
		*) tok+=${c} ;;
		esac
		i=$((i + 1))
	done
	flush
	printf '%s\n' "${out[@]+"${out[@]}"}"
}

# `git worktree add` が branch を作る形かどうかを判定する。
# 0 = 作る（通知）、1 = 作らない／該当なし。
worktree_add_creates_branch() { # $1: コマンド文字列
	local -a tokens=()
	local raw t i n operands=0 detach=0 saw_dashdash=0 at_cmd_start=1
	mapfile -t tokens < <(tokenize "${1:-}")
	n=${#tokens[@]}
	i=0
	while [ "${i}" -lt "${n}" ]; do
		raw=${tokens[i]}
		i=$((i + 1))
		if [ "${raw}" = $'\x1e' ]; then
			at_cmd_start=1
			continue
		fi
		t=$(unquote "${raw}")
		# 環境変数代入と既知のラッパーは読み飛ばして、その後ろの git を見る（コマンド位置は保つ）。
		if [ "${at_cmd_start}" -eq 1 ]; then
			case "${t}" in
			[A-Za-z_]*=*) continue ;;
			sudo | env | command | nohup | nice | time | xargs) continue ;;
			esac
		fi
		# `git` 本体（`/usr/bin/git` のようなパス指定も含む）。
		# **コマンド位置にある `git` だけを見る。** 語の並びのどこにでも反応させると、
		# heredoc やコミットメッセージ本文に現れる「`git worktree add -b`」という
		# **文字列**にも通知が出る（実測: この hook を足した commit の message 自体で誤検知した）。
		# 誤検知は通知の信頼を落とすため、取りこぼしより高くつく。
		case "${t}" in
		git | */git) [ "${at_cmd_start}" -eq 1 ] || continue ;;
		*)
			at_cmd_start=0
			continue
			;;
		esac
		at_cmd_start=0
		# git のグローバルオプションを読み飛ばす。値を別引数で取るものだけ 1 語消費する。
		while [ "${i}" -lt "${n}" ]; do
			t=$(unquote "${tokens[i]}")
			case "${t}" in
			-C | -c | --git-dir | --work-tree | --namespace | --config-env | --exec-path | --attr-source)
				i=$((i + 2))
				;;
			-*)
				i=$((i + 1))
				;;
			*) break ;;
			esac
		done
		[ "${i}" -lt "${n}" ] || return 1
		[ "$(unquote "${tokens[i]}")" = "worktree" ] || continue
		i=$((i + 1))
		[ "${i}" -lt "${n}" ] || return 1
		[ "$(unquote "${tokens[i]}")" = "add" ] || continue
		i=$((i + 1))
		# `worktree add` の引数を読む。
		operands=0
		detach=0
		saw_dashdash=0
		while [ "${i}" -lt "${n}" ]; do
			raw=${tokens[i]}
			i=$((i + 1))
			if [ "${raw}" = $'\x1e' ]; then
				at_cmd_start=1 # 次のコマンドへ。この add はここで終わり
				break
			fi
			t=$(unquote "${raw}")
			if [ "${saw_dashdash}" -eq 0 ]; then
				case "${t}" in
				--)
					saw_dashdash=1
					continue
					;;
				-b | -B | --orphan | -b* | -B*)
					# branch を明示的に作る形。`-b<名前>` の連結も同じ。
					return 0
					;;
				# `worktree add` で値を別引数に取る長オプションは `--reason` だけ
				# （`--[no-]track` は真偽値。値を取ると誤読すると operand を数え違える）。
				--reason)
					i=$((i + 1))
					continue
					;;
				-d | --detach)
					detach=1
					continue
					;;
				--*) continue ;;
				-*)
					# 短オプションの束ね（`-df` / `-fb <名前>` 等）。`worktree add` の短オプションは
					# `-f` / `-b` / `-B` / `-d` / `-q` だけで、値を取る `-b` / `-B` は束ねの末尾に来るため、
					# 含まれる文字で判定できる。
					case "${t}" in
					*[bB]*) return 0 ;;
					*d*) detach=1 ;;
					esac
					continue
					;;
				esac
			fi
			operands=$((operands + 1))
		done
		# commit-ish 省略かつ `--detach` 無しは、git が path の basename から branch を作る
		# （git-worktree(1) の "as a convenience, the new worktree is associated with a new branch"）。
		if [ "${operands}" -le 1 ] && [ "${detach}" -eq 0 ]; then
			return 0
		fi
		# この add は branch を作らない。**ここで return しない** ——
		# 同じコマンド行に後続の `git worktree add` が続くことがあり
		# （`git worktree add ../a HEAD; git worktree add -b x ../b`）、
		# 打ち切ると後続の branch 作成を取りこぼす。
	done
	return 1
}

detected=""
case "${tool_name}" in
EnterWorktree)
	# `path` を渡した呼び出しは既存 worktree に入るだけ。それ以外（`name` 指定・引数なし）は
	# 新しい branch を作る。
	if [ -z "${worktree_path}" ]; then
		if [ -n "${worktree_name}" ]; then
			detected="EnterWorktree に name=\"${worktree_name}\" を渡しています"
		else
			detected="EnterWorktree を name も path も無しで呼んでいます（名前が自動生成されます）"
		fi
	fi
	;;
*)
	if [ -n "${command_str}" ] && worktree_add_creates_branch "${command_str}"; then
		detected="git worktree add が branch を作る形になっています"
	fi
	;;
esac

[ -n "${detected}" ] || exit 0

# --- 通知 ---------------------------------------------------------------------

read -r -d '' notice <<NOTICE || true
git-worktree: ${detected}。worktree の作成手段に branch を作らせると、branch 名がその機構の命名規則になり（EnterWorktree は \`worktree-<名前>\`、\`/\` は \`+\` に置換）、既定の base も \`origin/<デフォルト branch>\` に変わるため、Issue との紐付け（linked branches）が作られません。Issue に着手中なら、先に \`gh issue develop <番号> --name "<branch 名>" --base <ベース>\`（\`--checkout\` は付けない）で branch を作り、その**既存 branch** に worktree を張ってください（EnterWorktree なら \`path\`、CLI なら \`git worktree add <パス> <branch>\`）。Issue に紐づかない worktree（過去の版を読む・使い捨ての検証）ならこのまま進めて構いません。
NOTICE

json_escape() { # $1: 文字列
	local s="${1:-}"
	s=${s//\\/\\\\}
	s=${s//\"/\\\"}
	s=${s//$'\n'/\\n}
	s=${s//$'\r'/\\r}
	s=${s//$'\t'/\\t}
	printf '%s' "${s}"
}

escaped=$(json_escape "${notice}")
if [ "${payload_style}" = "camel" ]; then
	printf '{"permissionDecision":"ask","permissionDecisionReason":"%s"}\n' "${escaped}"
else
	printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' "${escaped}"
fi
exit 0
