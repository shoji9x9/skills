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

# git commit の「実行」だけを対象にする。引数や echo 文字列中に "git commit"
# という substring が含まれるだけのコマンド（例: echo "... git commit ..." や
# grep "git commit"）を誤ってブロックしないよう、行頭または区切り文字
# (; & | () 直後の git commit に限定する。
if ! printf '%s\n' "$cmd" | grep -Eq '(^|[;&|(])[[:space:]]*git[[:space:]]+commit([[:space:]]|$)'; then
	exit 0
fi

# 未抽出センチネルが無ければ素通り。
if ! ls .kaizen/.pending-extract* >/dev/null 2>&1; then
	exit 0
fi

# ブロックして、エージェントへ次のアクションを指示する。
# 注意: センチネル削除と git commit を 1 コマンドにまとめると、PreToolUse は
# 呼び出し全体を実行前に捕捉するため rm が走らずブロックされる。別コマンドに分ける。
{
	echo "未抽出の kaizen 候補があります（.kaizen/.pending-extract*）。"
	echo "kaizen --current を実行して学びを抽出・適用してください（完了時にセンチネルが消えます）。"
	echo "その後、別コマンドで git commit を実行してください。"
	echo "※ センチネル削除と git commit を 1 つのコマンドにまとめると、PreToolUse が呼び出し全体を実行前にブロックして失敗します。"
} >&2
exit 2
