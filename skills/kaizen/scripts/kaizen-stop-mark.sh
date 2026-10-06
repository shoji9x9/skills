#!/usr/bin/env bash
# kaizen stop sentinel mark (Stop / sessionEnd hook)
#
# タスク/セッション終了時に未抽出センチネル `.kaizen/.pending-extract<suffix>.<session key>` を
# 残し、「未抽出の活動がある」ことを記録する。コミット前のチェック（kaizen-precommit-gate.sh）が
# これを検出して `git commit` をブロックし、エージェントに kaizen --current を促す。
#
# 第 1 引数 $1: センチネルのサフィックス（例: -codex / -copilot）。省略時は空（Claude Code 用）。
# stdin: Hook の JSON（`session_id` / `transcript_path` / `cwd`。無くても動く）。
#
# センチネルは **session 単位**にする。agent 単位のままだと、同じプロジェクトで同じ agent の
# セッションを 2 つ動かしたときに、片方の抽出完了が他方の未抽出シグナルを消す。
# session id を取れない環境では、これまでどおり agent 単位の名前を使う（機能が減るだけである）。
#
# センチネルの中身は「1 行に 1 つの値」で、それを解消するための情報を次の順に持たせる。
#   1 行目は UTC タイムスタンプ。以前から唯一の内容だったので、後方互換のため位置を変えない。
#   2 行目は transcript のパス。取れなければ空にする（Copilot は payload に持たない）。
#   3 行目はエージェント名（claude-code / codex / copilot）。
#   4 行目は session id の原文。key ではなく、人が読むためと、案内のコマンドに載せるために使う。
# これが無いと、フラグを立てた本人が戻らないまま別セッションがブロックされたときに、
# どの transcript を抽出すれば解消するのかを機械的に解決できない。
#
# .kaizen/ は他フック（kaizen-precommit-gate.sh / kaizen-context-inject.sh /
# kaizen-archive.sh）と統一してプロジェクトルート基準で解決する。インラインの
# `> .kaizen/.pending-extract` は cwd 相対のため、エージェントがサブディレクトリへ
# cd した状態でターンが終わると迷子センチネルがそこに残り、ルート限定アンカーの
# .gitignore に掛からず誤コミットの恐れがあった。スクリプトで root 基準に統一する。
#
# Stop / sessionEnd フックとして各エージェントに設定する（references/setup.md 参照）。
set -euo pipefail

suffix="${1:-}"

# サフィックスは Hook 設定由来の固定値（-codex / -copilot）だが、スクリプト単体の安全性として
# 許可パターン以外（`/` や `..` を含む値など）は空にフォールバックし、.kaizen/ の外へ書かせない。
if [[ -n "${suffix}" && ! "${suffix}" =~ ^-[a-z0-9-]+$ ]]; then
	suffix=""
fi

case "${suffix}" in
"") agent=claude-code ;;
-codex) agent=codex ;;
-copilot) agent=copilot ;;
*) agent="" ;;
esac

# Hook の JSON を読む。記録役なのでここで止まらないことを優先し、取れなければ空のまま進む。
input=""
if [ ! -t 0 ]; then
	# NUL は通常の Hook JSON に現れないため、read 1 回で EOF まで読み込む。
	IFS= read -r -d '' input || true
fi

kaizen_lib="$(dirname "${BASH_SOURCE[0]}")/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
if [ -r "${kaizen_lib}" ]; then
	. "${kaizen_lib}"
else
	printf '%s: 共通ライブラリを読めないため、機能を減らして動きます: %s\n' "$(basename "${BASH_SOURCE[0]}")" "${kaizen_lib}" >&2
fi

session_id=""
transcript=""
payload_cwd=""
session_key=""
# 共通ライブラリを読めて、Hook JSON を実際に解析できたかどうか。次の「センチネルを立てない」判定は、
# 「transcript_path を解析した結果、値が無かった」場合だけに限る必要がある。
# 配布物の欠落や一部だけの展開でライブラリを読めないとき（呼び出し側は動く前提。冒頭のコメントを参照）、
# `transcript` は解析できずに空のままになる。これは「セッションに transcript が無い」とは別の理由である。
# 区別しないと、機能を減らして動くときに、どのセッションでもセンチネルを立てなくなる。
# 実測で確かめた。有効な transcript_path を含む payload でも、ライブラリが無いとセンチネルがまったく立たなかった。
hook_fields_resolved=0
if declare -f kaizen_hook_fields >/dev/null 2>&1; then
	{
		IFS= read -r session_id
		IFS= read -r transcript
		IFS= read -r payload_cwd
	} <<<"$(kaizen_hook_fields "${input}")" || true
	session_key=$(kaizen_session_key "${session_id}")
	hook_fields_resolved=1
fi

# Claude Code / Codex は Hook payload に transcript_path を必ず持つ（`string | null`）。
# `/compact` 専用の隠しセッションのように、transcript を一度も作らないまま Stop が実行されることがある。
# そのままセンチネルを立てると、コミット前のチェックの案内どおりに解消できず、ずっとブロックし続ける
# （記録された transcript が実在しないので、案内の「探して抽出する」手順を終えられない）。
# transcript の無いセッションには抽出すべき学びも無いので、活動なしとして扱いセンチネルを立てない。
# 判定は存在の確認（`-e`）にとどめ、読めるか（`-r`）では判定しない。読めるかまで見ると、実在していて
# 権限やファイルシステムの状態で一時的に読めないだけの transcript（実際は学びがたまっている）まで「無い」として扱い、
# その未抽出の学びをコミット前のチェックで検出できなくなる。存在していて読めない場合はこれまでどおり
# センチネルを立て、チェック側の「記録はあるが読めない」場合の復旧の案内に任せる。
# また、この判定は Hook JSON を実際に解析できた（`hook_fields_resolved=1`）ときに限る。
# 解析できていなければ「transcript が無い」のか「取れなかっただけ」なのか区別できないので、
# これまでどおりセンチネルを立てる（機能を減らして動くときは、機能が減るだけで誤った結果を出さない、という方針を変えない）。
# Copilot は Hook payload に transcript を持たないのが正常なので対象外にする（これまでどおり立てる）。
case "${agent}" in
claude-code | codex)
	if [ "${hook_fields_resolved}" -eq 1 ]; then
		[ -n "${transcript}" ] && [ -e "${transcript}" ] || exit 0
	fi
	;;
esac

# .kaizen/ をプロジェクトルート基準で解決する。共通ライブラリが読めれば、コミットが実行される
# 作業ツリー（git worktree を含む）を優先する。読めなければ、以前からの方法で決める。
if declare -f kaizen_resolve_project_root >/dev/null 2>&1; then
	project_root=$(kaizen_resolve_project_root "${payload_cwd}")
else
	project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
fi
# cd できなければ現状の cwd で続行する（記録役なのでセッションを止めない）。
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

if declare -f kaizen_sentinel_path >/dev/null 2>&1; then
	sentinel=$(kaizen_sentinel_path "${suffix}" "${session_key}")
else
	sentinel=".kaizen/.pending-extract${suffix}"
fi

mkdir -p .kaizen
printf '%s\n%s\n%s\n%s\n' \
	"$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${transcript}" "${agent}" "${session_id}" >"${sentinel}"
exit 0
