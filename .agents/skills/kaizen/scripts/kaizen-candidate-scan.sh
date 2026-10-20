#!/usr/bin/env bash
# Scan the unprocessed portion of an agent transcript for kaizen candidates.
# exit 0: candidates found, exit 1: verified no candidates, exit 2: inconclusive.
#
# 検証済みゼロ（exit 1）のときは、走査を終えた位置を次の形で stdout に出す。
#   kaizen-candidate-scan: scanned-bytes=<走査済みバイト数>
#   kaizen-candidate-scan: scanned-lines=<走査済み行数>
# checkpoint はこの値で進める。呼び出し側が改めて `wc -c` を測ると、走査と記録の間に
# 追記されたレコードをチェックしないまま、処理済みとして扱ってしまう。
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
checkpoint_agent=""
checkpoint_lines=""
if [ -r "${checkpoint}" ]; then
	checkpoint_path=$(sed -n '1p' "${checkpoint}")
	checkpoint_offset=$(sed -n '2p' "${checkpoint}")
	if [ "${checkpoint_path}" = "${transcript}" ] && [[ "${checkpoint_offset}" =~ ^[0-9]+$ ]]; then
		size=$(wc -c <"${transcript}")
		size=${size//[[:space:]]/}
		if [ "${checkpoint_offset}" -le "${size}" ]; then
			offset=${checkpoint_offset}
			# 3 行目は checkpoint を進めた時点で識別済みのエージェント（任意）。
			# 空 slice ではレコードから判定できないため、この確定値だけが手掛かりになる。
			case "$(sed -n '3p' "${checkpoint}")" in
			claude-code | codex) checkpoint_agent=$(sed -n '3p' "${checkpoint}") ;;
			esac
			# 4 行目は処理済み行数（任意）。根拠の絶対行番号の起点で、あれば
			# 処理済み部分を読み直さずに済む。無い旧 checkpoint は下で数え直す。
			checkpoint_lines=$(sed -n '4p' "${checkpoint}")
			[[ "${checkpoint_lines}" =~ ^[0-9]+$ ]] || checkpoint_lines=""
		fi
	fi
fi

# 根拠の絶対行番号の起点。checkpoint が行数を持っていれば読み直さない（走査を O(差分) に保つ）。
base_line=0
if [ "${offset}" -gt 0 ]; then
	if [ -n "${checkpoint_lines}" ]; then
		base_line=${checkpoint_lines}
	else
		# 旧 checkpoint 向けのフォールバック。処理済み部分を 1 度だけ数える。
		base_line=$(head -c "${offset}" "${transcript}" | wc -l)
		base_line=${base_line//[[:space:]]/}
	fi
fi

# 走査した終端を呼び出し側へ返す。checkpoint はこの値で進める。
emit_scanned_position() {
	printf 'kaizen-candidate-scan: scanned-bytes=%s\nkaizen-candidate-scan: scanned-lines=%s\n' "$1" "$2"
}

# 前回の走査以降に新しいレコードが無い場合。レコードが無いので「未知形式」と同じ
# recognized=0 になるが、意味は正反対なので検証済みゼロ（exit 1）として扱う。そうしないと、
# 候補ゼロで自動通過した直後に Stop フックがセンチネルを再装填しただけで次の commit が止まる（実測済み）。
# エージェントは checkpoint に記録された確定値を使う。無い（旧形式）なら従来どおり安全側。
no_new_records() { # $1: 走査済みバイト数 / $2: 走査済み行数
	if [ -n "${checkpoint_agent}" ]; then
		echo "kaizen-candidate-scan: agent=${checkpoint_agent}"
		emit_scanned_position "$1" "$2"
		echo "kaizen-candidate-scan: no new records since checkpoint (offset=${offset})" >&2
		exit 1
	fi
	echo "kaizen-candidate-scan: no new records since checkpoint but the agent is unknown (legacy checkpoint)" >&2
	exit 2
}

# 内部の失敗は必ず exit 2（不明）として扱う。set -e に任せると mktemp の失敗がそのまま
# exit 1 になり、コミット前のチェックからは「検証済みゼロ」に見えてしまう（scan_agent が空に
# なるので止まっているだけで、終了コードの取り決めは守られていない）。
slice=$(mktemp 2>/dev/null) || {
	echo "kaizen-candidate-scan: could not create a temporary file" >&2
	exit 2
}
trap 'rm -f "${slice}" "${records:-}"' EXIT
records=$(mktemp 2>/dev/null) || {
	echo "kaizen-candidate-scan: could not create a temporary file" >&2
	exit 2
}
tail -c "+$((offset + 1))" "${transcript}" >"${slice}" 2>/dev/null || {
	echo "kaizen-candidate-scan: could not read the transcript from the checkpoint offset" >&2
	exit 2
}

# 走査したのは「この slice の終端まで」。呼び出し側が後から wc -c を測り直すと、走査と
# checkpoint の記録の間に追記されたレコードを、チェックしないまま処理済みにしてしまう。
# 行数は「offset より前にある改行の数」で統一する（`kaizen-extract-done.sh` の `wc -l` と同じ定義）。
# 改行で終わらない末尾レコードを 1 行として足すと、後から改行だけが届いたときにその行を
# 二重に数え、以降の根拠行番号が 1 ずつ恒久的にずれる。jq の input_line_number は
# base_line からの相対で数えるので、足さなくても末尾レコードの行番号は正しく出る。
slice_bytes=$(wc -c <"${slice}")
slice_bytes=${slice_bytes//[[:space:]]/}
slice_lines=$(wc -l <"${slice}")
slice_lines=${slice_lines//[[:space:]]/}
scanned_bytes=$((offset + slice_bytes))
scanned_lines=$((base_line + slice_lines))

# checkpoint 以降に 1 バイトも増えていない ＝ 前回の走査以降に新しい活動が無い。
if [ ! -s "${slice}" ]; then
	no_new_records "${offset}" "${base_line}"
fi

if ! jq -Rr '
	def clean: tostring | gsub("[\\r\\n\\t]+"; " ") | .[0:500];
	# Codex は、ユーザー発話でない本文（AGENTS.md・スキルの本文・環境の情報・中断の通知・レビューの結果）も
	# `role: "user"` のメッセージで注入する。実際の transcript に現れた形（閉じた集合）だけを外し、
	# それ以外は発話として扱う（知らない形を警告なしに外さない）。
	def codex_injected:
		test("^(# AGENTS\\.md instructions for |<(skill|user_action|recommended_plugins|turn_aborted|environment_context|codex_internal_context|user_shell_command)[ >\\n])");
	def content_text:
		if type == "string" then .
		elif type == "array" then map(content_text) | join(" ")
		elif type == "object" then ((.text // .content // "") | content_text)
		else "" end;
	# Claude Code は**ツール結果も `role: "user"` のレコード**に載せる。ユーザー発話として扱うのは
	# 文字列の content と `text` 要素だけにし、`tool_result` 要素は除外する。連結してしまうと、
	# ツール出力の本文に含まれる「ではなく」等が修正語として拾われ、実在しない user correction が
	# 候補になって commit が止まる（実測）。同じ分岐の `E`（tool error）抽出が
	# `select(.type == "tool_result")` でレコード種別を絞っているのと対称にする。
	def user_text:
		if type == "string" then .
		elif type == "array" then
			(map(if type == "string" then .
			 elif type == "object" and .type == "text" then (.text // "")
			 else empty end) | join(" "))
		else "" end;
	(try fromjson catch null) as $j |
	("N\t" + (input_line_number | tostring)),
	# レコードの判定で jq が実行時のエラーを出したら、判定できないとして扱う（"X"）。
	# jq は途中の入力のエラーを終了コードに出さず、その行の残りの出力を捨てて次の行へ進む。
	# 包まないと、型が想定と違うレコード（オブジェクトでない JSON・text がオブジェクトの要素など）の本文を
	# 読まないまま、検証済みゼロ（exit 1）を返す。
	(try (if $j == null then (if test("^\\s*$") then "B" else "X" end)
	elif $j.type == "assistant" then
		"C", "A",
		(($j.message.content // []) | if type == "array" then .[] else empty end |
		 select(type == "object" and .type == "tool_use" and (.name == "Edit" or .name == "Write")) |
		 (.input.file_path // .input.path // empty) | select(type == "string" and length > 0) | "F\t" + .)
	# `isMeta: true` の user レコードは、Claude Code がユーザー発話でなく注入した本文（スキルの本文・
	# 別のエージェントからの報告・ローカルコマンドの注記）である。日本語の長い本文が修正語に当たり、
	# 実在しない user correction で commit が止まる（実測）ので、`U` を出さない。`E` の抽出は残す。
	elif $j.type == "user" then
		"C", "R",
		(if ($j.isMeta // false) == true then empty
		 else (($j.message.content // "") | user_text | clean | select(length > 0) | "U\t" + .) end),
		(($j.message.content // []) | if type == "array" then .[] else empty end |
		 select(type == "object" and .type == "tool_result") |
		 ((.content // "") | content_text | clean) as $tool_text |
		 select(((.is_error // false) == true) or ($tool_text | test("^(<tool_use_error>|error:|exit code [1-9]|process exited|timed out)"; "i"))) |
		 "E\t" + $tool_text)
	elif $j.type == "session_meta" then "D", "R"
	# Codex CLI の token_usage_record は会話・ツール結果・編集を運ばない使用量メタデータ。
	# top-level の閉じた既知 type としてだけ許容し、未知の payload 付き type は、下の「判定できない」の扱いに残す。
	elif $j.type == "token_usage_record" then "D", "R"
	elif $j.type == "response_item" and $j.payload.type == "message" then
		"D", "R",
		(if $j.payload.role == "assistant" then "A"
		 elif $j.payload.role == "user" then (($j.payload.content // "") | content_text | select(codex_injected | not) | clean | select(length > 0) | "U\t" + .)
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
		 elif ($item.type == "ContextCompaction" or $item.type == "EnteredReviewMode" or
		       $item.type == "ExitedReviewMode" or $item.type == "Extension" or
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
	# エージェントが作業している間に利用者が送った発話は、`user` レコードにならず、`attachment` の
	# `queued_command`（`commandMode: "prompt"`）として残る。これを読み飛ばすと、作業中に送った修正の指示が
	# 候補から外れる。読み飛ばすのは、発話ではないと分かっている閉じた集合だけにする。
	# 注入した本文の `isMeta`、通知の `commandMode: "task-notification"`、`origin.kind` の
	# `peer`（サブエージェントの報告）・`coordinator`・`task-notification` である。
	# それ以外の `commandMode` と `origin.kind`（欠落を含む）は発話として読む。知らない値で判定不能にすると、
	# その値を書くセッションでは commit がずっと止まり、読み飛ばすと修正の指示を取りこぼすからである。
	# `!` で入力したシェルのコマンドに付く `commandMode` の値は transcript の記録で確かめていないので、
	# 読み飛ばす集合に入れていない。
	# `prompt` が無いものは、読む本文が無いので候補を出さない。
	# 型が違う値（真偽値でない `isMeta`、オブジェクトでない `origin`、文字列でない `commandMode` と
	# `origin.kind`、文字列でも配列でもない `prompt`）は、発話かを決められないので判定できないとして扱う。
	# ただし、読み飛ばす集合に当たるレコードは本文を読まないので、他のフィールドの型は確かめずに読み飛ばす。
	# 真偽値の `isMeta` だけは、集合に当たるかをその値で決めるので、先に型を確かめる。
	elif $j.type == "attachment" and ($j.attachment | type) == "object" and
	     $j.attachment.type == "queued_command" then
		"C", "R",
		($j.attachment as $a |
		 if ([$j.isMeta, $a.isMeta] | any(. != null and type != "boolean")) then "X"
		 elif ($j.isMeta == true or $a.isMeta == true) then empty
		 elif ($a.commandMode == "task-notification" or
		       (($a.origin | type) == "object" and
		        ($a.origin.kind == "peer" or $a.origin.kind == "coordinator" or
		         $a.origin.kind == "task-notification"))) then empty
		 elif $a.origin != null and ($a.origin | type) != "object" then "X"
		 elif ([$a.commandMode, $a.origin.kind] | any(. != null and type != "string")) then "X"
		 elif ($a.prompt != null and ($a.prompt | type) != "string" and ($a.prompt | type) != "array") then "X"
		 else ($a.prompt | user_text | clean | select(length > 0) | "U\t" + .) end)
	elif ($j.type == "ai-title" or $j.type == "attachment" or $j.type == "file-history-delta" or
	      $j.type == "file-history-snapshot" or $j.type == "last-prompt" or $j.type == "mode" or
	      $j.type == "permission-mode" or $j.type == "pr-link" or $j.type == "queue-operation" or
	      $j.type == "system" or $j.type == "agent-name" or $j.type == "started" or
	      $j.type == "atis-latch") then "R"
	elif $j.type == "result" and $j.agentId? != null and $j.key? != null and $j.result? != null then "R"
	# Claude Code の `api-request-blob` は、API に送ったメッセージ（system・user・assistant）を hash ごとに
	# 1 回だけ残すコピーである。本文は、同じセッションの `user` / `assistant` のレコードか、作業中に送った発話の
	# `queued_command`（上の分岐で読む）と重なり、残りはシステムが注入した本文（`<system-reminder>` など）なので、
	# 候補の判定には使わない。コピーを読むと、注入した本文の修正語を拾ったり同じ発話を二重に数えたりして、
	# 実在しない候補が出る。
	# hash が文字列でないものと message がオブジェクトでないものは、知らない形なので下の判定に残す。
	elif $j.type == "api-request-blob" and ($j.hash | type) == "string" and ($j.message | type) == "object" then "C", "R"
	# 未知の `type` は、名前ではなく**構造**で区別する。会話を運ぶ入れ物（`message` / `payload` /
	# `content`）を持たないレコードは候補の判定に関係しないので読み飛ばし、持つものだけ、これまでどおり
	# 判定できないとして扱う。型名を 1 つずつ許可する形にすると、エージェントが内部レコードを 1 種類
	# 増やすたびに「候補ゼロのセッションでも判定できない」となり、ずっとブロックし続ける。
	# 不正な JSON はここに来ない。`fromjson` が失敗した行は、上の `$j == null` で "X" になる。
	# ただし、既知の container（response_item / event_msg）は除く。payload が全部欠けた形は
	# こちらの想定外なので、subtype が欠けた場合と同じく、判定できないとして扱う。
	elif ($j.type | type) == "string" and $j.type != "response_item" and $j.type != "event_msg" and
	     $j.message == null and $j.payload == null and $j.content == null then "R"
	else "X" end) catch ("X\t" + (tostring | gsub("[\\r\\n\\t]+"; " ") | .[0:200])))
' "${slice}" >"${records}"; then
	echo "kaizen-candidate-scan: transcript JSONL could not be parsed" >&2
	exit 2
fi

# 候補の根拠は「どこで検出したか」だけを出し、transcript の本文（ユーザー発話・ツール出力・
# 編集先パス）は 1 文字も出さない。コミット前のチェックはこの出力を block の理由として stderr へ転送するため、
# 秘密の値や社外の情報が、スクロールバックやログに出ないようにする。位置を出すのは、ブロックされた
# エージェントが session directory を手探りせず該当レコードへ直行できるようにするため
#（読むのは自分のセッションの transcript なので、位置さえ分かれば内容は自分で取得できる）。
recognized=0
invalid=0
invalid_line=0
invalid_reason=""
blank=0
saw_claude=0
saw_codex=0
saw_assistant=0
candidate_count=0
record_line=0
# 編集先パスとその編集回数。パスを変数名へ正規化すると異なるパスが衝突しうるため、値としてそのまま保持する。
edited_paths=()
edit_counts=()
while IFS= read -r record; do
	case "${record}" in
	N$'\t'*)
		record_line=$((base_line + ${record#*$'\t'}))
		continue
		;;
	X | X$'\t'*)
		# 利用者が原因の行を探せるように、最初に判定できなかった行と、jq のエラーがあればその本文を残す。
		if [ "${invalid}" -eq 0 ]; then
			invalid_line=${record_line}
			invalid_reason=""
			case "${record}" in
			X$'\t'*) invalid_reason=${record#*$'\t'} ;;
			esac
		fi
		invalid=1
		;;
	B) blank=$((blank + 1)) ;;
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
		# 同一パスを 2 回編集することは Edit の一意性制約で正常に起きうるため、3 回目から候補にする。
		# 配列は任意のパス文字列を値として比較する。レコードごとに外部コマンドを起動しない。
		path_index=""
		for index in "${!edited_paths[@]}"; do
			if [ "${edited_paths[index]}" = "${path}" ]; then
				path_index=${index}
				break
			fi
		done
		if [ -z "${path_index}" ]; then
			path_index=${#edited_paths[@]}
			edited_paths+=("${path}")
			edit_counts+=(1)
		else
			edit_counts[path_index]=$((edit_counts[path_index] + 1))
		fi
		if [ "${edit_counts[path_index]}" -ge 3 ]; then
			if [ "${candidate_count}" -lt 5 ]; then
				printf 'repeated edit: transcript line %s\n' "${record_line}"
			fi
			candidate_count=$((candidate_count + 1))
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
	echo "kaizen-candidate-scan: transcript contains an unsupported or malformed record (first at transcript line ${invalid_line})" >&2
	if [ -n "${invalid_reason}" ]; then
		echo "kaizen-candidate-scan: jq error: ${invalid_reason}" >&2
	fi
	exit 2
fi
if [ "${recognized}" -eq 0 ] && [ "${blank}" -gt 0 ]; then
	# 空行だけが増えていた（前レコードの改行が後から届いた等）。新しい活動は無い。
	no_new_records "${scanned_bytes}" "${scanned_lines}"
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
elif [ -n "${checkpoint_agent}" ]; then
	agent=${checkpoint_agent}
else
	echo "kaizen-candidate-scan: transcript agent could not be identified" >&2
	exit 2
fi
echo "kaizen-candidate-scan: agent=${agent}"
if [ "${candidate_count}" -gt 0 ]; then
	echo "kaizen-candidate-scan: ${candidate_count} candidate(s) found"
	exit 0
fi

emit_scanned_position "${scanned_bytes}" "${scanned_lines}"
exit 1
