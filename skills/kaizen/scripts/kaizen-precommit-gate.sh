#!/usr/bin/env bash
# kaizen pre-commit gate (PreToolUse hook)
#
# 非 commit は bash 組み込みの prefilter だけで即時終了する。commit のときは
# lifecycle 整合を検査し、未抽出センチネルがあれば transcript の未処理部分を走査する。
# 候補ゼロを検証できた場合だけ自動で checkpoint を進める。候補あり・形式不明・timeout は
# exit 2 + stderr でブロックし、従来の kaizen --current にフォールバックする。
set -euo pipefail

input=""
if [ ! -t 0 ]; then
	# NUL は通常の Hook JSON に現れないため、read 1 回で EOF まで読み込む。cat / jq / python を
	# 起動する前に非 commit を落とすのが、このフックの hot path。
	IFS= read -r -d '' input || true
fi

# Claude Code は setup の handler `if` でも絞る。Codex / Copilot の matcher は tool 名まで
# なので、この広い prefilter が全 Bash 呼び出しの低コストな第一段になる。
case "${input}" in
*git*commit*) ;;
*) exit 0 ;;
esac

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)

kaizen_lib="${script_dir}/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
[ -n "${script_dir}" ] && [ -r "${kaizen_lib}" ] && . "${kaizen_lib}"
# 共通ライブラリを読めない（配布物の欠落・部分展開）ときは、Issue #218 以前の agent 単位の
# 名前だけを扱う縮退版を定義する。ゲートの判定を止めないためのシムであり、複数セッションの
# 分離は失われる（従来どおり奪い合う）が、遮断条件は緩めない。
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
fi

# Hook 入力から command と transcript_path を取り出す。jq が無い／壊れている環境では
# python3、それも無ければ生 JSON の command フィールド判定へ縮退する。
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

# `.kaizen/` は**コミットが実行される作業ツリー**基準で解決する。$CLAUDE_PROJECT_DIR を
# 最優先にすると、セッションの起点がリポジトリ本体で作業が git worktree のとき、ゲートが見る
# `.kaizen/` と抽出したセッションが書く `.kaizen/` が別ディレクトリになる（Issue #218）。
project_root=$(kaizen_resolve_project_root "${payload_cwd}")
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

# 区切り文字（行頭・`;` `&` `|` `(` ・改行）の直後だけでなく、環境変数代入と既知の
# ラッパー（sudo / env / nice 等とその引数）を挟んだ `git commit` も捕捉する。
# 区切りを単なる空白まで広げると `echo "... git commit ..."` や `man git commit` まで
# ブロックしてしまうため、先頭に置ける語を列挙する方式にしている。
wrappers='(sudo|env|command|nohup|nice|time|xargs)'
assign='[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*'
prefix="(${assign}[[:space:]]+)*(${wrappers}[[:space:]]+([^[:space:]]+[[:space:]]+)*)*"
# `git` と `commit` の間に挟まる git のグローバルオプション（`git -C <path> commit`,
# `git --no-pager commit`, `git -c k=v commit` 等）も捕捉する。オプション語とその引数を
# 許す形にとどめ、`git help commit` のような非オプション語では止まるようにする（過剰ブロック回避）。
# 引数消費を許すのは**値を別引数として取るオプションだけ**に限定する。任意のオプションの直後 1 語を
# 飲めるようにすると、引数を取らないオプション（`--no-pager` 等）の後ろのサブコマンドまで消費され、
# その次の語が `commit` にマッチして読み取り専用コマンドを誤ブロックする
# （`git --no-pager grep commit` / `git --no-pager log commit` 等。いずれも実測）。
# 引数は空白を含み得る（`git -C "/tmp/a b" commit`、`git -C /tmp\ a commit`）。非空白の連続だけを
# 引数とみなすとこれらを取りこぼし、ゲートが素通りする（fail open。いずれも実測）。
# 引用・エスケープはクラスごとに継ぎ足すと別クラスが残るため（`"..."` を足すと `\"` で早期に閉じ、
# それを直すと `\ ` が残った）、**シェルの 1 トークン**としてまとめて表す:
#   エスケープ `\<任意>` / シングルクォート塊 / ダブルクォート塊（内部のエスケープ込み） / 素の文字
# の 1 回以上の連結。これで `/tmp/"a b"/c\ d` のような混在も 1 引数として続く。
# 生 JSON へ縮退した経路では引用符が `\"`、エスケープが `\\<文字>` として現れるため、その形も要素に加える。
# シングルクォート内にエスケープは無い（シェルの仕様）ので、そちらは単純な形でよい。
sq=\'
dqbody='([^"\\]|\\.)*'
gitoptval='((\\"'"${dqbody}"'\\"|"'"${dqbody}"'"|'"${sq}[^${sq}]*${sq}"'|\\\\.|\\.|[^[:space:]"'"${sq}"'\\])+)'
# 値を別引数として取る git のグローバルオプション。git(1) の SYNOPSIS ではなく
# **次の引数を実際に消費するか**を実測して選ぶ（`git <opt> <値> version` が version を実行するか）。
# `--exec-path` は SYNOPSIS に `--exec-path[=<path>]` と載るが、値なしで呼ぶと exec-path を出力して
# 即 exit するだけで次の引数を消費しない。ここへ入れると `git --exec-path log commit` の `log` を
# 引数として飲み、次の `commit` にマッチして読み取り専用コマンドを誤ブロックする（実測）。
# `--git-dir=<path>` のような `=` 連結形は空白を含まない 1 語なので、下の `-[^[:space:]]+` 側で拾える。
gitoptval_opt='(-C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--attr-source)'
gitopts="((${gitoptval_opt}[[:space:]]+${gitoptval}|-[^[:space:]]+)[[:space:]]+)*"
if [ "${extracted}" -eq 1 ]; then
	commit_re=$'(^|[;&|(\n])[[:space:]]*'"${prefix}"'git[[:space:]]+'"${gitopts}"'commit([[:space:]]|$)'
else
	cmd=${input}
	# 生 JSON 経路でも区切りの後ろの `git commit` を捕捉する。command の値の先頭だけに錨を打つと
	# `cd /tmp && git commit -m x` のような複合コマンドを取りこぼす（fail open。実測）。
	# 区切りまでの前置きは `dqbody`（`([^"\\]|\\.)*`）で表す。これはエスケープされていない `"` を
	# 跨がないため、走査は command の値の中に閉じる（値の外の別フィールドを拾わない）。
	# JSON では改行が `\n` の 2 文字として現れるので、リテラルの区切り `;&|(` に加えてその形も区切りに含める。
	raw_sep='([;&|(]|\\[nr])'
	commit_re='"command"[[:space:]]*:[[:space:]]*"('"${dqbody}${raw_sep}"')?[[:space:]]*'"${prefix}"'git[[:space:]]+'"${gitopts}"'commit([[:space:]]|"|$)'
fi
if [[ ! "${cmd}" =~ ${commit_re} ]]; then
	exit 0
fi

# lifecycle の不整合はセンチネルの有無にかかわらず commit を止める。
if [ -z "${script_dir}" ] || [ ! -r "${script_dir}/kaizen-status-check.sh" ]; then
	echo "kaizen-precommit-gate: bundled kaizen-status-check.sh is unavailable" >&2
	exit 2
fi
set +e
status_output=$(bash "${script_dir}/kaizen-status-check.sh" 2>&1)
status_rc=$?
set -e
if [ "${status_rc}" -ne 0 ]; then
	printf '%s\n' "${status_output}" >&2
	exit 2
fi

# 案内・コマンドへ載せる値の健全性検査。センチネルの中身は自分のフックが書いたものだが、
# 壊れた値や引用符を含む値をそのまま貼れるコマンドとして出さない。
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
			if [ -n "${s_recorded}" ]; then
				printf '    センチネルが記録した transcript を読めません（移動・削除済み、または値が不正）。\n' >&2
			else
				printf '    transcript の記録がありません（session 単位化より前のセンチネル、または記録に失敗）。\n' >&2
			fi
			printf '    該当セッションの transcript を探し（Claude Code: ~/.claude/projects/**、Codex: ~/.codex/sessions/**）、抽出後に実行してください:\n' >&2
			printf '    bash "%s/kaizen-extract-done.sh" %s <transcript>\n' "${script_dir}" "${opts}" >&2
			recovery_needs_transcript=1
		fi
	done
}

# 未解決センチネル ＝ 対応する抽出完了マーカーが無いセンチネル。センチネルもマーカーも
# session 単位なので、あるセッションの抽出完了が他セッションの未抽出シグナルを覆い隠さない
# （Issue #218）。session 単位化より前の（key を持たない）センチネルは、同じく key を持たない
# マーカーが覆う。
collect_unresolved() {
	unresolved=()
	local sentinel
	for sentinel in .kaizen/.pending-extract*; do
		[ -e "${sentinel}" ] || continue
		[ -f "$(kaizen_done_path "$(kaizen_sentinel_key_of "${sentinel}")")" ] && continue
		unresolved+=("${sentinel}")
	done
}

# 他セッションの未解決センチネルを、そのセンチネルが記録している transcript で差分走査し、
# 候補ゼロを検証できたものだけ解消する。
#
# これが無いと、commit せずに終わったセッションのセンチネルが恒久ブロッカーになり、以後
# どのセッションの commit も人手の抽出なしには通らない（Stop フックは毎ターン立てるため、
# 「一度も commit しなかったセッション」は必ず 1 つ残す）。センチネルは transcript パスと
# session id を持ち、そのセッションの checkpoint も残っているので、ゲートは自分の分と同じ
# 差分走査を他セッション分にも当てられる。**候補が残っているセンチネルはブロックのまま**なので、
# 「学びを取りこぼさない」という保証は緩めず、候補ゼロだった残骸の後片付けだけを自動化する。
#
# 走査時間には上限を置く。打ち切った分は fail closed のまま残し、打ち切った事実を出す
# （黙って諦めると「全部見た上でブロックしている」ように読めてしまう）。
foreign_scan_budget=24
resolve_foreign_sentinels() {
	local sentinel key suffix f_transcript f_agent f_session out rc agent bytes lines line slice started
	for sentinel in "${unresolved[@]}"; do
		[ -e "${sentinel}" ] || continue
		key=$(kaizen_sentinel_key_of "${sentinel}")
		# 自セッション分は上の経路が扱う。key を持たない旧形式は持ち主を特定できず、
		# 記録された transcript も無いのでここでは触らない（従来どおり fail closed）。
		[ -n "${key}" ] || continue
		if [ -n "${session_key}" ] && [ "${key}" = "${session_key}" ]; then
			continue
		fi
		if [ "${foreign_scan_budget}" -le 0 ]; then
			echo "kaizen-precommit-gate: scan budget exhausted; the remaining sentinels were not auto-checked" >&2
			return 0
		fi
		f_transcript=$(sed -n '2p' "${sentinel}" 2>/dev/null || true)
		f_agent=$(sed -n '3p' "${sentinel}" 2>/dev/null || true)
		f_session=$(sed -n '4p' "${sentinel}" 2>/dev/null || true)
		# 走査器が識別できるのは Claude Code / Codex だけ（Copilot は transcript を持たない）。
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
		slice=8
		[ "${foreign_scan_budget}" -lt "${slice}" ] && slice=${foreign_scan_budget}
		started=${SECONDS}
		set +e
		out=$(timeout "${slice}" bash "${script_dir}/kaizen-candidate-scan.sh" "${f_transcript}" "$(kaizen_checkpoint_path "${key}")" 2>&1)
		rc=$?
		set -e
		# 予算は実際に使った秒数だけ減らす（一律 slice を引くと、速い走査の後で残りを不当に削る）。
		foreign_scan_budget=$((foreign_scan_budget - (SECONDS - started)))
		# 契約は自セッション分と同じ。1（検証済みゼロ）以外は触らず、ブロックのまま残す。
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
		# 走査器が名乗る agent がセンチネルの記録と違うなら対象を取り違えている。触らない。
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
	exit 0
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

# transcript_path があり、バンドルされた走査器が読めるときだけ候補ゼロの自動通過を試みる。
# 走査器の契約: 0=候補あり、1=検証済みゼロ、2=不明。timeout(124) を含む 1 以外は安全側。
own_resolved=0
scan_output=""
scan_rc=2
scan_agent=""
scanned_bytes=""
scanned_lines=""
sentinel_suffix=""
if [ "${own_pending}" -eq 1 ] && [ -n "${transcript}" ] && [ -r "${script_dir}/kaizen-candidate-scan.sh" ]; then
	# checkpoint は session 単位。走査位置が transcript ごとに保たれ、別セッションの走査で
	# 上書きされない。session 単位化より前の単一 checkpoint は、それが同じ transcript を
	# 指しているときだけ読み取りに使う（アップグレード直後の全走査を避ける）。書き込みは
	# kaizen-extract-done.sh が session 単位のパスへ行う。
	checkpoint_path=$(kaizen_checkpoint_path "${session_key}")
	if [ ! -e "${checkpoint_path}" ] && [ -r .kaizen/.extract-checkpoint ] &&
		[ "$(sed -n '1p' .kaizen/.extract-checkpoint 2>/dev/null || true)" = "${transcript}" ]; then
		checkpoint_path=.kaizen/.extract-checkpoint
	fi
	set +e
	if command -v timeout >/dev/null 2>&1; then
		scan_output=$(timeout 8 bash "${script_dir}/kaizen-candidate-scan.sh" "${transcript}" "${checkpoint_path}" 2>&1)
		scan_rc=$?
	else
		scan_output="kaizen-precommit-gate: timeout command is unavailable; automatic transcript scan is disabled"
		scan_rc=2
	fi
	set -e
	# 走査器の報告は bash の組み込み照合だけで読む。`sed` の `\|`（BRE の交替）は GNU 拡張で、
	# 持たない実装（BSD / macOS 標準）では agent を取り出せず、候補ゼロでも毎回ブロックへ倒れる。
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
		# 処理済みにしてしまう（fail open）。取れなければ従来どおり fail closed で止める。
		if [[ ! "${scanned_bytes}" =~ ^[0-9]+$ ]] || [[ ! "${scanned_lines}" =~ ^[0-9]+$ ]]; then
			echo "kaizen-precommit-gate: verified-zero scan did not report its scanned position; pending sentinels were preserved" >&2
			exit 2
		fi
		set +e
		# --agent は checkpoint の 3 行目へ記録される。次回、新しいレコードが 1 件も無いとき
		# （＝前回の走査以降に活動が無いとき）に走査器がエージェントを知る唯一の手掛かりになる。
		# --session-id は制御ファイルの session 単位の名前を決める。
		done_output=$(bash "${script_dir}/kaizen-extract-done.sh" --checkpoint-only --sentinel-suffix "${sentinel_suffix}" --agent "${scan_agent}" --session-id "${session_id}" --scanned-bytes "${scanned_bytes}" --scanned-lines "${scanned_lines}" "${transcript}" 2>&1)
		done_rc=$?
		set -e
		if [ "${done_rc}" -ne 0 ]; then
			printf 'kaizen-precommit-gate: failed to advance checkpoint: %s\n' "${done_output}" >&2
			exit 2
		fi
		# session 単位化より前に立てられた（key を持たない）同じ agent のセンチネルは持ち主を
		# 特定できない。いま同じ agent の transcript を候補ゼロで検証できたので、session 単位化
		# 前と同じ判断でこれを失効させる（アップグレード直後の一度きり。現行の Stop フックは
		# key 付きのセンチネルしか作らない）。
		rm -f "$(kaizen_sentinel_path "${sentinel_suffix}" "")"
		collect_unresolved
		if [ "${#unresolved[@]}" -eq 0 ]; then
			exit 0
		fi
		own_resolved=1
	fi
fi

# 自分側がブロック要因でないときだけ、他セッションのセンチネルの自動解消を試す。
# 自分の transcript に候補が出ているならどのみちブロックなので、走査時間を使わない。
if { [ "${own_pending}" -eq 0 ] || [ "${own_resolved}" -eq 1 ]; } && command -v timeout >/dev/null 2>&1 &&
	[ -r "${script_dir}/kaizen-candidate-scan.sh" ]; then
	resolve_foreign_sentinels
	collect_unresolved
	if [ "${#unresolved[@]}" -eq 0 ]; then
		exit 0
	fi
fi

own_blocking=0
if [ "${own_pending}" -eq 1 ] && [ "${own_resolved}" -eq 0 ]; then
	own_blocking=1
fi
{
	if [ "${scan_rc}" -eq 0 ]; then
		echo "kaizen の学び候補が transcript の未処理範囲で検出されました:"
		printf '%s\n' "${scan_output}"
	elif [ "${own_blocking}" -eq 0 ]; then
		# ここへ残るのは、自動走査で候補ゼロを検証できなかった他セッションのセンチネルだけ
		# （検証できたものは既に解消され、この時点では残っていない）。
		echo "他セッションの未抽出センチネルが残っています（自セッション分は解消済み。自動走査でも候補ゼロを確認できませんでした）。"
	else
		echo "未抽出の kaizen 候補を自動判定できませんでした（fail closed）。"
		[ -n "${scan_output}" ] && printf '%s\n' "${scan_output}"
	fi
	if [ "${own_blocking}" -eq 1 ]; then
		echo "kaizen --current を実行し、最重要 1 件を記録してください。"
		echo "コミットの既定クリティカルパスでは apply を後回しにできます。今すぐ適用する場合だけ apply フローまで続けてください。"
	else
		echo "そのセッションの transcript から kaizen --current 相当の抽出を行い、下のコマンドで解消してください。"
	fi
	echo "未解決のセンチネルと、それぞれを解消するコマンド:"
} >&2
print_sentinel_recovery "${unresolved[@]}"
{
	if [ "${recovery_needs_transcript}" -eq 1 ]; then
		# 穴埋めが要るのは `<transcript>` だけ。`--sentinel-suffix` / `--session-id` は
		# **そのセンチネルを立てたセッション**の値であり、自分の値に置き換えてはいけない
		# （置き換えると別名のマーカーが増えるだけで、対象のセンチネルは残りブロックが解けない）。
		echo "上の <transcript> だけを、そのセンチネルを立てたセッションの transcript パスに置き換えてください。"
		echo "--sentinel-suffix / --session-id は表示された値のまま使う（自分のセッションの値に置き換えない）。"
	fi
	echo "その後、git commit を再実行してください。"
} >&2
exit 2
