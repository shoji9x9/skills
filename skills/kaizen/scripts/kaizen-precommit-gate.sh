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
project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

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

# 区切り文字（行頭・`;` `&` `|` `(` ・改行）の直後だけでなく、環境変数代入と既知の
# ラッパー（sudo / env / nice 等とその引数）を挟んだ `git commit` も捕捉する。
# 区切りを単なる空白まで広げると `echo "... git commit ..."` や `man git commit` まで
# ブロックしてしまうため、先頭に置ける語を列挙する方式にしている。
wrappers='(sudo|env|command|nohup|nice|time|xargs)'
assign='[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*'
prefix="(${assign}[[:space:]]+)*(${wrappers}[[:space:]]+([^[:space:]]+[[:space:]]+)*)*"
# `git` と `commit` の間に挟まる git のグローバルオプション（`git -C <path> commit`,
# `git --no-pager commit`, `git -c k=v commit` 等）も捕捉する。オプション語とその引数 1 つまでを
# 許す形にとどめ、`git help commit` のような非オプション語では止まるようにする（過剰ブロック回避）。
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
gitopts="(-[^[:space:]]+([[:space:]]+${gitoptval})?[[:space:]]+)*"
if [ "${extracted}" -eq 1 ]; then
	commit_re=$'(^|[;&|(\n])[[:space:]]*'"${prefix}"'git[[:space:]]+'"${gitopts}"'commit([[:space:]]|$)'
else
	cmd=${input}
	commit_re='"command"[[:space:]]*:[[:space:]]*"[[:space:]]*'"${prefix}"'git[[:space:]]+'"${gitopts}"'commit([[:space:]]|"|$)'
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

if ! compgen -G '.kaizen/.pending-extract*' >/dev/null; then
	exit 0
fi
if [ -f .kaizen/.extract-done ]; then
	exit 0
fi

# transcript_path があり、バンドルされた走査器が読めるときだけ候補ゼロの自動通過を試みる。
# 走査器の契約: 0=候補あり、1=検証済みゼロ、2=不明。timeout(124) を含む 1 以外は安全側。
scan_output=""
scan_rc=2
scan_agent=""
scanned_bytes=""
scanned_lines=""
sentinel_suffix=""
if [ -n "${transcript}" ] && [ -r "${script_dir}/kaizen-candidate-scan.sh" ]; then
	set +e
	if command -v timeout >/dev/null 2>&1; then
		scan_output=$(timeout 8 bash "${script_dir}/kaizen-candidate-scan.sh" "${transcript}" .kaizen/.extract-checkpoint 2>&1)
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
		done_output=$(bash "${script_dir}/kaizen-extract-done.sh" --checkpoint-only --sentinel-suffix "${sentinel_suffix}" --agent "${scan_agent}" --scanned-bytes "${scanned_bytes}" --scanned-lines "${scanned_lines}" "${transcript}" 2>&1)
		done_rc=$?
		set -e
		if [ "${done_rc}" -ne 0 ]; then
			printf 'kaizen-precommit-gate: failed to advance checkpoint: %s\n' "${done_output}" >&2
			exit 2
		fi
		if compgen -G '.kaizen/.pending-extract*' >/dev/null; then
			echo "kaizen-precommit-gate: another agent still has an unprocessed pending sentinel; commit remains blocked" >&2
			printf '  %s\n' .kaizen/.pending-extract* >&2
			exit 2
		fi
		exit 0
	fi
fi

{
	if [ "${scan_rc}" -eq 0 ]; then
		echo "kaizen の学び候補が transcript の未処理範囲で検出されました:"
		printf '%s\n' "${scan_output}"
	else
		echo "未抽出の kaizen 候補を自動判定できませんでした（fail closed）。"
		[ -n "${scan_output}" ] && printf '%s\n' "${scan_output}"
	fi
	echo "kaizen --current を実行し、最重要 1 件を記録してください。"
	echo "コミットの既定クリティカルパスでは apply を後回しにできます。今すぐ適用する場合だけ apply フローまで続けてください。"
	if [ -n "${scan_agent}" ]; then
		# --agent を含めないと checkpoint の 3 行目が空のまま進み、次に「新レコード 0 件」に
		# なったとき走査器がエージェントを判定できず fail closed へ落ちる。走査で特定できて
		# いるのだから案内にも含める。
		echo "抽出完了時は bash \"${script_dir}/kaizen-extract-done.sh\" --sentinel-suffix \"${sentinel_suffix}\" --agent \"${scan_agent}\" \"${transcript}\" を別コマンドで実行してください。"
	else
		# 走査でエージェントを特定できなかったので、どれを実行するかは人が選ぶ。単一の例を出すと
		# Codex / Copilot の利用者が Claude Code 用の suffix をそのまま実行し、自分のセンチネルが
		# 消えずに再ブロックへ戻る。3 通りをそのまま貼れる形で並べる。
		echo "抽出完了時は、対象エージェントの行を別コマンドで実行してください。"
		echo "  Claude Code: bash \"${script_dir}/kaizen-extract-done.sh\" --sentinel-suffix \"\" \"${transcript}\""
		echo "  Codex:       bash \"${script_dir}/kaizen-extract-done.sh\" --sentinel-suffix \"-codex\" \"${transcript}\""
		echo "  Copilot:     bash \"${script_dir}/kaizen-extract-done.sh\" --sentinel-suffix \"-copilot\" \"${transcript}\""
	fi
	echo "その後、git commit を再実行してください。"
} >&2
exit 2
