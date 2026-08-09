#!/usr/bin/env bash
# Scan the unprocessed portion of an agent transcript for kaizen candidates.
# exit 0: candidates found, exit 1: verified no candidates, exit 2: inconclusive.
set -euo pipefail

transcript=${1:-}
checkpoint=${2:-.kaizen/.extract-checkpoint}

if [ -z "${transcript}" ] || [ ! -r "${transcript}" ]; then
	echo "kaizen-candidate-scan: transcript is missing or unreadable: ${transcript:-<empty>}" >&2
	exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
	echo "kaizen-candidate-scan: jq is required to verify transcript structure" >&2
	exit 2
fi

offset=0
if [ -r "${checkpoint}" ]; then
	checkpoint_path=$(sed -n '1p' "${checkpoint}")
	checkpoint_offset=$(sed -n '2p' "${checkpoint}")
	if [ "${checkpoint_path}" = "${transcript}" ] && [[ "${checkpoint_offset}" =~ ^[0-9]+$ ]]; then
		size=$(wc -c <"${transcript}")
		if [ "${checkpoint_offset}" -le "${size}" ]; then
			offset=${checkpoint_offset}
		fi
	fi
fi

slice=$(mktemp)
records=$(mktemp)
trap 'rm -f "${slice}" "${records}"' EXIT
tail -c "+$((offset + 1))" "${transcript}" >"${slice}"

if ! jq -Rr '
	def clean: tostring | gsub("[\\r\\n\\t]+"; " ") | .[0:500];
	def content_text:
		if type == "string" then .
		elif type == "array" then map(content_text) | join(" ")
		elif type == "object" then ((.text // .content // "") | content_text)
		else "" end;
	(try fromjson catch null) as $j |
	("N\t" + (input_line_number | tostring)),
	(if $j == null then "X"
	elif $j.type == "assistant" then
		"C", "A",
		(($j.message.content // []) | if type == "array" then .[] else empty end |
		 select(type == "object" and .type == "tool_use" and (.name == "Edit" or .name == "Write")) |
		 (.input.file_path // .input.path // empty) | select(type == "string" and length > 0) | "F\t" + .)
	elif $j.type == "user" then
		"C", "R",
		(($j.message.content // "") | content_text | clean | select(length > 0) | "U\t" + .),
		(($j.message.content // []) | if type == "array" then .[] else empty end |
		 select(type == "object" and .type == "tool_result") |
		 ((.content // "") | content_text | clean) as $tool_text |
		 select(((.is_error // false) == true) or ($tool_text | test("^(<tool_use_error>|error:|exit code [1-9]|process exited|timed out)"; "i"))) |
		 "E\t" + $tool_text)
	elif $j.type == "session_meta" then "D", "R"
	elif $j.type == "response_item" and $j.payload.type == "message" then
		"D", "R",
		(if $j.payload.role == "assistant" then "A"
		 elif $j.payload.role == "user" then (($j.payload.content // "") | content_text | clean | select(length > 0) | "U\t" + .)
		 else empty end)
	elif $j.type == "response_item" and $j.payload.type == "custom_tool_call_output" then
		"D", "R",
		(($j.payload.output // "") | content_text | clean |
		 select(test("^(script failed|error:|failed:|exit code [1-9]|process exited|timed out|not found:)"; "i")) | "E\t" + .)
	elif $j.type == "response_item" and ($j.payload.type == "custom_tool_call" or $j.payload.type == "function_call") then
		"D", "R",
		(($j.payload.input // $j.payload.arguments // "") | content_text |
		 scan("\\*\\*\\* (?:Update|Add) File: [^\\r\\n]+") |
		 sub("^\\*\\*\\* (?:Update|Add) File: "; "") | "F\t" + .)
	elif $j.type == "response_item" and $j.payload.type == "function_call_output" then
		"D", "R",
		(($j.payload.output // "") | content_text | clean |
		 select(test("^(script failed|error:|failed:|exit code [1-9]|process exited|timed out|not found:)"; "i")) | "E\t" + .)
	elif $j.type == "response_item" and $j.payload.type == "agent_message" then "D", "A"
	elif $j.type == "response_item" and $j.payload.type == "reasoning" then "D", "R"
	elif $j.type == "event_msg" and $j.payload.type == "user_message" then
		"D", "R", (($j.payload.message // "") | content_text | clean | select(length > 0) | "U\t" + .)
	elif $j.type == "event_msg" and $j.payload.type == "agent_message" then "D", "A"
	elif $j.type == "event_msg" and ($j.payload.type == "turn_aborted" or $j.payload.type == "thread_rolled_back") then
		"D", "R", ("E\t" + (($j.payload.reason // $j.payload.type) | content_text | clean))
	elif $j.type == "event_msg" and $j.payload.type == "patch_apply_end" then
		"D", "R", (if (($j.payload.success // false) == true) then empty else "E\tpatch apply failed" end)
	elif $j.type == "event_msg" and $j.payload.type == "mcp_tool_call_end" then
		"D", "R", (if ($j.payload.result.Err? != null) then "E\t" + ($j.payload.result.Err | content_text | clean) else empty end)
	elif $j.type == "event_msg" and $j.payload.type == "item_completed" then
		"D", "R",
		($j.payload.item as $item |
		 if $item.type == "CommandExecution" then
			if (($item.status // "") == "failed" or (($item.exit_code // 0) != 0)) then
				"E\t" + (($item.formatted_output // $item.stderr // $item.aggregated_output // $item.command // "command failed") | content_text | clean)
			else empty end
		 elif $item.type == "FileChange" then
			(($item.changes // {}) | keys[] | "F\t" + .)
		 elif $item.type == "AgentMessage" then "A"
		 elif $item.type == "UserMessage" then
			(($item.content // "") | content_text | clean | select(length > 0) | "U\t" + .)
		 elif $item.type == "CollabAgentToolCall" then
			(if (($item.status // "completed") == "completed") then empty
			 else "E\t" + (($item.status // "collaboration call failed") | content_text | clean) end)
		 elif ($item.type == "ContextCompaction" or $item.type == "Extension" or
		       $item.type == "Reasoning" or $item.type == "SubAgentActivity") then empty
		 else "X" end)
	elif $j.type == "event_msg" and
	     ($j.payload.type == "context_compacted" or $j.payload.type == "entered_review_mode" or
	      $j.payload.type == "exited_review_mode" or $j.payload.type == "task_complete" or
	      $j.payload.type == "task_started" or
	      $j.payload.type == "thread_settings_applied" or $j.payload.type == "token_count" or
	      $j.payload.type == "web_search_end") then "D", "R"
	elif ($j.type == "compacted" or $j.type == "turn_context" or $j.type == "world_state" or
	      $j.type == "inter_agent_communication_metadata") then "D", "R"
	elif ($j.type == "ai-title" or $j.type == "attachment" or $j.type == "file-history-delta" or
	      $j.type == "file-history-snapshot" or $j.type == "last-prompt" or $j.type == "mode" or
	      $j.type == "permission-mode" or $j.type == "pr-link" or $j.type == "queue-operation" or
	      $j.type == "system" or $j.type == "agent-name" or $j.type == "started") then "R"
	elif $j.type == "result" and $j.agentId? != null and $j.key? != null and $j.result? != null then "R"
	else "X" end)
' "${slice}" >"${records}"; then
	echo "kaizen-candidate-scan: transcript JSONL could not be parsed" >&2
	exit 2
fi

# 候補の根拠は「どこで検出したか」だけを出し、transcript の本文（ユーザー発話・ツール出力・
# 編集先パス）は 1 文字も出さない。ゲートはこの出力を block 理由の stderr へ転送するため、
# 秘密値・社外情報がスクロールバックやログへ漏れる経路を塞ぐ。位置を出すのは、ブロックされた
# エージェントが session directory を手探りせず該当レコードへ直行できるようにするため
#（読むのは自分のセッションの transcript なので、位置さえ分かれば内容は自分で取得できる）。
base_line=0
if [ "${offset}" -gt 0 ]; then
	base_line=$(head -c "${offset}" "${transcript}" | wc -l)
	base_line=${base_line//[[:space:]]/}
fi

recognized=0
invalid=0
saw_claude=0
saw_codex=0
saw_assistant=0
candidate_count=0
record_line=0
edited_paths=""
while IFS= read -r record; do
	case "${record}" in
	N$'\t'*)
		record_line=$((base_line + ${record#*$'\t'}))
		continue
		;;
	X) invalid=1 ;;
	C) saw_claude=1 ;;
	D) saw_codex=1 ;;
	R) recognized=$((recognized + 1)) ;;
	A)
		recognized=$((recognized + 1))
		saw_assistant=1
		;;
	F$'\t'*)
		recognized=$((recognized + 1))
		path=${record#*$'\t'}
		if [ -n "${edited_paths}" ] && grep -Fxq -- "${path}" <<<"${edited_paths}"; then
			if [ "${candidate_count}" -lt 5 ]; then
				printf 'repeated edit: transcript line %s\n' "${record_line}"
			fi
			candidate_count=$((candidate_count + 1))
		else
			edited_paths=${edited_paths:+${edited_paths}$'\n'}${path}
		fi
		;;
	U$'\t'*)
		recognized=$((recognized + 1))
		text=${record#*$'\t'}
		strong_correction=0
		if grep -Eiq '(違う|間違|やり直|そうではなく|ではなく|もう一度|ダメ|(^|[[:space:],.])(wrong|incorrect|try again|not what|instead|redo))' <<<"${text}"; then
			strong_correction=1
		fi
		if [ "${strong_correction}" -eq 1 ] || { [ "${saw_assistant}" -eq 1 ] && grep -Eiq '(修正して|fix that)' <<<"${text}"; }; then
			if [ "${candidate_count}" -lt 5 ]; then
				printf 'user correction: transcript line %s\n' "${record_line}"
			fi
			candidate_count=$((candidate_count + 1))
		fi
		;;
	E$'\t'*)
		recognized=$((recognized + 1))
		text=${record#*$'\t'}
		if [ "${candidate_count}" -lt 5 ]; then
			printf 'tool error: transcript line %s\n' "${record_line}"
		fi
		candidate_count=$((candidate_count + 1))
		;;
	esac
done <"${records}"

if [ "${invalid}" -eq 1 ]; then
	echo "kaizen-candidate-scan: transcript contains an unsupported or malformed record" >&2
	exit 2
fi
if [ "${recognized}" -eq 0 ]; then
	echo "kaizen-candidate-scan: no supported Claude Code or Codex records were found" >&2
	exit 2
fi
if [ "${saw_claude}" -eq 1 ] && [ "${saw_codex}" -eq 1 ]; then
	echo "kaizen-candidate-scan: transcript mixes Claude Code and Codex records" >&2
	exit 2
elif [ "${saw_codex}" -eq 1 ]; then
	agent=codex
elif [ "${saw_claude}" -eq 1 ]; then
	agent=claude-code
else
	echo "kaizen-candidate-scan: transcript agent could not be identified" >&2
	exit 2
fi
echo "kaizen-candidate-scan: agent=${agent}"
if [ "${candidate_count}" -gt 0 ]; then
	echo "kaizen-candidate-scan: ${candidate_count} candidate(s) found"
	exit 0
fi

exit 1
