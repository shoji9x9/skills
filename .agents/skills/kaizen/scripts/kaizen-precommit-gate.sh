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

# 実行されようとしているコマンドを取り出す。PreToolUse の入力スキーマはエージェント
# ごとに微妙に異なる（.tool_input.command / .command / .input.command）。
# jq に依存しすぎると、jq が無い・壊れている環境（例: mise の shim が untrusted で
# 失敗する worktree）でコマンドを取り出せず、生 JSON にフォールバックした結果
# `"git commit ...` が区切り文字判定に合致せず素通りしてしまう。これを防ぐため
# jq → python3 → 生 JSON の多段フォールバックにし、どの段でも検出できるようにする。
cmd=""
extracted=0

if command -v jq >/dev/null 2>&1; then
	cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // .command // .input.command // empty' 2>/dev/null || true)
	[ -n "$cmd" ] && extracted=1
fi

if [ "$extracted" -eq 0 ] && command -v python3 >/dev/null 2>&1; then
	cmd=$(printf '%s' "$input" | python3 -c 'import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
for k in ("tool_input", "input"):
    v = d.get(k)
    if isinstance(v, dict) and v.get("command"):
        print(v["command"]); sys.exit(0)
if isinstance(d.get("command"), str):
    print(d["command"]); sys.exit(0)
sys.exit(1)' 2>/dev/null || true)
	[ -n "$cmd" ] && extracted=1
fi

# どちらでも取り出せなければ最後の手段として生入力で判定する。
if [ "$extracted" -eq 0 ]; then
	cmd="$input"
fi

# git commit の「実行」だけを対象にする。引数や echo 文字列中に "git commit" という
# substring が含まれるだけのコマンド（例: echo "... git commit ..." や grep "git commit"）
# を誤ってブロックしないよう、行頭または区切り文字 (; & | () 直後の git commit に限定する。
# 生入力フォールバック時はコマンドが JSON で包まれている。ここでクォート (") を単純に
# 境界扱いすると、エスケープされた文字列（例: echo "git commit"）まで誤検知してしまう。
# これを避けるため、生入力時は「command フィールドの値が git commit で始まる」場合に
# 限定して判定する（`"command":"git commit ..."`）。クリーン抽出時は従来どおり区切り
# 文字の直後を見る。
if [ "$extracted" -eq 1 ]; then
	commit_re='(^|[;&|(])[[:space:]]*git[[:space:]]+commit([[:space:]]|$)'
else
	commit_re='"command"[[:space:]]*:[[:space:]]*"[[:space:]]*git[[:space:]]+commit([[:space:]]|"|$)'
fi

if ! printf '%s\n' "$cmd" | grep -Eq "$commit_re"; then
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
