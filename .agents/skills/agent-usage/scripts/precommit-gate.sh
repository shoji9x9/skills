#!/usr/bin/env bash
# agent-usage のコミット前の確認（PreToolUse の Hook）。
#
# すべての Bash の呼び出しで起動されうる（Codex の Hook はツール名でしか絞れない）ので、git commit を含まない入力は
# node を起動せずにここで通す。含むときだけ agent-usage.mjs gate に渡す。
# Claude Code では、Hook の定義の if（"Bash(git *)"）でも絞る。if は確実ではないので、ここでも判定する。
#
# 使い方: precommit-gate.sh <claude-code|codex>   （stdin に Hook の JSON）
# 終了コード: 0 = 通す、2 = 止める（理由は stderr）。node が無いときは止めずに通し、その旨を stderr に出す。
set -uo pipefail

agent="${1:-claude-code}"
input=""
if [ ! -t 0 ]; then
	IFS= read -r -d '' input || true
fi

case "${input}" in
*git*commit*) ;;
*'\\\n'*) ;;
*) exit 0 ;;
esac

script_dir=$(CDPATH='' cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)
if [ -z "${script_dir}" ] || [ ! -r "${script_dir}/agent-usage.mjs" ]; then
	echo "agent-usage: 同梱の agent-usage.mjs を読めないので、確認をせずに通します" >&2
	exit 0
fi
if ! command -v node >/dev/null 2>&1; then
	echo "agent-usage: node が無いので、確認をせずに通します" >&2
	exit 0
fi

printf '%s' "${input}" | node "${script_dir}/agent-usage.mjs" gate --agent "${agent}"
rc=${PIPESTATUS[1]}
case "${rc}" in
0 | 2) exit "${rc}" ;;
*)
	echo "agent-usage: 確認の処理が失敗しました（exit ${rc}）。コミットは止めません" >&2
	exit 0
	;;
esac
