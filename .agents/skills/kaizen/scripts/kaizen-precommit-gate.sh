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

if [ "${extracted}" -eq 1 ]; then
	commit_re=$'(^|[;&|(\n])[[:space:]]*git[[:space:]]+commit([[:space:]]|$)'
else
	cmd=${input}
	commit_re='"command"[[:space:]]*:[[:space:]]*"[[:space:]]*git[[:space:]]+commit([[:space:]]|"|$)'
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
	scan_agent=$(sed -n 's/^kaizen-candidate-scan: agent=\(claude-code\|codex\)$/\1/p' <<<"${scan_output}")
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
		set +e
		done_output=$(bash "${script_dir}/kaizen-extract-done.sh" --checkpoint-only --sentinel-suffix "${sentinel_suffix}" "${transcript}" 2>&1)
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
		echo "抽出完了時は bash \"${script_dir}/kaizen-extract-done.sh\" --sentinel-suffix \"${sentinel_suffix}\" \"${transcript}\" を別コマンドで実行してください。"
	else
		echo "抽出完了時は対象エージェントに応じた suffix（Claude Code は \"\"、Codex は \"-codex\"、Copilot は \"-copilot\"）を選び、次を別コマンドで実行してください。"
		echo "bash \"${script_dir}/kaizen-extract-done.sh\" --sentinel-suffix \"\" \"${transcript}\""
	fi
	echo "その後、git commit を再実行してください。"
} >&2
exit 2
