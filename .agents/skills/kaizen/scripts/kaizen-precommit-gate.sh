#!/usr/bin/env bash
# kaizen pre-commit gate (PreToolUse hook)
#
# 非 commit は bash 組み込みの prefilter だけで即時終了する。commit のときは
# lifecycle 整合を検査し、未抽出センチネルがあれば transcript の未処理部分を走査する。
# 候補ゼロを検証できた場合だけ自動で checkpoint を進める。候補あり・形式不明・timeout は
# exit 2 + stderr でブロックし、従来の kaizen --current にフォールバックする。
#
# **止めるのは自分のセッションのセンチネルだけ**。他セッションのぶんは
# 「知らせるだけ」（exit 1）で、保持期間（既定 7 日、`.kaizen/config` で変更可）を過ぎたものは回収する。
# 終了コード: 0=通す / 1=通すが警告あり / 2=ブロック。
#
# 第 1 引数 $1: エージェントのサフィックス（例: -codex / -copilot）。省略時は空（Claude Code 用）。
# `kaizen-stop-mark.sh` と同じ規約。**「ブロックしない非 0」を表せるかがエージェントで違う**ため受け取る。
set -euo pipefail

# Copilot の preToolUse は、**timeout 以外の 0 以外の終了をすべて deny** する。
# 出典は https://docs.github.com/en/copilot/reference/hooks-reference の次の文である。
# `"a non-zero exit (other than exit 2) denies the tool call with \"Denied by preToolUse hook (hook errored)\""`。
# そのため、警告のための exit 1 がそのまま commit の拒否になり、しかも理由が "hook errored" になって
# 案内が届かない。Copilot では警告を exit 0 で返す（Claude Code / Codex は exit 2 だけがブロックなので、
# これまでどおり exit 1 を使う）。
gate_suffix="${1:-}"
if [[ -n "${gate_suffix}" && ! "${gate_suffix}" =~ ^-[a-z0-9-]+$ ]]; then
	gate_suffix=""
fi
warn_exit_code=1
if [ "${gate_suffix}" = "-copilot" ]; then
	warn_exit_code=0
fi

# チェックの締め切り（後述）は、bash の SECONDS で経過時間を測る。bash は環境変数 SECONDS を
# 起動時の初期値として引き継ぐので、フックの親の環境で export されていると、経過時間が最初から
# その値になり、毎回締め切りを過ぎてブロックする（実測）。ここで 0 に戻して起点を揃える。
SECONDS=0

input=""
if [ ! -t 0 ]; then
	# NUL は通常の Hook JSON に現れないため、read 1 回で EOF まで読み込む。cat / jq / python を
	# 起動する前に非 commit を落とすのが、このフックの hot path。
	IFS= read -r -d '' input || true
fi

# Claude Code は setup の handler `if` でも絞る。Codex / Copilot の matcher は tool 名まで
# なので、この広い prefilter が全 Bash 呼び出しの低コストな第一段になる。
#
# **行継続（`\` + 改行）はトークンを分けるので、語が揃っていることを通す条件にできない。**
# `gi\<改行>t commit` / `git com\<改行>mit` は、シェルが継続を取り除いてから解析するので実際に
# 実行される。しかし生の JSON には `git` も `commit` も現れず、ここで対象外になってチェックなしに通っていた（実測）。
# JSON では継続は `\\` ＋ `\n`（4 文字）として現れるので、その形を含む入力は語が揃って
# いなくても次の段に渡し、`strip_line_continuations` で正規化してから判定する。
# 継続を含む Bash の呼び出しは多くないので、hot path の性質は保たれる。
case "${input}" in
*git*commit*) ;;
*'\\\n'*) ;;
*) exit 0 ;;
esac

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)

kaizen_lib="${script_dir}/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
if [ -n "${script_dir}" ] && [ -r "${kaizen_lib}" ]; then
	. "${kaizen_lib}"
else
	printf '%s: 共通ライブラリを読めないため、機能を減らして動きます: %s\n' "$(basename "${BASH_SOURCE[0]}")" "${kaizen_lib}" >&2
fi
# 共通ライブラリを読めない（配布物の欠落・一部だけの展開）ときは、session 単位にする前の agent 単位の
# 名前だけを扱う版を定義して、機能を減らして動く。チェックの判定を止めないための代わりの実装で、複数のセッションの
# 分離は失われる（以前と同じく奪い合う）が、止める条件は緩めない。
if ! declare -f kaizen_sentinel_key_of >/dev/null 2>&1; then
	kaizen_hook_fields() { printf '\n\n\n'; }
	kaizen_session_key() { printf ''; }
	kaizen_resolve_project_root() { printf '%s' "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"; }
	kaizen_sentinel_path() { printf '.kaizen/.pending-extract%s' "${1:-}"; }
	kaizen_checkpoint_path() { printf '.kaizen/.extract-checkpoint'; }
	kaizen_done_path() { printf '.kaizen/.extract-done'; }
	kaizen_sentinel_key_of() { printf ''; }
	kaizen_sentinel_suffix_of() {
		local base=${1##*/}
		printf '%s' "${base#.pending-extract}"
	}
	# 機能を減らした版は自分のツリーだけを見る（すべての作業ツリーを探すようにする前の振る舞い）。worktree をまたいだセンチネルは
	# 見つからないが、止める条件は緩めない。
	kaizen_worktree_kaizen_dirs() { printf '%s\0' "$(pwd)/.kaizen"; }
	kaizen_find_control_file() {
		[ -n "${2:-}" ] && [ -e ".kaizen/$2" ] || return 1
		printf '%s' ".kaizen/$2"
	}
	# 設定を読む関数も共通ライブラリの側にある。読めないときは「定義なし」を返し、呼び出し側の
	# デフォルトの値を使う（`.kaizen/config` で調整した値は反映されなくなるが、デフォルトの値は止める側なので
	# 止める条件は緩まない）。
	kaizen_config_value() { return 1; }
fi

# Hook の入力から command と transcript_path を取り出す。jq が無い・正しく動かない環境では
# python3 を使い、それも無ければ生の JSON の command フィールドで判定する（機能を減らして動く）。
cmd=""
transcript=""
extracted=0
if command -v jq >/dev/null 2>&1; then
	cmd=$(printf '%s' "${input}" | jq -r '
		.tool_input.command // .toolArgs.command //
		(try (.toolArgs | fromjson | .command) catch empty) //
		.command // .input.command // empty
	' 2>/dev/null || true)
	transcript=$(printf '%s' "${input}" | jq -r '.transcript_path // .transcriptPath // .tool_input.transcript_path // .input.transcript_path // empty' 2>/dev/null || true)
	[ -n "${cmd}" ] && extracted=1
fi

if [ "${extracted}" -eq 0 ] && command -v python3 >/dev/null 2>&1; then
	cmd=$(printf '%s' "${input}" | python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
command = ""
for key in ("tool_input", "toolArgs", "input"):
    value = data.get(key)
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            value = None
    if isinstance(value, dict) and isinstance(value.get("command"), str):
        command = value["command"]
        break
if not command and isinstance(data.get("command"), str):
    command = data["command"]
sys.stdout.write(command)' 2>/dev/null || true)
	transcript=$(printf '%s' "${input}" | python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
transcript = data.get("transcript_path", data.get("transcriptPath", ""))
if isinstance(transcript, str):
    sys.stdout.write(transcript)' 2>/dev/null || true)
	[ -n "${cmd}" ] && extracted=1
fi

# session_id / cwd（と transcript の予備）はトップレベル限定の抽出で取る。生 JSON の最初の一致を
# 採ると、`tool_input.command` に `"session_id": "..."` を含むコマンドで値を乗っ取られ得る。
# transcript は上の抽出（tool_input 側のフォールバックを含む）が取れていればそちらを優先する。
session_id=""
hook_transcript=""
payload_cwd=""
{
	IFS= read -r session_id
	IFS= read -r hook_transcript
	IFS= read -r payload_cwd
} <<<"$(kaizen_hook_fields "${input}")" || true
session_key=$(kaizen_session_key "${session_id}")
[ -n "${transcript}" ] || transcript=${hook_transcript}

# `.kaizen/` の場所は、**コミットが実行される作業ツリー**を基準に決める。$CLAUDE_PROJECT_DIR を
# 最優先にすると、セッションの起点がリポジトリ本体で作業が git worktree のとき、チェックが見る
# `.kaizen/` と、抽出したセッションが書く `.kaizen/` が別のディレクトリになる。
project_root=$(kaizen_resolve_project_root "${payload_cwd}")
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

# コマンド文字列の**引用の内側**とコメントを、同じ長さの `_` に置き換えたコピーを返す。
# 区切り文字（`;` `&` `|` `(` ・改行）が引用の内側にあるとき、シェルはそこでコマンドを
# 区切らない。下の判定はシェルの構文を解析せずに正規表現で行うので、引用の状態を持たない。
# そのため、リテラルの `(` を区切りと読んで、読み取り専用のコマンドを誤ってブロックしていた
# （`echo "Bash(git ""commit *)"` のように、settings.json の matcher の表記を本文に含むだけの
# 呼び出しが止まる）。
#
# 引用符**そのもの**は残す。`gitoptval` が引用符をトークンの区切りとして使っており、
# 置き換えると、`git -C "a b" commit` のような真陽性を取りこぼし、チェックなしに通る。
# 長さを保つので、マスク後の一致位置と長さをそのまま元の文字列の位置として使える
# （`commit_target_is_external` には元の部分文字列を渡す必要がある）。
#
# **シェルの引用の規則が当てはまらない領域を、先に処理する。** そのまま通すと、その中の素の `'` が
# 引用の開始として数えられ、対をまたいだ範囲（本物の `git commit` を含む範囲）まで置き換えられる。
# その結果、チェックなしに通る（実測: `# don't` / `git commit -m x` / `# won't` の 3 行が exit 0）。
#   - コメント（語の先頭の `#` から行末まで）: シェルは中身を解釈しないので、行末まで全部置き換える。
#   - heredoc（`<<`）: 本文が始まる位置は区切りの語に依存し、この関数では追えない。判定できないので
#     **止める側として扱う**（呼び出し側に元の文字列を使わせる）。
#
# **逆に、引用の内側にも例外がある。** 「二重引用符の内側はすべてリテラル」は成り立たない。
# シェルは二重引用符の内側でも `$( )` と `` ` ` `` を展開する（[POSIX Shell Command Language:
# Double-Quotes](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html#tag_19_02_03)）。
# その中は引用されたリテラルではなく、**実行されるコマンド**である。置き換えると
# `echo "$(git commit -m wip)"` の `git commit` が検出されなくなり、**実際に実行されるコミットが
# チェックなしに通る**。そこで次のように扱う。
#   - 二重引用符の内側の `$( )` と `` ` ` ``: 中身を置き換えず、**そのままコピーする**（`$( )` は入れ子の
#     対応を数える）。コピーするので長さは変わらず、位置の対応もそのまま使える。
#   - 対応する `)` / `` ` `` を見つけられない場合: heredoc と同じく判定できないので、**止める側として扱う**。
# `$VAR` / `${...}` はコマンドではなく値の展開なので、これまでどおり置き換える。
#
# 引用が閉じていないコマンドも、同じく判定できないので止める側として扱う。ここで通すと、
# `git commit "` のような形で検出そのものを外せてしまう。
#
# 走査は 1 文字ずつではなく、「次の特殊文字までの塊」の単位で進める。コマンドは本文を書く形で
# 数十 KB になり、1 文字ずつ削ると、毎回残り全体をコピーして O(n^2) になる
# （実測: 50KB の入力で、チェック全体が 0.17 秒から 20.5 秒になった）。
# **行継続（`\` + 改行）は、シェルが解析の前に取り除く。** 残したまま走査すると、トークンが継続で分かれた形が
# どの正規表現にも一致せず、実行されるコミットがチェックなしに通る（実測で 3 つの形）。
# 分かれた形は `gi\<改行>t commit` / `git com\<改行>mit` / `ca\<改行>se x in x) ...` である。
# シェルと同じ位置で取り除いてから走査する。
#
# **`\\` + 改行は継続ではない**（エスケープされた `\` の直後の改行）。一括置換で落とすと、
# そこで区切られる次のコマンドが前のコマンドとつながり、区切りの判定から外れてチェックなしに通るので、
# エスケープ対を数えながら進める。
#
# これ以降の走査・一致位置はすべてこの正規化後の文字列を基準にする。`commit_target_is_external`
# へ渡す部分文字列も同じ文字列から切り出すので、位置の対応は保たれる（シェルが実際に解析する
# 形に近づくぶん、`-C <path>` 等の解析はむしろ正確になる）。
strip_line_continuations() { # $1: コマンド文字列
	local s="${1:-}" out="" chunk
	while [ -n "${s}" ]; do
		chunk=${s%%\\*}
		if [ "${chunk}" = "${s}" ]; then
			out+=${s}
			break
		fi
		out+=${chunk}
		s=${s:${#chunk}}
		case "${s:1:1}" in
		$'\n') s=${s:2} ;;
		*)
			out+=${s:0:2}
			s=${s:2}
			;;
		esac
	done
	printf '%s' "${out}"
}

# `$(` で始まる文字列を受け取り、**対応する `)` までの範囲**（両端を含む）を返す。
# 中身の引用（`'...'` / `"..."` / `\<文字>`）をまたいで数えるので、`$(echo ')')` のように
# 引用の内側に現れる `)` では閉じない。対応を取り切れない（閉じていない）場合は 0 以外を返し、
# 呼び出し側に、判定できないので止める側として扱わせる。
# 走査は mask_quoted と同じく「次の特殊文字までの塊」の単位で進める（1 文字ずつだと O(n^2) になる）。
#
# **`case` のパターンの `)` は、対応する `(` を持たない**（`case x in x) ... ;; esac`）。深さを
# 数える方式ではこれを区別できず、パターンの `)` で置換が閉じたと読んで、残り（実行される
# `git commit` を含む範囲）を置き換えてしまう。
# 実測では、`echo "$(case x in x)
# git commit -m x;; esac)"` はコミットを実行するのに、チェックが exit 0 になった。文法を区別できないので、
# heredoc と同じく、**判定できないとして止める側に扱う**（呼び出し側は元の文字列で判定する）。
# これは止めすぎにはなりにくい。止める側として扱っても、元の文字列を使わせるだけなので、
# 区切りの直後に `git commit` を持たない `case` 入りのコマンドは、これまでどおり通る。
# ほかに `)` が現れる文法（`$(( ))` / サブシェル `( )` / 関数定義 `f()` / プロセス置換 `<( )` /
# extglob `@( )`）は、どれも `(` と対になるので、深さの計算で扱える。
cmdsub_span() { # $1: `$(` で始まる文字列
	local s="${1:-}" rest="${1:2}" taken=2 depth=1 chunk body c closed line at_word_start=1
	# `(` `)` の対応と、対応を跨がせないための引用・エスケープ・コメント。
	local sub_pat="[\\\\'\"()#]*" dq_pat='[\\"]*'
	# 引用した右辺は `=~` でリテラルとして扱われるので、正規表現は変数に入れて、引用せずに渡す。
	# **`case` は「位置」ではなく「構文」で見る。** コマンドの位置は、記号の区切りの後、予約語の
	# 直後、関数の宣言の直後（`f() case x in ...`）のどれにも現れ、列挙は何度も抜けが見つかった
	# （実測で 4 回、10 の形）。対にならない `)` を持ち込むのは `case WORD in` という
	# 構文そのものなので、それを直接見る。予約語としての `case` の後に `in` が来る形である。
	# `printf %s case` のように引数として書かれただけなら `in` が続かないので、判定できない扱いにしない。
	# 引用の内側は別の分岐が処理するので、このチェックには渡らない（`printf %s 'case x in'` はそのまま通る）。
	local case_construct_re='(^|[^A-Za-z0-9_])case[[:space:]]+[^;&|()]*[[:space:]]+in([^A-Za-z0-9_]|$)'
	while [ -n "${rest}" ]; do
		# パターンとして展開させたいので意図的に非引用（SC2295）。
		# shellcheck disable=SC2295
		chunk=${rest%%$sub_pat}
		if [ -n "${chunk}" ]; then
			# **`case` は、予約語として現れたときだけ区別できない扱いにする。** 語として含むかどうかで
			# 判定すると、`printf %s case` のように**引数**として書かれた `case` でも判定できない扱いになり、
			# 呼び出し側が置き換えの結果を全部捨てる。その結果、同じコマンド行の引用された
			# `; git commit` が実行されるコマンドとして読まれ、誤ってブロックする（実測）。
			# 予約語はコマンドの位置（行頭・`;` `&` `|` `(` `{` ・改行の直後）にしか置けないので、
			# チャンクの先頭がコマンドの位置のときと、チャンクの中の区切りの直後だけを見る。
			if [[ ${chunk} =~ ${case_construct_re} ]]; then
				return 1
			fi
			taken=$((taken + ${#chunk}))
			rest=${rest:${#chunk}}
			# 次の `#` が語頭かどうかは直前の文字で決まる（mask_quoted と同じ判定）。
			case "${chunk: -1}" in
			[[:space:]] | ';' | '&' | '|' | '<' | '>') at_word_start=1 ;;
			*) at_word_start=0 ;;
			esac
			continue
		fi
		c=${rest:0:1}
		case "${c}" in
		'#')
			# 語頭の `#` は行末までコメント。**コメント内の `)` は対応にならない**ので、
			# ここを素通りさせると `$( # x` の次の `)` で早く閉じ、その後ろに置かれた
			# 本物の `git commit` がマスクの側で置き換えられ、**チェックなしに通る**（実測）。
			if [ "${at_word_start}" -eq 1 ]; then
				case "${rest}" in
				# 行末が無い＝対応する `)` はコメントの中にある。判定できないので止める側として扱う。
				*$'\n'*) line=${rest%%$'\n'*} ;;
				*) return 1 ;;
				esac
				taken=$((taken + ${#line}))
				rest=${rest:${#line}}
			else
				taken=$((taken + 1))
				rest=${rest:1}
			fi
			at_word_start=0
			;;
		"\\")
			[ "${#rest}" -ge 2 ] || return 1
			taken=$((taken + 2))
			rest=${rest:2}
			at_word_start=0
			;;
		"'")
			rest=${rest:1}
			case "${rest}" in
			*"'"*) ;;
			*) return 1 ;;
			esac
			body=${rest%%\'*}
			taken=$((taken + 2 + ${#body}))
			rest=${rest:$((${#body} + 1))}
			at_word_start=0
			;;
		'"')
			rest=${rest:1}
			taken=$((taken + 1))
			closed=0
			while [ -n "${rest}" ]; do
				# shellcheck disable=SC2295
				chunk=${rest%%$dq_pat}
				if [ -n "${chunk}" ]; then
					taken=$((taken + ${#chunk}))
					rest=${rest:${#chunk}}
					continue
				fi
				if [ "${rest:0:1}" = "\\" ]; then
					[ "${#rest}" -ge 2 ] || return 1
					taken=$((taken + 2))
					rest=${rest:2}
					continue
				fi
				taken=$((taken + 1))
				rest=${rest:1}
				closed=1
				break
			done
			[ "${closed}" -eq 1 ] || return 1
			at_word_start=0
			;;
		'(')
			depth=$((depth + 1))
			taken=$((taken + 1))
			rest=${rest:1}
			at_word_start=1
			at_word_start=1
			;;
		')')
			depth=$((depth - 1))
			taken=$((taken + 1))
			rest=${rest:1}
			at_word_start=0
			if [ "${depth}" -eq 0 ]; then
				printf '%s' "${s:0:${taken}}"
				return 0
			fi
			;;
		esac
	done
	return 1
}

mask_quoted() { # $1: コマンド文字列
	local s="${1:-}" out="" c chunk body pad closed bq_closed line span inner masked_inner at_word_start=1
	# 引用の外で意味を持つ文字。ここまでをまとめてコピーして、走査を進める。
	# 引用の内側では、リテラルではない領域（コマンド置換 `$( )` / `` ` ` ``）の開始も区切りに含める。
	local outer_pat="[\\\\'\"#]*" inner_pat='[\\"$`]*' bq_pat='[\\`]*'
	# heredoc の本文はシェルの引用規則の外にあり、この関数では範囲を確定できない。
	case "${s}" in
	*'<<'*) return 1 ;;
	esac
	while [ -n "${s}" ]; do
		c=${s:0:1}
		case "${c}" in
		"\\")
			# 引用の外のエスケープ。`\(` は区切りにならないので 2 文字とも潰す。
			[ "${#s}" -ge 2 ] || return 1
			out+='__'
			s=${s:2}
			at_word_start=0
			;;
		"'")
			# シングルクォート内にエスケープは無い（シェルの仕様）。次の `'` までが中身。
			s=${s:1}
			case "${s}" in
			*"'"*) ;;
			*) return 1 ;;
			esac
			body=${s%%\'*}
			printf -v pad '%*s' "${#body}" ''
			out+="'${pad// /_}'"
			s=${s#*\'}
			at_word_start=0
			;;
		'"')
			s=${s:1}
			out+='"'
			closed=0
			while [ -n "${s}" ]; do
				# パターンとして展開させたいので意図的に非引用（SC2295）。
				# shellcheck disable=SC2295
				chunk=${s%%$inner_pat}
				if [ -n "${chunk}" ]; then
					printf -v pad '%*s' "${#chunk}" ''
					out+=${pad// /_}
					s=${s:${#chunk}}
					continue
				fi
				c=${s:0:1}
				case "${c}" in
				"\\")
					# `\"` は閉じ引用符ではない。2 文字とも潰して引用の内側を続ける。
					[ "${#s}" -ge 2 ] || return 1
					out+='__'
					s=${s:2}
					;;
				'$')
					# `$(` はコマンド置換で、実行される領域なので、置き換えずにコピーする。それ以外の `$`
					# （`$VAR` / `${...}`）は値の展開でコマンドではないので、これまでどおり置き換える。
					#
					# **そのままコピーはしない。** 置換の中身は「実行されるコマンド」だが、その中にも
					# 引用とコメントがあり、そこに書かれた区切り文字は実行されない。そのままコピーすると、
					# `echo "$(printf %s '; git commit -m x')"` のように**実行されないリテラル**の
					# `;` を本物の区切りと読んで、誤ってブロックする（実測）。中身に同じ規則を
					# 再帰で当て、実行される部分は残しつつ、引用とコメントだけを置き換える。
					# mask_quoted は長さを保つので、`$(` と `)` を足した全体の長さも変わらない。
					if [ "${s:1:1}" = '(' ]; then
						span=$(cmdsub_span "${s}") || return 1
						inner=${span:2:$((${#span} - 3))}
						# `$( )` は出力末尾の改行を落とすので番兵を付けて剥がす。
						masked_inner=$(mask_quoted "${inner}" && printf 'x') || return 1
						out+="\$(${masked_inner%x})"
						s=${s:${#span}}
					else
						out+='_'
						s=${s:1}
					fi
					;;
				'`')
					# 以前の形式のコマンド置換。次の `` ` `` までが中身で、`` \` `` では閉じない。
					# 中身は実行されるので、置き換えずにコピーする。閉じが無ければ、判定できないので止める側として扱う。
					# 閉じたかどうかは専用の変数で持つ。外側の二重引用符が使う `closed` を共有すると、
					# `"` で閉じていないのに閉じたとして扱われ、チェックなしに通る。
					# `$( )` と同じく、中身は実行されるが、内側の引用とコメントは実行されない。
					# 本文をいったん集めてから、同じ規則を再帰で当てる（そのままコピーしない）。
					s=${s:1}
					body=''
					bq_closed=0
					while [ -n "${s}" ]; do
						# shellcheck disable=SC2295
						chunk=${s%%$bq_pat}
						if [ -n "${chunk}" ]; then
							body+=${chunk}
							s=${s:${#chunk}}
							continue
						fi
						if [ "${s:0:1}" = "\\" ]; then
							[ "${#s}" -ge 2 ] || return 1
							body+=${s:0:2}
							s=${s:2}
							continue
						fi
						s=${s:1}
						bq_closed=1
						break
					done
					[ "${bq_closed}" -eq 1 ] || return 1
					masked_inner=$(mask_quoted "${body}" && printf 'x') || return 1
					out+="\`${masked_inner%x}\`"
					;;
				*)
					out+='"'
					s=${s:1}
					closed=1
					break
					;;
				esac
			done
			[ "${closed}" -eq 1 ] || return 1
			at_word_start=0
			;;
		'#')
			# 語頭の `#` は行末までコメント。中身は実行されず引用規則も当たらないので丸ごと潰す。
			# 語中の `#`（`a#b`）はただの文字。
			if [ "${at_word_start}" -eq 1 ]; then
				case "${s}" in
				*$'\n'*) line=${s%%$'\n'*} ;;
				*) line=${s} ;;
				esac
				printf -v pad '%*s' "${#line}" ''
				out+=${pad// /_}
				s=${s:${#line}}
			else
				out+='#'
				s=${s:1}
			fi
			at_word_start=0
			;;
		*)
			# パターンとして展開させたいので意図的に非引用（SC2295）。
			# shellcheck disable=SC2295
			chunk=${s%%$outer_pat}
			out+=${chunk}
			s=${s:${#chunk}}
			# 次の `#` が語頭かどうかは直前の文字で決まる。
			case "${chunk: -1}" in
			[[:space:]] | ';' | '&' | '|' | '(' | ')' | '<' | '>') at_word_start=1 ;;
			*) at_word_start=0 ;;
			esac
			;;
		esac
	done
	printf '%s' "${out}"
}

# 区切り文字（行頭・`;` `&` `|` `(` ・改行）の直後だけでなく、環境変数代入と既知の
# ラッパー（sudo / env / nice 等とその引数）を挟んだ `git commit` も捕捉する。
# 区切りを単なる空白まで広げると `echo "... git commit ..."` や `man git commit` まで
# ブロックしてしまうため、先頭に置ける語を列挙する方式にしている。
wrappers='(sudo|env|command|nohup|nice|time|xargs)'
assign='[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*'
prefix="(${assign}[[:space:]]+)*(${wrappers}[[:space:]]+([^[:space:]]+[[:space:]]+)*)*"
# `git` と `commit` の間に入る git のグローバルオプション（`git -C <path> commit`,
# `git --no-pager commit`, `git -c k=v commit` など）も検出する。オプションの語とその引数を
# 許す形にとどめ、`git help commit` のようなオプションでない語では止まるようにする（止めすぎを避ける）。
# 引数を読み進めるのは、**値を別の引数として取るオプションだけ**に限る。どのオプションでも直後の 1 語を
# 読み進められるようにすると、引数を取らないオプション（`--no-pager` など）の後ろのサブコマンドまで読み進める。
# その次の語が `commit` に一致して、読み取り専用のコマンドを誤ってブロックする
# （`git --no-pager grep commit` / `git --no-pager log commit` など。どれも実測）。
# 引数は空白を含みうる（`git -C "/tmp/a b" commit`、`git -C /tmp\ a commit`）。空白でない文字の連続だけを
# 引数とみなすとこれらを取りこぼし、チェックなしに通る（どれも実測）。
# 引用とエスケープは、種類ごとに足していくと別の種類が残る（`"..."` を足すと `\"` で早く閉じ、
# それを直すと `\ ` が残った）。そこで、**シェルの 1 トークン**としてまとめて表す。
#   エスケープ `\<任意>` / 一重引用符の塊 / 二重引用符の塊（中のエスケープを含む） / 素の文字
# を 1 回以上つなげたものである。これで `/tmp/"a b"/c\ d` のような混在も、1 つの引数として続く。
# 生の JSON で判定するとき（機能を減らして動くとき）は、引用符が `\"`、エスケープが `\\<文字>` として現れるので、その形も要素に加える。
# 一重引用符の中にエスケープは無い（シェルの仕様）ので、そちらは単純な形でよい。
sq=\'
dqbody='([^"\\]|\\.)*'
gitoptval='((\\"'"${dqbody}"'\\"|"'"${dqbody}"'"|'"${sq}[^${sq}]*${sq}"'|\\\\.|\\.|[^[:space:]"'"${sq}"'\\])+)'
# 値を別引数として取る git のグローバルオプション。git(1) の SYNOPSIS ではなく
# **次の引数を実際に消費するか**を実測して選ぶ（`git <opt> <値> version` が version を実行するか）。
# `--exec-path` は SYNOPSIS に `--exec-path[=<path>]` と載るが、値なしで呼ぶと exec-path を出力して
# 即 exit するだけで次の引数を消費しない。ここへ入れると `git --exec-path log commit` の `log` を
# 引数として飲み、次の `commit` にマッチして読み取り専用コマンドを誤ブロックする（実測）。
# `--git-dir=<path>` のような `=` 連結形も、値が引用・エスケープされていれば空白を含み得る
# （`--git-dir="/tmp/a b/.git"`）。`-[^[:space:]]+` だけで拾うと引用の途中で切れ、続く語が
# オプションでないためオプション列がそこで終わり、`commit` に到達せず、**チェックなしに通る**（実測）。
# 値側は空白区切りのオプションと同じ `${gitoptval}` で 1 トークンとして取る。
gitoptval_opt='(-C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--attr-source)'
gitopts="((${gitoptval_opt}[[:space:]]+${gitoptval}|-[^[:space:]=]+=${gitoptval}|-[^[:space:]]+)[[:space:]]+)*"
# 区切りには `` ` `` も含める。旧形式のコマンド置換の直後はコマンドの先頭であり、
# `` echo "`git commit -m wip`" `` は実際にコミットを実行する。
# 誤ブロックにはならない——リテラルとして書かれた `` ` `` はシングルクォートの内側か
# heredoc の中にしか現れず、前者は mask_quoted が潰し、後者は判定できないので止める側として扱われる。
#
# `)` と `{` も、**コマンドの先頭が来る位置**なので区切りに含める。
#   - `case x in x) git commit -m x;; esac` —— case のパターンの `)` の直後
#   - `f() { git commit -m x; }; f` / `{ git commit -m x; }` —— 複合コマンドの `{` の直後
# どちらも実際にコミットを実行するのに、`;&|(` だけの区切りでは見つけられず、チェックなしに通っていた
# （実測）。`case` は mask_quoted の側で止める側として扱うが、その後に元の文字列を判定するのは
# この正規表現なので、区切りを広げないと、やはりチェックなしに通る（片方だけでは防げない）。
# 生の JSON で判定するときは、行継続を取り除いた**コピー**も同じ式で判定する（`extracted` が 1 のときは空のまま）。
cmd_continuation_stripped=""
if [ "${extracted}" -eq 1 ]; then
	commit_re=$'(^|[;&|(){`\n])[[:space:]]*'"${prefix}"'git[[:space:]]+'"${gitopts}"'commit([[:space:]]|$)'
else
	cmd=${input}
	# **機能を減らして動くときも、行継続で分かれたトークンを見つける。** `gi\<改行>t commit` はシェルが
	# 継続を取り除いてから実行するのに、生の JSON には `git` と `commit` が揃って現れず、チェックなしに通っていた（実測）。
	# このときはコマンド行を構造として取り出せていないので、`strip_line_continuations` を当てられない。
	# JSON では継続が `\\` ＋ `\n`（4 文字）として現れるので、その並びを取り除いたコピーを作り、
	# **元とコピーのどちらかが一致すればブロックする**。
	# コピーだけを見ないのは、継続でない `\\` ＋ 改行（エスケープされた `\` の直後の改行）まで詰めると、
	# そこで区切られる次のコマンドが前のコマンドとつながり、区切りの判定から外れて、チェックなしに通るからである。
	# 両方を見れば、詰めて一致する形も、詰めずに一致する形も、どちらも見逃さない。
	json_continuation='\\\n'
	cmd_continuation_stripped=${cmd//"${json_continuation}"/}
	[ "${cmd_continuation_stripped}" = "${cmd}" ] && cmd_continuation_stripped=""
	# 生の JSON で判定するときも、区切りの後ろの `git commit` を検出する。command の値の先頭だけにアンカーを置くと、
	# `cd /tmp && git commit -m x` のような複合コマンドを取りこぼし、チェックなしに通る（実測）。
	# 区切りまでの前置きは `dqbody`（`([^"\\]|\\.)*`）で表す。これはエスケープされていない `"` を
	# またがないので、走査は command の値の中にとどまる（値の外の別のフィールドを拾わない）。
	# JSON では改行が `\n` の 2 文字として現れるので、リテラルの区切り ``;&|(` `` に加えて、その形も区切りに含める。
	raw_sep='([;&|(){`]|\\[nr])'
	commit_re='"command"[[:space:]]*:[[:space:]]*"('"${dqbody}${raw_sep}"')?[[:space:]]*'"${prefix}"'git[[:space:]]+'"${gitopts}"'commit([[:space:]]|"|$)'
fi
# 引用の内側の区切り文字で誤って検出しないように、判定は置き換えたコピーに対して行う。
# 生の JSON で判定するとき（jq / python3 が無い）は、コマンド行を構造として取り出せておらず、
# 引用符が JSON のものと混在するので、シェルの引用の規則を当てられない。置き換えずにこれまでどおり扱う
# （このときは元から止める側に扱い、範囲の判定も行わない）。
if [ "${extracted}" -eq 1 ]; then
	# 走査の前に行継続を取り除く（シェルと同じ前処理）。`$( )` は末尾の改行を落とすので
	# 番兵 `x` を付けて剥がす。失敗したら元の文字列のまま判定する（これまでどおり止める側）。
	if stripped_raw=$(strip_line_continuations "${cmd}" && printf 'x'); then
		cmd=${stripped_raw%x}
	fi
fi
cmd_masked=${cmd}
if [ "${extracted}" -eq 1 ]; then
	# `$( )` は出力末尾の改行を落とす。下の走査はマスク側で取った一致位置と長さを**元の文字列**の
	# 位置として使うため、長さがずれない形で受け取る（番兵 `x` を付けて剥がす）。
	# mask_quoted が判定不能（非 0）を返したときは、元の文字列のまま判定する（これまでどおり止める側）。
	if masked_raw=$(mask_quoted "${cmd}" && printf 'x'); then
		cmd_masked=${masked_raw%x}
	fi
fi
if [[ ! "${cmd_masked}" =~ ${commit_re} ]]; then
	# コピーが空なら、継続を含まない（または構造として取り出せた）。そのときだけ通す。
	if [ -z "${cmd_continuation_stripped}" ] || [[ ! "${cmd_continuation_stripped}" =~ ${commit_re} ]]; then
		exit 0
	fi
fi

# コマンド行から**コミット先がプロジェクトの外のリポジトリだと分かる**呼び出しは、チェックの対象に
# しない。テストのフィクスチャとして、使い捨ての一時リポジトリにコミットする形
# （`git -C <dir> commit` / `--git-dir=<dir>`）まで止めると、抽出を求めている
# 「このプロジェクトの活動」と関係のない commit が実行できなくなる。
# 判定できない形（`cd <dir> && git commit`・パスの指定なし・`--work-tree` だけ・`cd` と相対パスの
# 併用・変数の展開を含むパス）は、これまでどおりブロックする。
# 生の JSON で判定するとき（jq / python3 が無い）は、コマンド行を構造として取り出せていないので、この判定をせず、これまでどおりブロックする。

# シェルの 1 トークンから引用・エスケープを外す。値が実行時にしか決まらないトークン
# （変数展開・コマンド置換・チルダ・glob）は失敗を返す——展開後のパスを当てられないまま
# 「外部宛て」と判定すると、プロジェクト宛ての commit をチェックなしに通しうる。
unquote_token() { # $1: トークン
	local s="${1:-}" out="" c closed
	while [ -n "${s}" ]; do
		c=${s:0:1}
		case "${c}" in
		"\\")
			# 末尾の単独の `\` は、エスケープが終わっていない。警告なしに捨てると、git が使うのとは
			# 別のパスで判定したまま成功として扱われるので、判定できないとして止める側に扱う。
			[ "${#s}" -ge 2 ] || return 1
			out+=${s:1:1}
			s=${s:2}
			;;
		"'")
			s=${s:1}
			case "${s}" in
			*"'"*) ;;
			*) return 1 ;;
			esac
			out+=${s%%\'*}
			s=${s#*\'}
			;;
		'"')
			s=${s:1}
			closed=0
			while [ -n "${s}" ]; do
				c=${s:0:1}
				case "${c}" in
				"\\")
					# ダブルクォート内で `\` が特別扱いされるのは `$` `` ` `` `"` `\` の前だけ（シェルの仕様）。
					# それ以外は `\` 自体もリテラルとして残る。無条件に落とすと `"/tmp/a\b"` を
					# `/tmp/ab` と読み違え、git が使うのとは別のパスでスコープを判定する。
					case "${s:1:1}" in
					'$' | '`' | '"' | "\\") out+=${s:1:1} ;;
					*) out+=${c}${s:1:1} ;;
					esac
					s=${s:2}
					;;
				'"')
					s=${s:1}
					closed=1
					break
					;;
				*)
					out+=${c}
					s=${s:1}
					;;
				esac
			done
			[ "${closed}" -eq 1 ] || return 1
			;;
		*)
			out+=${c}
			s=${s:1}
			;;
		esac
	done
	case "${out}" in
	'' | *'$'* | *'`'* | '~'* | *'*'* | *'?'* | *'['*) return 1 ;;
	esac
	printf '%s' "${out}"
}

# パスを絶対パスにし、`.` / `..` を文字列の上で畳んだうえで、**存在するいちばん深い祖先だけ**を realpath する。
# フィクスチャは `git init <dir> && git -C <dir> commit ...` のように 1 行で作られ、フックが
# 実行される時点では、対象のディレクトリはまだ存在しない。存在を前提にすると、直そうとしているケースが
# そのまま判定できない（ブロックする）側になる。
canonical_path() { # $1: パス $2: 相対パスの基準ディレクトリ
	local path="${1:-}" base="${2:-}" abs part norm="" rest="" head resolved
	[ -n "${path}" ] || return 1
	case "${path}" in
	/*) abs=${path} ;;
	*)
		[ -n "${base}" ] || return 1
		abs="${base%/}/${path}"
		;;
	esac
	# 分割は `read -a` で行う。`for part in ${abs}`（引用しない展開）は**パス名展開も受ける**ので、
	# `[` を含むディレクトリ名が cwd の実際のファイルに一致すると、別のパスになってしまう
	# （実測: cwd に `ab` があると、`/tmp/a[b]/c` の `a[b]` が `ab` になる）。
	# `read` は分割だけを行い、glob は起きない。
	local -a parts=()
	IFS=/ read -r -a parts <<<"${abs}"
	for part in "${parts[@]}"; do
		case "${part}" in
		'' | .) ;;
		..) norm=${norm%/*} ;;
		*) norm="${norm}/${part}" ;;
		esac
	done
	head=${norm:-/}
	while :; do
		if resolved=$(cd "${head}" 2>/dev/null && pwd -P); then
			break
		fi
		[ "${head}" != "/" ] || return 1
		rest="${head##*/}${rest:+/}${rest}"
		head=${head%/*}
		[ -n "${head}" ] || head=/
	done
	printf '%s' "${resolved%/}${rest:+/}${rest}"
}

# $1 のリポジトリの共有 git ディレクトリ。worktree は本体と同じ値になるので「同じリポジトリか」に使える。
# $1 は作業ツリーのディレクトリでも gitdir でもよい。linked worktree の `<worktree>/.git` は
# **ファイル**（`gitdir: <path>`）なので `-d` に掛からない。ここで諦めると同一リポジトリ判定が
# 抜け、`git --git-dir=<worktree>/.git commit`（実測でその repo へコミットされる）を外部宛てと
# 誤って判定し、チェックなしに通す。
git_common_dir_of() { # $1: ディレクトリ、または gitdir（ディレクトリ / ファイル）
	local dir="${1:-}" base common
	[ -n "${dir}" ] || return 1
	if [ -d "${dir}" ]; then
		base=${dir}
		common=$(git -C "${dir}" rev-parse --git-common-dir 2>/dev/null) || return 1
	elif [ -f "${dir}" ]; then
		base=${dir%/*}
		[ -n "${base}" ] || base=/
		common=$(git --git-dir="${dir}" rev-parse --git-common-dir 2>/dev/null) || return 1
	else
		return 1
	fi
	[ -n "${common}" ] || return 1
	# `--git-common-dir` は相対パスを返すことがあるため、基準ディレクトリから解決する。
	(cd "${base}" 2>/dev/null && cd "${common}" 2>/dev/null && pwd -P) || return 1
}

path_is_within() { # $1: 正準パス $2: 正準の親
	[ -n "${2:-}" ] || return 1
	case "${1}" in
	"${2}" | "${2%/}"/*) return 0 ;;
	esac
	return 1
}

# commit_re がマッチした部分文字列から、コミット先がプロジェクト外だと確定できるかを返す
# （0 = 外部宛て、1 = プロジェクト宛て or 判定不能）。
commit_target_is_external() { # $1: マッチした部分文字列
	local seg="${1}" opt val tok cdir="" gitdir="" worktree="" abs base t tcommon rel_used=0
	local -a targets=()
	# `git` の直後から `commit` の直前までがグローバルオプション列。
	seg=${seg%commit*}
	# 先頭は、commit_re が読んだ区切りで始まりうる。空白だけを `git` の直前に許すと、
	# `;git -C <外部> commit` のような区切りの直後の呼び出しを解析できず、外部宛てでも
	# 判定できない（ブロックする）側になる（外部のリポジトリ宛てを対象外にする意図に反する）。
	# **区切りの集合は、commit_re と同じものを持たせる。** 片方だけ広げると、広げた側で
	# 一致した形をこちらが解析できない。その結果、外部宛ての免除が機能しないまま誤ってブロックする
	# （実測: 以前の形式のコマンド置換の直後に外部宛ての呼び出しを置いた形で、exit 2 になった）。
	local git_head_re='(^|[[:space:]]|[;&|(){`])git[[:space:]]+(.*)$'
	[[ ${seg} =~ ${git_head_re} ]] || return 1
	seg=${BASH_REMATCH[2]}
	while [ -n "${seg}" ]; do
		seg=${seg#"${seg%%[![:space:]]*}"}
		[ -n "${seg}" ] || break
		opt=""
		val=""
		if [[ ${seg} =~ ^${gitoptval_opt}[[:space:]]+${gitoptval} ]]; then
			opt=${BASH_REMATCH[1]}
			val=${BASH_REMATCH[2]}
			seg=${seg:${#BASH_REMATCH[0]}}
		elif [[ ${seg} =~ ^(-[^[:space:]=]+)=${gitoptval} ]]; then
			# `=` 連結形。値は引用・エスケープを含み得るので gitopts と同じトークンとして取る。
			tok=${BASH_REMATCH[1]}
			val=${BASH_REMATCH[2]}
			seg=${seg:${#BASH_REMATCH[0]}}
			case "${tok}" in
			--git-dir | --work-tree) opt=${tok} ;;
			esac
		elif [[ ${seg} =~ ^(-[^[:space:]]+) ]]; then
			seg=${seg:${#BASH_REMATCH[0]}}
		else
			break
		fi
		case "${opt}" in
		-C | --git-dir | --work-tree) ;;
		*) continue ;;
		esac
		val=$(unquote_token "${val}") || return 1
		case "${opt}" in
		-C)
			# `-C` は繰り返すと累積して相対解決される（`git -C /a -C b` は /a/b）。
			# 先頭が相対のときだけ base_dir（＝推定した cwd）に依存する。
			case "${val}" in
			/*) ;;
			*) [ -n "${cdir}" ] || rel_used=1 ;;
			esac
			cdir=$(canonical_path "${val}" "${cdir:-${base_dir}}") || return 1
			;;
		--git-dir) gitdir=${val} ;;
		--work-tree) worktree=${val} ;;
		esac
	done
	for val in "${gitdir}" "${worktree}"; do
		case "${val}" in
		'' | /*) ;;
		*) [ -n "${cdir}" ] || rel_used=1 ;;
		esac
	done
	# コマンド行に `cd` が含まれると、`git` が実際に実行される cwd は Hook の payload の cwd と
	# 一致しない。相対パスを解決する基準が変わり、プロジェクト宛てを外部宛てと読み違えうるので、
	# 判定できないとして扱う（`cd <dir> && git commit` を判定できないとするのと同じ理由）。
	if [ "${rel_used}" -eq 1 ] && [ "${cmd_cwd_uncertain}" -eq 1 ]; then
		return 1
	fi
	base=${cdir:-${base_dir}}
	if [ -n "${gitdir}" ]; then
		abs=$(canonical_path "${gitdir}" "${base}") || return 1
		targets+=("${abs}")
	fi
	if [ -n "${worktree}" ]; then
		abs=$(canonical_path "${worktree}" "${base}") || return 1
		targets+=("${abs}")
	fi
	if [ -n "${cdir}" ]; then
		targets+=("${cdir}")
	fi
	# コミット先の**リポジトリ**を決めるのは、`--git-dir` と、探索の起点を変える `-C` だけである。
	# `--work-tree` は作業ツリーを差し替えるだけで、リポジトリは cwd からの探索で決まる。
	# `git --work-tree=<外部> commit` は、プロジェクトのリポジトリにコミットされる（実測）。
	# そのため、`--work-tree` だけでは「外部宛て」の根拠にならず、パスの指定が無いときと同じく判定できない。
	# （プロジェクトの中を指す `--work-tree` は、上の targets でブロックの側に反映する。）
	{ [ -n "${cdir}" ] || [ -n "${gitdir}" ]; } || return 1
	for t in "${targets[@]}"; do
		# プロジェクトの作業ツリーの内側を指すなら、このプロジェクト宛て。
		path_is_within "${t}" "${project_canon}" && return 1
		# 同じリポジトリの別 worktree はプロジェクトルートの外に置かれ得るので、
		# パスの包含だけでなく共有 git ディレクトリの一致でも対象内と判定する。
		if [ -n "${project_common}" ]; then
			tcommon=$(git_common_dir_of "${t}") || tcommon=""
			if [ -n "${tcommon}" ] && [ "${tcommon}" = "${project_common}" ]; then
				return 1
			fi
		fi
	done
	return 0
}

if [ "${extracted}" -eq 1 ]; then
	# 相対パス（`git -C ../fixture commit`）は、**コマンドが実行される cwd** を基準に解決する。チェックは
	# 既に project_root へ cd しているので、Hook の payload の cwd を優先して基準にする。
	base_dir=${payload_cwd}
	[ -n "${base_dir}" ] && [ -d "${base_dir}" ] || base_dir=${project_root}
	[ -n "${base_dir}" ] && [ -d "${base_dir}" ] || base_dir=$(pwd)
	# 比較する両辺に同じ正準化を当てる（片側だけだと symlink・`..` を挟んだ指定で一致しない）。
	project_canon=$(canonical_path "${project_root:-$(pwd)}" "$(pwd)") || project_canon=""
	project_common=$(git_common_dir_of "${project_root}") || project_common=""
	# `cd` / `pushd` / `popd` を含むコマンド行は、`git` が実行される cwd を決められない。
	# 引用した右辺はリテラルとして扱われるので、正規表現は変数に入れて、引用せずに渡す。
	cd_re=$'(^|[;&|(\n])[[:space:]]*(cd|pushd|popd)([[:space:]]|$)'
	cmd_cwd_uncertain=0
	if [[ ${cmd_masked} =~ ${cd_re} ]]; then
		cmd_cwd_uncertain=1
	fi
	# 1 行に複数の `git commit` が並ぶ形（`git -C /tmp/f commit -m a && git commit -m b`）が
	# あるので、最初の 1 件で判断しない。1 件でもプロジェクト宛て・判定不能があればブロックする。
	# 一致はマスク済みのコピーで取り、`commit_target_is_external` には**元の**部分文字列を渡す
	# （マスクは長さを保つので位置と長さをそのまま使える）。マスク側で切り出すとパスが `_` に
	# 潰れており、プロジェクト内外の判定ができない。
	scan=${cmd}
	scan_masked=${cmd_masked}
	all_external=1
	while [[ ${scan_masked} =~ ${commit_re} ]]; do
		matched_masked=${BASH_REMATCH[0]}
		[ -n "${matched_masked}" ] || break
		head_part=${scan_masked%%"${matched_masked}"*}
		match_off=${#head_part}
		match_len=${#matched_masked}
		matched=${scan:${match_off}:${match_len}}
		scan=${scan:$((match_off + match_len))}
		scan_masked=${scan_masked:$((match_off + match_len))}
		if ! commit_target_is_external "${matched}"; then
			all_external=0
			break
		fi
	done
	if [ "${all_external}" -eq 1 ]; then
		exit 0
	fi
fi

# チェック全体の締め切り（秒）。lifecycle のチェック・自分のセッションの分の走査・他のセッションの分の走査は、
# **開始からの経過時間で残りを割り当てて**、この締め切りの内側で終える。
#
# 締め切りが要るのは、エージェントが timeout に達したフックを**ブロックとして扱わない**からである。
# Claude Code の出典は https://code.claude.com/docs/en/hooks の次の文である。
# `"A timed-out command, http, or mcp_tool hook doesn't block the tool call. The call continues through the normal permission flow"`。
# Copilot も、timeout のときだけは通す。
# 走査ごとの上限を足し合わせる形では、全体の上限が決まらない。フックの timeout より長くかかると、exit 2 で止めるはずの
# commit が、**遅いときほどチェックなしに通る**。全体を 1 つの締め切りで制限すれば、フックの timeout がそれより
# 長い限り、止めるべき commit は最後まで処理されて止まる。
#
# 割り当てる順は、lifecycle のチェック → 自分のセッションの分 → 他のセッションの分である。前の 2 つは締め切りに達したら
# ブロックする（exit 2）。他のセッションの分は元から警告だけなので、打ち切ったことを出して残す。
# 経過時間は bash の SECONDS（整数秒。開始と現在のどちらも秒で切り捨てるので、誤差は ±1 秒）で測る。
# 残りは 1 秒を差し引いて割り当て、実際の時間で締め切りを超えないようにする。
# 締め切りの後に残る処理（checkpoint の記録・センチネルの列挙・案内の出力）は、走査を伴わない決まった
# 少量の処理で、上限はこの分を足した値になる（setup.md の設定例は、その余裕を含めた timeout を案内する）。
gate_deadline=8
gate_deadline_raw=${KAIZEN_PRECOMMIT_DEADLINE_SECONDS:-}
if [ -n "${gate_deadline_raw}" ]; then
	if [[ "${gate_deadline_raw}" =~ ^[0-9]{1,4}$ ]] && [ "$((10#${gate_deadline_raw}))" -ge 2 ] &&
		[ "$((10#${gate_deadline_raw}))" -le 3600 ]; then
		gate_deadline=$((10#${gate_deadline_raw}))
	else
		# 不正な値はデフォルトの値として扱う。警告なしに扱うと、設定したつもりの締め切りで動いていると読めてしまう。
		printf 'kaizen-precommit-gate: KAIZEN_PRECOMMIT_DEADLINE_SECONDS が不正です（%q。2〜3600 の整数）。既定の %s 秒を使います。\n' \
			"${gate_deadline_raw:0:40}" "${gate_deadline}" >&2
	fi
fi
# 最小は 2 秒。残りは 1 秒差し引いて配るので、1 秒では lifecycle 検査にも時間が残らず、
# センチネルの有無に関わらず、毎回締め切りを過ぎて止まる。
gate_remaining() {
	printf '%s' $((gate_deadline - SECONDS - 1))
}
has_timeout=0
command -v timeout >/dev/null 2>&1 && has_timeout=1

# lifecycle の不整合はセンチネルの有無にかかわらず commit を止める。
if [ -z "${script_dir}" ] || [ ! -r "${script_dir}/kaizen-status-check.sh" ]; then
	echo "kaizen-precommit-gate: bundled kaizen-status-check.sh is unavailable" >&2
	exit 2
fi
set +e
if [ "${has_timeout}" -eq 1 ]; then
	status_slice=$(gate_remaining)
	if [ "${status_slice}" -ge 1 ]; then
		status_output=$(timeout "${status_slice}" bash "${script_dir}/kaizen-status-check.sh" 2>&1)
		status_rc=$?
	else
		status_output=""
		status_rc=124
	fi
else
	# timeout が無い環境では縛れない。走査もできず、自分のセッションの分はブロックされるので、
	# 上限が外れるのはこの検査 1 本ぶんだけ。
	status_output=$(bash "${script_dir}/kaizen-status-check.sh" 2>&1)
	status_rc=$?
fi
set -e
if [ "${status_rc}" -ne 0 ]; then
	[ -n "${status_output}" ] && printf '%s\n' "${status_output}" >&2
	if [ "${status_rc}" -eq 124 ]; then
		printf 'kaizen-precommit-gate: lifecycle 検査がチェックの締め切り（%s 秒）までに終わりませんでした（判定できないのでブロックします）。KAIZEN_PRECOMMIT_DEADLINE_SECONDS で延ばせます（フックの timeout はそれより長くする）。\n' \
			"${gate_deadline}" >&2
	fi
	exit 2
fi
# 警告（rc 0）も出す。ここは lifecycle のチェックを自動で実行する唯一の場所なので、0 以外のときしか
# 出さないと、「commit のたびに気づける」はずの警告が誰にも届かない（「`type` が仕組みなのに
# `applied-to` がドキュメントだけ」という警告がこれに当たる）。commit は止めない。
#
# **stderr に書くだけでは表示されない。** PreToolUse フックの stderr が表示されるのは、0 以外で
# 終えたときだけで、そのまま通す `exit 0` では捨てられる。他のセッションの警告が
# ${warn_exit_code} を使っているのと同じ理由である（`references/setup.md` に出典付きで書いてある）。
# 警告を保持しておき、そのまま通す出口だけ終了コードを上げる（exit_pass）。
# ブロック（exit 2）の出口では stderr がそのまま表示されるので、ここで 1 回書けば足りる。
#
# **出力が空でないことを、警告の有無の判定に使わない。** `status_output` は `2>&1` で子プロセスの stderr を
# 全部拾うので、チェックと関係のない行（ロケールが未設定のときの `bash: warning: setlocale: ...` など）が
# 含まれる。空でないかで判定すると、警告が 0 件でも 0 以外を返し、ロケールの設定が不正なコンテナや CI では
# commit のたびに、ずっと 0 以外になる（実測: `LC_ALL=xx_YY.UTF-8` で rc が 0 から 1 になった）。
# チェック自身が名乗る接頭辞の行だけを取り出して、判定と表示に使う。
# **取り出しに外部のコマンドを使わない。** ここは、jq / python3 が無い PATH で機能を減らして動くときも通る場所で、
# `grep` を足すと `command not found` でブロックする側になる（実測でテストが失敗した）。
lifecycle_warning=""
while IFS= read -r status_line; do
	case "${status_line}" in
	"kaizen-status-check: "*) lifecycle_warning="${lifecycle_warning}${status_line}"$'\n' ;;
	esac
done <<<"${status_output}"
lifecycle_warning=${lifecycle_warning%$'\n'}
if [ -n "${lifecycle_warning}" ]; then
	printf '%s\n' "${lifecycle_warning}" >&2
fi

# 「止めないが警告はある」を表す出口。警告が無ければ従来どおり 0 で素通りする。
exit_pass() {
	[ -n "${lifecycle_warning}" ] && exit "${warn_exit_code}"
	exit 0
}

# 案内とコマンドに載せる値のチェック。センチネルの中身は自分のフックが書いたものだが、
# 不正な値や引用符を含む値を、そのまま貼り付けられるコマンドとして出さない。
sentinel_value_is_safe() { # $1: 値
	case "$1" in
	"") return 1 ;;
	*'"'* | *"'"* | *'$'* | *'`'* | *"\\"* | *$'\n'*) return 1 ;;
	esac
	[ "${#1}" -le 200 ]
}

# 未解決センチネルの復旧手順を stderr へ出す。センチネルは自分を解消するための同定情報
# （transcript パス・エージェント・session id）を持つので、立てた本人が戻らなくても
# 別セッションがそのまま実行できるコマンドを案内できる。
# `<transcript>` の穴埋めが必要な行を出したかどうか。呼び出し側が但し書きを出すか決める。
recovery_needs_transcript=0
print_sentinel_recovery() { # $1..: センチネルのパス
	local sentinel suffix s_transcript s_recorded s_agent s_session opts
	for sentinel in "$@"; do
		suffix=$(kaizen_sentinel_suffix_of "${sentinel}")
		s_transcript=$(sed -n '2p' "${sentinel}" 2>/dev/null || true)
		s_recorded=${s_transcript}
		s_agent=$(sed -n '3p' "${sentinel}" 2>/dev/null || true)
		s_session=$(sed -n '4p' "${sentinel}" 2>/dev/null || true)
		case "${s_agent}" in
		claude-code | codex | copilot) ;;
		*) s_agent="" ;;
		esac
		sentinel_value_is_safe "${s_session}" || s_session=""
		if ! sentinel_value_is_safe "${s_transcript}" || [ ! -r "${s_transcript}" ]; then
			s_transcript=""
		fi
		# suffix はファイル名由来なので、案内へ載せる前に stop-mark が作る形かを検査する。
		# 中身（transcript / session id）だけを検査して名前を素通しすると、想定外の名前の
		# ファイル（引用符を含む等）がそのまま「貼れるコマンド」へ入り、コピペ実行で
		# 意図しない解釈を招く。形が違うセンチネルはこちらが作ったものではなく、
		# kaizen-extract-done.sh も同じ検査で弾くため、コマンドを出さず手当てを促す。
		if [ -n "${suffix}" ] && [[ ! "${suffix}" =~ ^-[a-z0-9-]+$ ]]; then
			printf '  %q\n' "${sentinel}" >&2
			printf '    センチネル名が想定の形式ではありません（kaizen が作ったものではない可能性）。\n' >&2
			printf '    内容を確認したうえで手動で削除してください。\n' >&2
			continue
		fi
		opts="--sentinel-suffix \"${suffix}\""
		[ -n "${s_agent}" ] && opts="${opts} --agent \"${s_agent}\""
		[ -n "${s_session}" ] && opts="${opts} --session-id \"${s_session}\""
		# パスは案内として貼られ得るので %q でシェル安全に出す（通常の名前では見た目は変わらない）。
		printf '  %q\n' "${sentinel}" >&2
		if [ -n "${s_transcript}" ]; then
			printf '    bash "%s/kaizen-extract-done.sh" %s "%s"\n' "${script_dir}" "${opts}" "${s_transcript}" >&2
		elif [ "${s_agent}" = "copilot" ]; then
			# Copilot は Hook payload に transcript を持たないため、抽出後は transcript 無しで解消する。
			printf '    bash "%s/kaizen-extract-done.sh" %s\n' "${script_dir}" "${opts}" >&2
		else
			# 「記録が無い」と「記録はあるが今は使えない」は原因も対処も違うので区別して出す。
			# 一括りにすると、実在するのに読めていないだけの transcript を探し直させてしまう。
			if sentinel_value_is_safe "${s_recorded}" && [ -e "${s_recorded}" ]; then
				printf '    センチネルが記録した transcript を読めません（権限・FS 状態。パスは実在する）。\n' >&2
				printf '    読めるようにしてから抽出し、実行してください:\n' >&2
				printf '    bash "%s/kaizen-extract-done.sh" %s <transcript>\n' "${script_dir}" "${opts}" >&2
				# `<transcript>` の穴埋めが必須なのはこの分岐（実在するが今は読めない）だけ。
				# 他の分岐は transcript なしの解消コマンドで完結するため、ここでだけ立てる
				# （共通で立てると、他の分岐でも <transcript> の穴埋めが要るように読めてしまう）。
				recovery_needs_transcript=1
			elif [ -n "${s_recorded}" ]; then
				# 記録はあるが、パスが実在しない（移動・削除済み、剪定、値が不正）。探しても
				# 見つからないことがあるので、「記録なし」の分岐と同じく、transcript なしで解消するコマンドも出す。
				# ここを `-r` だけで「読めない」とまとめると、実在しない transcript を探させ続ける案内しか出ない。
				# そうなると、抽出済みのセッションが残したセンチネルが、ずっと commit を止める。
				# transcript が剪定された後に、ここに来る（checkpoint のあるセッションのセンチネルは、マーカーで上書きされないため）。
				# 実在していて読めないだけの場合（上の分岐）は、これまでどおり抽出を求める。
				printf '    センチネルが記録した transcript が実在しません（移動・削除済み、剪定、または値が不正）。\n' >&2
				printf '    該当セッションの transcript を探し（Claude Code: ~/.claude/projects/**、Codex: ~/.codex/sessions/**）、見つかれば抽出後に実行してください:\n' >&2
				printf '    bash "%s/kaizen-extract-done.sh" %s <transcript>\n' "${script_dir}" "${opts}" >&2
				printf '    探しても見つからない場合は、transcript を指定せず次のコマンドで解消してください:\n' >&2
				printf '    bash "%s/kaizen-extract-done.sh" %s\n' "${script_dir}" "${opts}" >&2
			else
				# transcript を一度も記録していないセンチネル（session 単位にする前のもの、記録に失敗したもの、
				# または `/compact` 専用の隠しセッションのように transcript を一度も作らないまま
				# Stop が実行された場合）。無い transcript は探しても見つからないので、
				# 見つからなかったときに解消するコマンドも合わせて出す（「transcript の無いセッションに
				# 抽出すべき学びは無い」という判断で、transcript を指定せずに解消できる）。
				printf '    transcript の記録がありません（session 単位化より前のセンチネル、記録に失敗、または /compact 専用の隠しセッションのように transcript を一度も作らないまま終了した可能性）。\n' >&2
				printf '    Claude Code: ~/.claude/projects/**、Codex: ~/.codex/sessions/** を探し、見つかれば抽出後に渡して実行してください:\n' >&2
				printf '    bash "%s/kaizen-extract-done.sh" %s <transcript>\n' "${script_dir}" "${opts}" >&2
				printf '    探しても見つからない場合は、transcript を指定せず次のコマンドで解消してください:\n' >&2
				printf '    bash "%s/kaizen-extract-done.sh" %s\n' "${script_dir}" "${opts}" >&2
			fi
		fi
	done
}

# `YYYY-MM-DDTHH:MM:SSZ`（センチネルの 1 行目・`date -u` の出力）を UTC の秒に変換する。
# 形式が違えば 1 を返す。**判定できない値を「古い」として扱わない**（回収は削除なので、
# 読めない値を削除する側として扱うと、実際には持ち主が動いているセンチネルまで消す）。
epoch_from_stamp() { # $1: タイムスタンプ
	local y mo d hh mi ss
	[[ "${1:-}" =~ ^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z?$ ]] || return 1
	# 先頭 0 を 8 進として解釈させない（`08` / `09` は算術エラーになる）。
	y=$((10#${BASH_REMATCH[1]}))
	mo=$((10#${BASH_REMATCH[2]}))
	d=$((10#${BASH_REMATCH[3]}))
	hh=$((10#${BASH_REMATCH[4]}))
	mi=$((10#${BASH_REMATCH[5]}))
	ss=$((10#${BASH_REMATCH[6]}))
	[ "${mo}" -ge 1 ] && [ "${mo}" -le 12 ] || return 1
	[ "${d}" -ge 1 ] && [ "${d}" -le 31 ] || return 1
	[ "${hh}" -le 23 ] && [ "${mi}" -le 59 ] && [ "${ss}" -le 60 ] || return 1
	# 暦の計算は共通ライブラリ（kaizen-hook-common.sh）が持つ。読めずに機能を減らして動く環境では、
	# タイムスタンプを「判定できない」として返す。回収は削除なので、算術のエラーを握りつぶして
	# 0 を返すと 1970 年として扱われ、動いているセンチネルまで古いとみなして消す。
	# **機能を減らした版に暦の計算を足しても、回収は動かない。** その版の `kaizen_sentinel_key_of` は空を返し、
	# 持ち主を特定できないセンチネルは、sweep_expired_foreign_sentinels がどれも対象外にする
	# （自分の側として扱う）。回収が成り立つのはライブラリを読めた構成だけで、これは暦の計算を
	# ライブラリに移す前から変わらない（2 つの構成と新旧 2 つの版の、4 通りを実測して確かめた）。
	declare -f kaizen_days_from_civil >/dev/null 2>&1 || return 1
	printf '%s' $(($(kaizen_days_from_civil "${y}" "${mo}" "${d}") * 86400 + hh * 3600 + mi * 60 + ss))
}

# 他のセッションのセンチネルを回収するまでの日数。デフォルトは 7 日で、`never` なら回収しない。
# 放置されたセンチネルには解消できる人がいないので、時間で回収する仕組みが要る。
foreign_retention_days=7
resolve_retention_days() {
	local raw
	raw=$(kaizen_config_value foreign_sentinel_retention_days) || return 0
	case "${raw}" in
	never)
		foreign_retention_days=never
		return 0
		;;
	esac
	if [[ "${raw}" =~ ^[0-9]{1,6}$ ]]; then
		foreign_retention_days=$((10#${raw}))
		return 0
	fi
	# 不正な値はデフォルトの値として扱う。警告なしに扱うと「設定したつもりの日数で回収されている」と読めてしまうので、出力する。
	printf 'kaizen-precommit-gate: .kaizen/config の foreign_sentinel_retention_days が不正です（%q）。既定の %s 日を使います。\n' "${raw:0:40}" "${foreign_retention_days}" >&2
}

# 保持期間を過ぎた**他セッションの**センチネルを回収する。
#
# 削除しても学びは失われない——センチネルは「未抽出である」という印であって、transcript は残る
# （後から `kaizen extract` で読み直せる）。回収するのは、持ち主のセッションが戻ってこない
# センチネルには解消できる主体がいないため。「判定不能だから消す」はしない（実際に未抽出の学びが
# ある場合と区別できなくなる）——基準は**時間だけ**にしてある。
sweep_expired_foreign_sentinels() {
	local sentinel key now_s then_s age
	[ "${foreign_retention_days}" = "never" ] && return 0
	now_s=$(epoch_from_stamp "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || true)") || return 0
	for sentinel in "${unresolved[@]}"; do
		[ -e "${sentinel}" ] || continue
		key=$(kaizen_sentinel_key_of "${sentinel}")
		# 自セッション分は自分で解消できるので回収しない。key を持たない旧形式は持ち主を
		# 特定できず、下の分岐も自分側として扱うため同じく対象外。
		[ -n "${key}" ] || continue
		if [ -z "${session_key}" ] || [ "${key}" = "${session_key}" ]; then
			continue
		fi
		then_s=$(epoch_from_stamp "$(sed -n '1p' "${sentinel}" 2>/dev/null || true)") || continue
		age=$(((now_s - then_s) / 86400))
		# 経過日数は切り捨てなので `-ge` で比べる。`-gt` にすると保持期間 ＋ 1 日まで残り、
		# 「7 日を過ぎたら回収する」という案内と食い違う（7.5 日のセンチネルが残る）。
		[ "${age}" -ge "${foreign_retention_days}" ] || continue
		rm -f "${sentinel}"
		# 対応する制御ファイルも道連れにしない。checkpoint は持ち主が戻ってきたときの差分走査の
		# 起点で、消すと全走査＝恒久ブロックへ戻る。残しても、センチネルが無い限り遮断はしない。
		# 走査結果のキャッシュは別で、センチネルが無ければ読む者がいないので一緒に消す。
		rm -f "$(foreign_scan_cache_path "${sentinel}" "${key}")"
		printf 'kaizen-precommit-gate: 保持期間（%s 日）を過ぎた他セッションのセンチネルを回収しました: %q（%s 日前。transcript は残っています）\n' \
			"${foreign_retention_days}" "${sentinel}" "${age}" >&2
	done
}

# 未解決センチネル ＝ 対応する抽出完了マーカーが無いセンチネル。センチネルもマーカーも
# session 単位なので、あるセッションの抽出完了が他セッションの未抽出シグナルを覆い隠さない。
# session 単位化より前の（key を持たない）センチネルは、同じく key を持たない
# マーカーが覆う。
#
# ただし、**そのセッションの checkpoint がある場合は、マーカーで上書きしない**。
# マーカーはセッション全体を抽出済みにする印なので、上書きさせると、1 本の branch で複数回 commit する
# ときに、最初の commit までの活動しか抽出されない。checkpoint があれば、差分の走査で「前回の抽出の後に
# たまった活動」だけをチェックでき、候補ゼロなら自動で通し、候補があればブロックできる。
# checkpoint が無いときだけ、マーカーを優先する。差分を走査する起点が無く、commit のたびに全体を走査して
# ずっとブロックするためである。書く側の kaizen-extract-done.sh もこの条件でしかマーカーを書かないが、
# 止めるかの判断はチェックの側にも置き、古いマーカーが残っていても取りこぼさないようにする。
# key を持たない以前の形式は対象外にする。key の無い checkpoint は 1 つのファイルで、そのセンチネルの
# transcript を指しているとは限らず、「新しい活動がある」の根拠にできない（これまでどおりマーカーで上書きする）。
#
# 走査は**リポジトリの全作業ツリー**（本体＋git worktree）へ広げる。センチネルを立てたツリーと
# `git commit` を実行するツリーが分かれると、自分のツリーの `.kaizen/` だけを見る形では
# **worktree の commit が素通りする**。マーカー・checkpoint の探索も同じ範囲にする
# ——片方だけ広げると、別ツリーのセンチネルを見つけた直後に「マーカーが無い」と読んで
# 解消済みのセッションで再びブロックする。
collect_unresolved() {
	unresolved=()
	local dir sentinel key done_name checkpoint_name
	while IFS= read -r -d '' dir; do
		for sentinel in "${dir}"/.pending-extract*; do
			[ -e "${sentinel}" ] || continue
			key=$(kaizen_sentinel_key_of "${sentinel}")
			done_name=$(kaizen_done_path "${key}")
			done_name=${done_name#.kaizen/}
			checkpoint_name=$(kaizen_checkpoint_path "${key}")
			checkpoint_name=${checkpoint_name#.kaizen/}
			if kaizen_find_control_file "${project_root}" "${done_name}" >/dev/null 2>&1; then
				if [ -z "${key}" ] || ! kaizen_find_control_file "${project_root}" "${checkpoint_name}" >/dev/null 2>&1; then
					continue
				fi
			fi
			unresolved+=("${sentinel}")
		done
	done < <(kaizen_worktree_kaizen_dirs "${project_root}")
}

# 他セッションの未解決センチネルを、そのセンチネルが記録している transcript で差分走査し、
# 候補ゼロを検証できたものだけ解消する。
#
# これが無いと、commit せずに終わったセッションのセンチネルがずっと commit を止める。それ以降は
# どのセッションの commit も、人が抽出しないと通らない（Stop フックは毎ターン立てるので、
# 「一度も commit しなかったセッション」は必ず 1 つ残す）。センチネルは transcript のパスと
# session id を持ち、そのセッションの checkpoint も残っているので、チェックは自分の分と同じ
# 差分の走査を、他のセッションの分にも当てられる。**候補が残っているセンチネルはブロックのまま**なので、
# 「学びを取りこぼさない」という保証は緩めず、候補ゼロだった残りの後片付けだけを自動にする。
#
# 走査の時間は、チェック全体の締め切りの残りで制限する。打ち切った分はブロックしたまま残し、打ち切った
# ことを出力する（警告なしにやめると、「全部見たうえでブロックしている」ように読めてしまう）。
#
# **前回と同じ結果になる走査は、繰り返さない。** 候補が残っているセンチネルは解消されないので、
# 何もしなければ commit のたびに同じ範囲を走査し直し、締め切りの残りを毎回同じ結論に使い切る。
# 走査の結果を、それを決めた入力（transcript の大きさ・checkpoint・スキャナ・jq）と一緒に
# センチネルの隣に残し、入力がどれも変わっていなければ走査しない。transcript は追記だけなので、
# 大きさが同じなら中身も同じである。
#
# キャッシュが誤っていても、commit を通すかには影響しない。この処理で解消（センチネルの削除）するのは、
# スキャナが**今回**検証済みゼロを返したときだけで、キャッシュを読んで省くのは「解消しない」側の
# 結論（候補あり・打ち切り）だけである。判定できない結果は一時的な失敗と区別できないので、残さない。
# 読めない・形が違うキャッシュは、無いものとして走査する。
#
# 名前は `.extract-checkpoint.<key>.foreign-scan`。session key は `.` を含まないので checkpoint
# と衝突せず、既存の `.gitignore` の `**/.kaizen/.extract-checkpoint*` が制御ファイルとして除外する
# （利用者の `.gitignore` に追記を求めない）。
foreign_scan_cache_path() { # $1: センチネルのパス $2: session key
	printf '%s/.extract-checkpoint.%s.foreign-scan' "${1%/*}" "$2"
}
foreign_scan_cache_header="kaizen-foreign-scan-cache v1"
scanner_fingerprint=""
fingerprint_of() { # $1: ファイル。無い・読めないなら absent
	local sum
	if [ -r "$1" ]; then
		sum=$(cksum <"$1" 2>/dev/null) || sum=""
		printf '%s' "${sum:-unreadable}"
	else
		printf 'absent'
	fi
}
# 走査の結論を決める入力を 1 行ずつ並べる（キャッシュの 2〜6 行目）。
foreign_scan_inputs() { # $1: transcript $2: checkpoint
	local size
	size=$(wc -c <"$1" 2>/dev/null) || size=""
	size=${size//[[:space:]]/}
	[ -n "${scanner_fingerprint}" ] || scanner_fingerprint=$(fingerprint_of "${script_dir}/kaizen-candidate-scan.sh")
	printf '%s\n%s\n%s\n%s\n%s' "$1" "${size:-unknown}" "$(fingerprint_of "$2")" "${scanner_fingerprint}" \
		"$(command -v jq 2>/dev/null || printf 'none')"
}
# 前回の結論を再利用できるなら、その結論（rc と打ち切り秒数）を返す。できなければ非 0。
foreign_scan_cached() { # $1: キャッシュ $2: 今回の入力 $3: 今回使える秒数
	local content expected cached_rc cached_slice
	[ -r "$1" ] || return 1
	content=$(cat "$1" 2>/dev/null) || return 1
	expected="${foreign_scan_cache_header}"$'\n'"$2"
	case "${content}" in
	"${expected}"$'\n'*) ;;
	*) return 1 ;;
	esac
	content=${content#"${expected}"$'\n'}
	# 残りは「結論」と「秒数」の 2 行ちょうど。改行が無いと、下の分割が両方に同じ値を入れてしまう。
	case "${content}" in
	*$'\n'*) ;;
	*) return 1 ;;
	esac
	cached_rc=${content%%$'\n'*}
	cached_slice=${content#*$'\n'}
	[[ "${cached_slice}" =~ ^[0-9]{1,6}$ ]] || return 1
	case "${cached_rc}" in
	# 候補ありは、入力が同じなら同じ結論になる。判定できない結果（2）は再利用しない。スキャナは一時ファイルの
	# 作成や読み取りの失敗といった一時的な理由でも 2 を返し、入力からは区別できない。再利用すると、
	# 持ち主が戻らないセンチネル（transcript がもう伸びない）を、保持期間が過ぎるまで再試行しなくなる。
	0) ;;
	# 打ち切りは、前回より長く使えるときだけ走査し直す（同じ時間では同じところで打ち切られる）。
	# 使える秒数は SECONDS の誤差で ±1 秒揺れるので、1 秒の差では走査し直さない。
	124) [ "$3" -le "$((10#${cached_slice} + 1))" ] || return 1 ;;
	*) return 1 ;;
	esac
	printf '%s %s' "${cached_rc}" "$((10#${cached_slice}))"
}
resolve_foreign_sentinels() {
	local sentinel key suffix f_transcript f_agent f_session f_checkpoint out rc agent bytes lines line slice
	local cache inputs cached tmp
	for sentinel in "${unresolved[@]}"; do
		[ -e "${sentinel}" ] || continue
		key=$(kaizen_sentinel_key_of "${sentinel}")
		# 自分のセッションの分は、上の処理が扱う。key を持たない以前の形式は持ち主を特定できず、
		# 記録された transcript も無いので、ここでは触らない（これまでどおりブロックする）。
		[ -n "${key}" ] || continue
		if [ -n "${session_key}" ] && [ "${key}" = "${session_key}" ]; then
			continue
		fi
		slice=$(gate_remaining)
		if [ "${slice}" -lt 1 ]; then
			echo "kaizen-precommit-gate: gate deadline (${gate_deadline}s) reached; the remaining sentinels were not auto-checked" >&2
			return 0
		fi
		f_transcript=$(sed -n '2p' "${sentinel}" 2>/dev/null || true)
		f_agent=$(sed -n '3p' "${sentinel}" 2>/dev/null || true)
		f_session=$(sed -n '4p' "${sentinel}" 2>/dev/null || true)
		# スキャナが識別できるのは Claude Code / Codex だけである（Copilot は transcript を持たない）。
		case "${f_agent}" in claude-code | codex) ;; *) continue ;; esac
		sentinel_value_is_safe "${f_transcript}" || continue
		[ -r "${f_transcript}" ] || continue
		sentinel_value_is_safe "${f_session}" || continue
		# 記録された session id がファイル名の key と一致しないセンチネルは触らない。
		# 一致を確かめずに --session-id を渡すと、別セッションの制御ファイルを操作してしまう。
		[ "$(kaizen_session_key "${f_session}")" = "${key}" ] || continue
		# 削除対象を決めるのはファイル名の suffix。センチネルが名乗る agent と食い違うなら触らない。
		suffix=$(kaizen_sentinel_suffix_of "${sentinel}")
		case "${f_agent}" in
		claude-code) [ -z "${suffix}" ] || continue ;;
		codex) [ "${suffix}" = "-codex" ] || continue ;;
		esac
		set +e
		# checkpoint も全作業ツリーから探す（センチネルと同じ範囲）。
		# 見つからなければ自分のツリーのパスを渡す＝不在扱いで offset 0（従来どおり）。
		f_checkpoint=$(kaizen_checkpoint_path "${key}")
		f_checkpoint=$(kaizen_find_control_file "${project_root}" "${f_checkpoint#.kaizen/}" 2>/dev/null) ||
			f_checkpoint=$(kaizen_checkpoint_path "${key}")
		cache=$(foreign_scan_cache_path "${sentinel}" "${key}")
		inputs=$(foreign_scan_inputs "${f_transcript}" "${f_checkpoint}")
		# 使える時間は、走査の直前にもう一度測る。ループの先頭で取った値のままだと、ここまでのすべての作業ツリーの探索や
		# wc / cksum に使った時間を差し引かず、最後の走査が締め切りを超える。
		slice=$(gate_remaining)
		if [ "${slice}" -lt 1 ]; then
			set -e
			echo "kaizen-precommit-gate: gate deadline (${gate_deadline}s) reached; the remaining sentinels were not auto-checked" >&2
			return 0
		fi
		if cached=$(foreign_scan_cached "${cache}" "${inputs}" "${slice}"); then
			set -e
			# 省いたことは出す（出さないと、走査して残したのか見ずに残したのかが読めない）。
			printf 'kaizen-precommit-gate: skipped re-scanning %q: unchanged since the last scan (exit %s after up to %ss)\n' \
				"${sentinel}" "${cached%% *}" "${cached#* }" >&2
			continue
		fi
		out=$(timeout "${slice}" bash "${script_dir}/kaizen-candidate-scan.sh" "${f_transcript}" "${f_checkpoint}" 2>&1)
		rc=$?
		case "${rc}" in
		0 | 124)
			# キャッシュは最適化なので、書けなくても走査の結論は変えない。
			tmp="${cache}.tmp.$$"
			if printf '%s\n%s\n%s\n%s\n' "${foreign_scan_cache_header}" "${inputs}" "${rc}" "${slice}" >"${tmp}" 2>/dev/null; then
				mv -f "${tmp}" "${cache}" 2>/dev/null || rm -f "${tmp}"
			else
				rm -f "${tmp}"
			fi
			;;
		*) rm -f "${cache}" ;;
		esac
		set -e
		# 終了コードの取り決めは、自分のセッションの分と同じ。1（検証済みゼロ）以外は触らず、ブロックのまま残す。
		[ "${rc}" -eq 1 ] || continue
		agent=""
		bytes=""
		lines=""
		while IFS= read -r line; do
			case "${line}" in
			"kaizen-candidate-scan: agent=claude-code") agent=claude-code ;;
			"kaizen-candidate-scan: agent=codex") agent=codex ;;
			"kaizen-candidate-scan: scanned-bytes="*) bytes=${line#*=} ;;
			"kaizen-candidate-scan: scanned-lines="*) lines=${line#*=} ;;
			esac
		done <<<"${out}"
		# スキャナが名乗る agent がセンチネルの記録と違うなら、対象を取り違えている。触らない。
		[ -n "${agent}" ] && [ "${agent}" = "${f_agent}" ] || continue
		[[ "${bytes}" =~ ^[0-9]+$ ]] && [[ "${lines}" =~ ^[0-9]+$ ]] || continue
		set +e
		bash "${script_dir}/kaizen-extract-done.sh" --checkpoint-only --sentinel-suffix "${suffix}" \
			--agent "${agent}" --session-id "${f_session}" \
			--scanned-bytes "${bytes}" --scanned-lines "${lines}" "${f_transcript}" >/dev/null 2>&1
		set -e
	done
}

unresolved=()
collect_unresolved
if [ "${#unresolved[@]}" -eq 0 ]; then
	exit_pass
fi

# 走査より先に、保持期間を過ぎた他セッションのセンチネルを回収する（回収できたぶんは走査予算を使わない）。
resolve_retention_days
sweep_expired_foreign_sentinels
collect_unresolved
if [ "${#unresolved[@]}" -eq 0 ]; then
	exit_pass
fi

# 自セッションのセンチネルが未解決のときだけ transcript を走査する。他セッションのものしか
# 残っていないなら、走査しても自分のセンチネルは消えず走査時間を捨てるだけになる。
# key を持たない旧形式は持ち主を特定できないため自分側として扱う（session 単位化前と同じ扱い）。
own_pending=0
for sentinel in "${unresolved[@]}"; do
	sentinel_key=$(kaizen_sentinel_key_of "${sentinel}")
	if [ -z "${sentinel_key}" ] || [ -z "${session_key}" ] || [ "${sentinel_key}" = "${session_key}" ]; then
		own_pending=1
		break
	fi
done

# transcript_path があり、同梱のスキャナを読めるときだけ、候補ゼロでの自動通過を試みる。
# スキャナの終了コードは、0=候補あり、1=検証済みゼロ、2=不明である。timeout（124）を含め、1 以外はブロックの側として扱う。
own_resolved=0
scan_output=""
scan_rc=2
scan_agent=""
scanned_bytes=""
scanned_lines=""
sentinel_suffix=""
if [ "${own_pending}" -eq 1 ] && [ -n "${transcript}" ] && [ -r "${script_dir}/kaizen-candidate-scan.sh" ]; then
	# checkpoint は session 単位である。走査の位置は transcript ごとに保たれ、別のセッションの走査で
	# 上書きされない。session 単位にする前の 1 つだけの checkpoint は、それが同じ transcript を
	# 指しているときだけ、読み取りに使う（アップグレードの直後に全体を走査するのを避ける）。書き込みは
	# kaizen-extract-done.sh が session 単位のパスに行う。
	# 自分のツリーに無ければ、他の作業ツリーからも探す。同じセッションが共有ツリーと worktree に
	# またがって続くと、checkpoint は片方にしか無い。見つからないまま全体を走査すると、
	# 抽出済みの範囲を再検出して、commit が止まり続ける。
	checkpoint_path=$(kaizen_checkpoint_path "${session_key}")
	if [ ! -e "${checkpoint_path}" ]; then
		checkpoint_path=$(kaizen_find_control_file "${project_root}" "${checkpoint_path#.kaizen/}" 2>/dev/null) ||
			checkpoint_path=$(kaizen_checkpoint_path "${session_key}")
	fi
	if [ ! -e "${checkpoint_path}" ]; then
		# session 単位化より前の単一 checkpoint は、それが同じ transcript を指しているときだけ
		# 読み取りに使う（アップグレード直後の全走査を避ける）。
		legacy_checkpoint=$(kaizen_find_control_file "${project_root}" ".extract-checkpoint" 2>/dev/null) || legacy_checkpoint=""
		if [ -n "${legacy_checkpoint}" ] && [ -r "${legacy_checkpoint}" ] &&
			[ "$(sed -n '1p' "${legacy_checkpoint}" 2>/dev/null || true)" = "${transcript}" ]; then
			checkpoint_path=${legacy_checkpoint}
		fi
	fi
	set +e
	own_slice=$(gate_remaining)
	if [ "${has_timeout}" -eq 1 ] && [ "${own_slice}" -lt 1 ]; then
		scan_output="kaizen-precommit-gate: no time left before the gate deadline (${gate_deadline}s) to scan the transcript; set KAIZEN_PRECOMMIT_DEADLINE_SECONDS higher (and the hook timeout above it)"
		scan_rc=2
	elif [ "${has_timeout}" -eq 1 ]; then
		scan_output=$(timeout "${own_slice}" bash "${script_dir}/kaizen-candidate-scan.sh" "${transcript}" "${checkpoint_path}" 2>&1)
		scan_rc=$?
		if [ "${scan_rc}" -eq 124 ]; then
			scan_output="${scan_output:+${scan_output}$'\n'}kaizen-precommit-gate: the transcript scan hit the gate deadline (${gate_deadline}s, ${own_slice}s left for the scan); set KAIZEN_PRECOMMIT_DEADLINE_SECONDS higher (and the hook timeout above it)"
		fi
	else
		scan_output="kaizen-precommit-gate: timeout command is unavailable; automatic transcript scan is disabled"
		scan_rc=2
	fi
	set -e
	# スキャナの報告は、bash の組み込みの照合だけで読む。`sed` の `\|`（BRE の選択）は GNU の拡張で、
	# 持たない実装（BSD / macOS の標準）では agent を取り出せず、候補ゼロでも毎回ブロックすることになる。
	while IFS= read -r scan_line; do
		case "${scan_line}" in
		"kaizen-candidate-scan: agent=claude-code") scan_agent=claude-code ;;
		"kaizen-candidate-scan: agent=codex") scan_agent=codex ;;
		"kaizen-candidate-scan: scanned-bytes="*) scanned_bytes=${scan_line#*=} ;;
		"kaizen-candidate-scan: scanned-lines="*) scanned_lines=${scan_line#*=} ;;
		esac
	done <<<"${scan_output}"
	case "${scan_agent}" in
	claude-code) sentinel_suffix="" ;;
	codex) sentinel_suffix="-codex" ;;
	*) sentinel_suffix="" ;;
	esac

	if [ "${scan_rc}" -eq 1 ]; then
		if [ -z "${scan_agent}" ]; then
			echo "kaizen-precommit-gate: verified-zero scan did not identify its agent; pending sentinels were preserved" >&2
			exit 2
		fi
		# 走査済みの終端が分からないまま checkpoint を進めると、走査していない範囲まで
		# 処理済みにしてしまう。取れなければ、これまでどおり止める。
		if [[ ! "${scanned_bytes}" =~ ^[0-9]+$ ]] || [[ ! "${scanned_lines}" =~ ^[0-9]+$ ]]; then
			echo "kaizen-precommit-gate: verified-zero scan did not report its scanned position; pending sentinels were preserved" >&2
			exit 2
		fi
		set +e
		# --agent は checkpoint の 3 行目に記録される。次回、新しいレコードが 1 件も無いとき
		# （前回の走査の後に活動が無いとき）に、スキャナがエージェントを知る唯一の手がかりになる。
		# --session-id は、制御ファイルの session 単位の名前を決める。
		done_output=$(bash "${script_dir}/kaizen-extract-done.sh" --checkpoint-only --sentinel-suffix "${sentinel_suffix}" --agent "${scan_agent}" --session-id "${session_id}" --scanned-bytes "${scanned_bytes}" --scanned-lines "${scanned_lines}" "${transcript}" 2>&1)
		done_rc=$?
		set -e
		if [ "${done_rc}" -ne 0 ]; then
			printf 'kaizen-precommit-gate: failed to advance checkpoint: %s\n' "${done_output}" >&2
			exit 2
		fi
		# session 単位にする前に立てられた（key を持たない）同じ agent のセンチネルは、持ち主を
		# 特定できない。いま同じ agent の transcript を候補ゼロで確かめられたので、session 単位に
		# する前と同じ判断で、これを無効にする（アップグレードの直後の一度だけ。いまの Stop フックは
		# key 付きのセンチネルしか作らない）。
		# collect_unresolved は、key を持たないセンチネルを**すべての作業ツリー**から拾い、持ち主を
		# 特定できない分は自分の側として扱い、ブロックする。無効にする範囲も同じにしないと、
		# 別のツリーに残った以前の形式のセンチネルを、この処理では二度と消せず、ブロックが続く。
		legacy_sentinel_name=$(kaizen_sentinel_path "${sentinel_suffix}" "")
		legacy_sentinel_name=${legacy_sentinel_name#.kaizen/}
		while IFS= read -r -d '' legacy_dir; do
			[ -n "${legacy_dir}" ] || continue
			rm -f "${legacy_dir}/${legacy_sentinel_name}"
		done < <(kaizen_worktree_kaizen_dirs "${project_root}")
		collect_unresolved
		if [ "${#unresolved[@]}" -eq 0 ]; then
			exit_pass
		fi
		own_resolved=1
	fi
fi

# 自分側がブロック要因でないときだけ、他セッションのセンチネルの自動解消を試す。
# 自分の transcript に候補が出ているならどのみちブロックなので、走査時間を使わない。
if { [ "${own_pending}" -eq 0 ] || [ "${own_resolved}" -eq 1 ]; } && [ "${has_timeout}" -eq 1 ] &&
	[ -r "${script_dir}/kaizen-candidate-scan.sh" ]; then
	resolve_foreign_sentinels
	collect_unresolved
	if [ "${#unresolved[@]}" -eq 0 ]; then
		exit_pass
	fi
fi

# 残ったセンチネルを自セッション分と他セッション分へ分ける。**遮断するのは自セッション分だけ**。
# 学びの抽出は「そのセッションで何が起きたかを知っている主体」にしかできず、
# 他セッションのぶんを引き受けさせると記録の担保が「読んだ人の推測」に変わる。
# 止めた相手が解消できないなら止める意味が無いので、他セッション分は**知らせるだけ**にする。
# key を持たない旧形式は持ち主を特定できないため、従来どおり自分側として扱う（遮断する）。
own_unresolved=()
foreign_unresolved=()
for sentinel in "${unresolved[@]}"; do
	sentinel_key=$(kaizen_sentinel_key_of "${sentinel}")
	if [ -z "${sentinel_key}" ] || [ -z "${session_key}" ] || [ "${sentinel_key}" = "${session_key}" ]; then
		own_unresolved+=("${sentinel}")
	else
		foreign_unresolved+=("${sentinel}")
	fi
done

# ブロックするかは、**最後に残った自分のセッションの分**（own_unresolved）で決める。
# 走査の前のフラグ（own_pending / own_resolved）で決めると、自分の transcript が候補ゼロだったときに問題が起きる。
# 走査では消えない「自分のセッションとして扱う」センチネルが、誰にも報告されないまま commit を通してしまう（実測）。
# これは、key を持たない以前の形式のセンチネルや、session key を取れない環境で自分の側として扱った他のセッションの分である。
own_blocking=0
if [ "${#own_unresolved[@]}" -gt 0 ]; then
	own_blocking=1
fi

# 他セッションのセンチネルを参考情報として並べる。ブロック要因ではないので、解消を促すのではなく
# 「誰が解消できるか」と「いつ自動回収されるか」を出す。
warn_foreign_sentinels() {
	[ "${#foreign_unresolved[@]}" -gt 0 ] || return 0
	{
		echo "他セッションの未抽出センチネルが残っています（コミットは止めません）:"
		if [ "${foreign_retention_days}" = "never" ]; then
			echo "保持期間による自動回収は無効です（.kaizen/config の foreign_sentinel_retention_days=never）。"
		else
			echo "立ってから ${foreign_retention_days} 日を過ぎたものは、次のコミット前のチェックが自動で回収します（消えるのは「未抽出である」という印だけで、transcript は残り kaizen extract で読み直せます）。日数は .kaizen/config の foreign_sentinel_retention_days で変えられます。"
		fi
		echo "いま解消できるのは、そのセッションの transcript から抽出できる主体だけです。引き受ける場合のコマンド:"
	} >&2
	recovery_needs_transcript=0
	print_sentinel_recovery "${foreign_unresolved[@]}"
	if [ "${recovery_needs_transcript}" -eq 1 ]; then
		{
			echo "上の <transcript> だけを、そのセンチネルを立てたセッションの transcript パスに置き換えてください。"
			echo "--sentinel-suffix / --session-id は表示された値のまま使う（自分のセッションの値に置き換えない）。"
		} >&2
	fi
}

if [ "${own_blocking}" -eq 0 ]; then
	# 自分のセッションの分は残っていない。他のセッションの分だけでは commit を止めない。0 以外で終えるのは、
	# 警告を表示するためである。PreToolUse をブロックするのは exit 2 だけで、他の 0 以外は
	# 「ブロックしない失敗」として stderr が表示される。
	# 出典は Claude Code が https://code.claude.com/docs/en/hooks 、Codex が https://learn.chatgpt.com/docs/hooks である。
	# Copilot だけは 0 以外がすべて deny なので、警告の終了コードは ${warn_exit_code}（$1 で切り替える）にする。
	warn_foreign_sentinels
	[ "${#foreign_unresolved[@]}" -gt 0 ] || exit_pass
	exit "${warn_exit_code}"
fi

{
	if [ "${scan_rc}" -eq 0 ]; then
		echo "kaizen の学び候補が transcript の未処理範囲で検出されました:"
		printf '%s\n' "${scan_output}"
	else
		echo "未抽出の kaizen 候補を自動判定できませんでした（判定できないのでブロックします）。"
		[ -n "${scan_output}" ] && printf '%s\n' "${scan_output}"
	fi
	echo "kaizen --current を実行し、最重要 1 件を記録してください。"
	echo "コミットの既定クリティカルパスでは apply を後回しにできます。今すぐ適用する場合だけ apply フローまで続けてください。"
	echo "未解決のセンチネルと、それぞれを解消するコマンド:"
} >&2
recovery_needs_transcript=0
print_sentinel_recovery "${own_unresolved[@]}"
{
	if [ "${recovery_needs_transcript}" -eq 1 ]; then
		# 穴埋めが要るのは `<transcript>` だけ。`--sentinel-suffix` / `--session-id` は
		# **そのセンチネルを立てたセッション**の値であり、自分の値に置き換えてはいけない
		# （置き換えると別名のマーカーが増えるだけで、対象のセンチネルは残りブロックが解けない）。
		echo "上の <transcript> だけを、そのセンチネルを立てたセッションの transcript パスに置き換えてください。"
		echo "--sentinel-suffix / --session-id は表示された値のまま使う（自分のセッションの値に置き換えない）。"
	fi
	# 抽出は忘却の掃引も実行する（追跡している .kaizen/*.md を書き換える）。新しい記録だけを
	# パスを指定して stage すると、その差分が未ステージのまま残り、clean を確かめる工程が止まる。
	echo "その後、git add .kaizen/ で記録と忘却の差分をまとめて stage し、git commit を再実行してください。"
} >&2
warn_foreign_sentinels
exit 2
