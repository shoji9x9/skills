#!/usr/bin/env bash
# kaizen pre-commit gate (PreToolUse hook)
#
# 未抽出のセッション活動（.kaizen/.pending-extract* が存在）が残っている間は
# `git commit` をブロックし、エージェントに kaizen --current の実行を促す。
# エージェントが kaizen スキルで抽出を完了するとセンチネルが消え（extract.md
# の手順参照）、再試行した commit が通る。
#
# ブロック方式は exit code 2 + stderr を使う。Claude Code / Codex の PreToolUse
# はどちらも「exit 2 でツール実行をブロックし、stderr をエージェントへ渡す」と
# 明記されており、JSON 出力スキーマの差を避けられて移植性が高い。
#
# PreToolUse フックとして各エージェントに設定する（SKILL.md Step 3 参照）。
set -euo pipefail

input=$(cat)

# 実行されようとしているコマンドを取り出す。PreToolUse の入力スキーマは
# エージェントごとに微妙に異なるため、既知のフィールドを順に試す。jq が無い
# 環境でも誤検知を避けすぎない範囲で動くよう、最後は生の入力にフォールバック。
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // .command // .input.command // empty' 2>/dev/null || true)
if [ -z "$cmd" ]; then
	cmd="$input"
fi

# git commit 以外は素通り（allow）。
case "$cmd" in
*"git commit"*) ;;
*) exit 0 ;;
esac

# 未抽出センチネルが無ければ素通り。
if ! ls .kaizen/.pending-extract* >/dev/null 2>&1; then
	exit 0
fi

# ブロックして、エージェントへ次のアクションを指示する。
echo "未抽出の kaizen 候補があります（.kaizen/.pending-extract*）。コミット前に kaizen スキルで kaizen --current を実行し、学びを抽出・適用してから再度コミットしてください。" >&2
exit 2
