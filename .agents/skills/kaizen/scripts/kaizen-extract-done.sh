#!/usr/bin/env bash
# kaizen extract-done marker（抽出完了の記録）
#
# デフォルト（抽出の完了時にエージェントが呼び出す）では、対象のセッションの未抽出センチネルを削除する。
# transcript を渡されていれば、処理位置 `.kaizen/.extract-checkpoint.<session key>` を transcript の
# 現在の終わりまで進める。以降のコミット前のチェック（kaizen-precommit-gate.sh）は、その位置より後の
# 未処理の範囲だけを走査する。1 本の branch で複数回 commit しても、前回の抽出の後にたまった活動を
# 毎回チェックする。
# checkpoint を記録できなかった場合（transcript の指定が無い・読めない・書き込みに失敗した）だけ、
# 抽出完了マーカー `.kaizen/.extract-done.<session key>`（UTC タイムスタンプ）を書き、古い checkpoint は削除する。
# 残すと、チェックがマーカーより checkpoint を優先し、古い起点から同じ候補を再検出して止まり続ける。
# 差分を走査する起点が無いと、commit のたびに全体を走査してずっとブロックし続けるので、
# そのセッションのチェックを解除する安全策である。
# チェックは、そのセッションのマーカーがある間、Stop フックがセンチネルを立て直しても無視して commit を
# 通す。マーカーは、セッションの開始時に kaizen-context-inject.sh（SessionStart フック）が削除する。
#
# `--session-id <id>`: 対象セッション（センチネルを立てた本人。自分自身とは限らない）。
# センチネル・checkpoint・抽出完了マーカーはこの id で決まる key を名前に持つ。省略すると
# session 単位化より前の agent 単位の名前（`.pending-extract<suffix>` 等）を対象にする（後方互換）。
#
# `--checkpoint-only` は、チェックが候補ゼロを確かめられたときに呼ぶ。
# transcript の処理位置 `.kaizen/.extract-checkpoint.<session key>` を、スキャナが報告した終わりの位置
# （`--scanned-bytes` / `--scanned-lines`。どちらも必須）まで進め、対象のセッションのセンチネルだけを削除する。
# **`.extract-done` は書かない。** セッション全体を抽出済みにすると、その後に新しい活動が
# たまっても、同じセッションの commit がチェックなしに通ってしまう。次の commit では、checkpoint
# より後の未処理の範囲だけを走査し直す。
#
# 抽出完了の記録が済んだ後、適用されないまま閾値を過ぎた pending を `status: forgotten` にする
# （同梱の kaizen-forget.sh へ委譲）。ここに置くのは、書き込む瞬間を「リポジトリを
# 変更する意思が確定した時点」に揃えるため——詳細は該当箇所のコメント。
#
# インラインの rm / リダイレクトは cwd 相対のため迷子ファイルを生み得る
#（kaizen-stop-mark.sh の注記参照）。このスクリプトでプロジェクトルート基準に統一する。
set -euo pipefail

# .kaizen/ の場所は、プロジェクトルートを基準に決める（他の kaizen のスクリプトと揃える）。
# CLAUDE_PROJECT_DIR が未設定で git のルートも決められない（または cd に失敗する）場合は、
# cwd を基準にする（他の kaizen のスクリプトと同じく、機能を減らして動く）。ただしこのスクリプトでは、
# チェックが見る .kaizen/ と別の場所にマーカーを書くと、チェックを解除できない。
# そこで、機能を減らして動いたことを stderr に警告し、気づけるようにする（exit 0 のまま続ける）。
# cd する前に決める（BASH_SOURCE は起動時の cwd からの相対パスになりうるため）。
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)
kaizen_lib="$(dirname "${BASH_SOURCE[0]}")/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
if [ -r "${kaizen_lib}" ]; then
	. "${kaizen_lib}"
else
	printf '%s: 共通ライブラリを読めないため、機能を減らして動きます: %s\n' "$(basename "${BASH_SOURCE[0]}")" "${kaizen_lib}" >&2
fi

if declare -f kaizen_resolve_project_root >/dev/null 2>&1; then
	project_root=$(kaizen_resolve_project_root "")
else
	project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
fi
if [ -z "${project_root}" ] || ! cd "${project_root}" 2>/dev/null; then
	echo "kaizen-extract-done: プロジェクトルートを解決できないため cwd（$(pwd)）基準で .kaizen/ に書き込みます" >&2
fi

mode=complete
sentinel_suffix=""
sentinel_suffix_set=0
session_id=""
transcript=""
agent=""
scanned_bytes=""
scanned_lines=""
while [ "$#" -gt 0 ]; do
	case "$1" in
	--checkpoint-only)
		mode=checkpoint-only
		shift
		;;
	--scanned-bytes | --scanned-lines)
		[ "$#" -ge 2 ] || {
			echo "kaizen-extract-done: $1 requires a value" >&2
			exit 2
		}
		[[ "$2" =~ ^[0-9]+$ ]] || {
			echo "kaizen-extract-done: $1 requires a non-negative integer: $2" >&2
			exit 2
		}
		if [ "$1" = "--scanned-bytes" ]; then scanned_bytes=$2; else scanned_lines=$2; fi
		shift 2
		;;
	--sentinel-suffix)
		[ "$#" -ge 2 ] || {
			echo "kaizen-extract-done: --sentinel-suffix requires a value" >&2
			exit 2
		}
		sentinel_suffix=$2
		sentinel_suffix_set=1
		shift 2
		;;
	--session-id)
		[ "$#" -ge 2 ] || {
			echo "kaizen-extract-done: --session-id requires a value" >&2
			exit 2
		}
		session_id=$2
		shift 2
		;;
	--agent)
		[ "$#" -ge 2 ] || {
			echo "kaizen-extract-done: --agent requires a value" >&2
			exit 2
		}
		agent=$2
		shift 2
		;;
	-*)
		echo "kaizen-extract-done: unknown option: $1" >&2
		exit 2
		;;
	*)
		[ -z "${transcript}" ] || {
			echo "kaizen-extract-done: multiple transcript paths were provided" >&2
			exit 2
		}
		transcript=$1
		shift
		;;
	esac
done
if [[ -n "${sentinel_suffix}" && ! "${sentinel_suffix}" =~ ^-[a-z0-9-]+$ ]]; then
	echo "kaizen-extract-done: invalid sentinel suffix: ${sentinel_suffix}" >&2
	exit 2
fi
case "${agent}" in
"" | claude-code | codex | copilot) ;;
*)
	echo "kaizen-extract-done: invalid agent: ${agent}" >&2
	exit 2
	;;
esac
if [ "${mode}" = "checkpoint-only" ] && [ "${sentinel_suffix_set}" -ne 1 ]; then
	echo "kaizen-extract-done: checkpoint-only requires --sentinel-suffix" >&2
	exit 2
fi
# 走査済みの位置は、バイト位置と行数の対でしか意味を持たない（片方だけでは checkpoint の
# 2 行目と 4 行目が別の地点を指す）。片方だけの指定は呼び出し側の誤りなので、警告なしに
# 両方を wc で測り直すことはせず、モードに関わらずここでエラーにする。
if { [ -n "${scanned_bytes}" ] && [ -z "${scanned_lines}" ]; } ||
	{ [ -z "${scanned_bytes}" ] && [ -n "${scanned_lines}" ]; }; then
	echo "kaizen-extract-done: --scanned-bytes and --scanned-lines must be given together" >&2
	exit 2
fi
# checkpoint-only は「スキャナが候補ゼロを確かめられた範囲」を記録するためのモードである。ここで
# transcript を測り直すと、走査から呼び出しまでの間に追記されたレコードを、チェックしないまま
# 処理済みにしてしまう。スキャナが出した終わりの位置を必須にして、これを防ぐ。
if [ "${mode}" = "checkpoint-only" ] && { [ -z "${scanned_bytes}" ] || [ -z "${scanned_lines}" ]; }; then
	echo "kaizen-extract-done: checkpoint-only requires --scanned-bytes and --scanned-lines from the scanner" >&2
	exit 2
fi
# 逆の向きも防ぐ。抽出の完了（--checkpoint-only なし）は transcript 全体を読んだ後の記録なので、
# スキャナの終わりの位置を受け付ける理由が無い。受け付けると checkpoint を任意の位置へ進められ、
# まだ走査していない範囲を飛ばせてしまう（.extract-done と違い、checkpoint はセッションをまたいで残る）。
if [ "${mode}" != "checkpoint-only" ] && { [ -n "${scanned_bytes}" ] || [ -n "${scanned_lines}" ]; }; then
	echo "kaizen-extract-done: --scanned-bytes / --scanned-lines require --checkpoint-only" >&2
	exit 2
fi
# 制御ファイルは session 単位である。session id を渡されない（または共通ライブラリを読めない）場合は、
# session 単位にする前の agent 単位の名前を使う（機能を減らして動く）。この状態で複数のセッションを動かすと
# 以前と同じく奪い合うので、呼び出し側（チェックの案内・references/extract.md）は常に session id を渡す。
session_key=""
if declare -f kaizen_session_key >/dev/null 2>&1; then
	session_key=$(kaizen_session_key "${session_id}")
elif [ -n "${session_id}" ]; then
	echo "kaizen-extract-done: 共通ライブラリを読めないため --session-id を無視し、agent 単位の制御ファイルを対象にします" >&2
fi
if declare -f kaizen_sentinel_path >/dev/null 2>&1; then
	sentinel_path=$(kaizen_sentinel_path "${sentinel_suffix}" "${session_key}")
	checkpoint_path=$(kaizen_checkpoint_path "${session_key}")
	done_path=$(kaizen_done_path "${session_key}")
else
	sentinel_path=".kaizen/.pending-extract${sentinel_suffix}"
	checkpoint_path=".kaizen/.extract-checkpoint"
	done_path=".kaizen/.extract-done"
fi

# 制御ファイルは、**このセッションのものが既に在るツリー**に書く。置き場は作業ディレクトリで
# 決まるので、同じセッションが共有ツリーと git worktree にまたがって続くと、センチネルと
# checkpoint が別のツリーに分かれる。分かれたままだと、チェックは片方しか見つけられず、
# 「抽出済みの範囲を再検出してブロックし続ける」か「未抽出をチェックなしに通す」のどちらかになる。
# 既存の制御ファイルが見つからなければ、これまでどおり自分のツリー（cwd）に書く。
#
# **探す順は checkpoint → 抽出完了マーカー → センチネル**である。センチネルは Stop フックが
# **そのターンの作業ツリー**に立て直すので、置き場が cwd に従って変わる。センチネルを先に見ると
# checkpoint の置き場までそれに合わせて変わり、共有ツリーと worktree に**別々の offset を持つ
# checkpoint が 1 つずつ残る**（実測）。チェックは自分のツリーのものを先に読むので、古い方を
# 読んだ側は、抽出済みの範囲を再検出して止まり続ける。置き場は、セッションをまたいで残り、
# 続けて使う必要がある checkpoint（その次にマーカー）で決める。
control_dir=".kaizen"
if declare -f kaizen_find_control_file >/dev/null 2>&1; then
	control_found=$(kaizen_find_control_file "" "${checkpoint_path#.kaizen/}" 2>/dev/null) ||
		control_found=$(kaizen_find_control_file "" "${done_path#.kaizen/}" 2>/dev/null) ||
		control_found=$(kaizen_find_control_file "" "${sentinel_path#.kaizen/}" 2>/dev/null) ||
		control_found=""
	if [ -n "${control_found}" ]; then
		control_dir=${control_found%/*}
	fi
fi
sentinel_path="${control_dir}/${sentinel_path#.kaizen/}"
checkpoint_path="${control_dir}/${checkpoint_path#.kaizen/}"
done_path="${control_dir}/${done_path#.kaizen/}"

# 制御ファイルを**全作業ツリー**から消す。名前は `.kaizen/` を含まないファイル名で渡す。
# 1 つのツリーだけ消すと、他のツリーに分かれた複製が残り、チェックが誤って判定する。
remove_control_file_everywhere() { # $1: 制御ファイル名
	local name="${1:-}" dir
	[ -n "${name}" ] || return 0
	if declare -f kaizen_worktree_kaizen_dirs >/dev/null 2>&1; then
		while IFS= read -r -d '' dir; do
			rm -f "${dir}/${name}" || true
		done < <(kaizen_worktree_kaizen_dirs "")
	else
		rm -f ".kaizen/${name}" || true
	fi
}

mkdir -p "${control_dir}"

# checkpoint を記録できたか。transcript を渡されない呼び出しでは下のブロックに入らないため、
# `set -u` でエラーにならないように、ここで初期化する（0 のままなら「差分を走査する起点が無い」を意味する）。
checkpoint_written=0

# PreToolUse が渡した transcript_path を受け取れる場合は、処理済みバイト位置を記録する。
# 次回の候補走査はこの位置より後だけを見る。パスを省略した従来の呼び出しも有効。
if [ "${mode}" = "checkpoint-only" ] && { [ -z "${transcript}" ] || [ ! -r "${transcript}" ]; }; then
	echo "kaizen-extract-done: checkpoint-only requires a readable transcript" >&2
	exit 2
fi
if [ -n "${transcript}" ] && [ -r "${transcript}" ]; then
	# mktemp が無い・失敗する環境でも、この後のセンチネルの削除と .extract-done の記録まで
	# 必ず進める。ここで set -e に中断されるとチェックを解除する手段が無くなり、
	# commit がずっと止まる（チェックの解除は、このスクリプトだけが行う）。
	checkpoint_tmp=$(mktemp 2>/dev/null) || checkpoint_tmp="${control_dir}/.extract-checkpoint.tmp.$$"
	trap 'rm -f "${checkpoint_tmp}"' EXIT
	# checkpoint の形式は次のとおりである。
	#   1 行目 transcript パス / 2 行目 バイト位置 / 3 行目 エージェント（空でもよい）/ 4 行目 行数
	# 3 行目は、新しいレコードが 1 件も無いときに、レコードから判定できないエージェントを
	# 引き継ぐためにある。4 行目は、スキャナが根拠の絶対行番号を出すときの起点で、これが無いと
	# 処理済みの部分を毎回読み直すことになる（走査は O(差分) に保つ）。
	# 行の位置を固定するため、agent が空でも 3 行目は空行として書く。
	# wc の出力は、実装によって先頭に空白が入る。数値だけを書かないと読む側の
	# `^[0-9]+$` の検証で不合格になり、offset が無視されて、エラーにならずに毎回全体を走査する形に戻る。
	# スキャナから終わりの位置を渡された場合（checkpoint-only）は、それを使う。抽出の完了
	# （--checkpoint-only なし）は transcript 全体を読んだ後なので、現在の位置を測る。
	# 使うかどうかの条件にモードを含め、上の引数のチェックだけに依存しない（チェックを後で緩めても抜けができない）。
	if [ "${mode}" = "checkpoint-only" ] && [ -n "${scanned_bytes}" ] && [ -n "${scanned_lines}" ]; then
		checkpoint_bytes=${scanned_bytes}
		checkpoint_lines=${scanned_lines}
	else
		checkpoint_bytes=$(wc -c <"${transcript}" 2>/dev/null || true)
		checkpoint_bytes=${checkpoint_bytes//[[:space:]]/}
		checkpoint_lines=$(wc -l <"${transcript}" 2>/dev/null || true)
		checkpoint_lines=${checkpoint_lines//[[:space:]]/}
	fi
	if [ -n "${checkpoint_bytes}" ] && [ -n "${checkpoint_lines}" ]; then
		if printf '%s\n%s\n%s\n%s\n' "${transcript}" "${checkpoint_bytes}" "${agent}" "${checkpoint_lines}" \
			>"${checkpoint_tmp}" 2>/dev/null &&
			mv "${checkpoint_tmp}" "${checkpoint_path}" 2>/dev/null; then
			checkpoint_written=1
		fi
	fi
	if [ "${checkpoint_written}" -eq 0 ]; then
		echo "kaizen-extract-done: checkpoint を記録できませんでした（次回は transcript を全走査します）" >&2
		# checkpoint-only は、checkpoint を進めることそのものが目的である。書けないのにセンチネルを
		# 消すと未処理の活動を取りこぼすので、消さずに失敗させ、チェックが commit を止める状態を保つ。
		if [ "${mode}" = "checkpoint-only" ]; then
			exit 2
		fi
	fi
fi
if [ "${mode}" = "complete" ]; then
	# `.extract-done` は**セッション全体**を抽出済みにする強い印なので、checkpoint を記録できた
	# ときは書かない。書くと、同じセッションの後の commit がチェックなしに通り、1 本の branch で複数回
	# commit する運用では、最初の commit までの活動しか抽出されない。
	# checkpoint があれば、次の commit ではその位置より後の未処理の範囲だけを走査し直す。
	# 候補ゼロなら自動で通り、候補があればブロックされるので、取りこぼしも、ずっと続くブロックも起きない。
	# 逆に、checkpoint を記録できなかった場合（transcript の指定が無い・読めない・書き込みに失敗した）は、
	# 差分を走査する起点が無く、毎回全体を走査して commit のたびにブロックする。
	# そこで、これまでどおりマーカーを書いてチェックを解除する（安全策。セッションの開始時に SessionStart が無効にする）。
	if [ "${checkpoint_written}" -eq 1 ]; then
		# 同じセッションで先に checkpoint 無しの完了があった場合に残る、古いマーカーを無効にする。
		# 残すとチェックが commit をそのまま通し、いま記録した checkpoint より後の活動を取りこぼす。
		remove_control_file_everywhere "${done_path##*/}"
	else
		date -u '+%Y-%m-%dT%H:%M:%SZ' >"${done_path}"
		# 古い checkpoint を残すと、チェックがマーカーより checkpoint を優先し（「checkpoint がある間はマーカーで上書きしない」）、
		# いま抽出したばかりの範囲を古い起点から走査し直して、同じ候補で再びブロックする。
		# 抽出をやり直しても、checkpoint を記録できない限り同じ状態に戻るので、安全策が
		# 機能しないまま commit が止まり続ける。上の警告どおり「次回は全体を走査する」形にするため、
		# マーカーを書けた後に、差分を走査する起点も削除して揃える。
		# **削除はすべての作業ツリーで行う。** 既存のインストールでは、同じ key の checkpoint が
		# 本体と worktree に分かれていることがある（この変更が直そうとしている状態そのもの）。
		# 1 つだけ消すと、残った方をチェックが見つけて、安全策を無効にする（実測）。
		remove_control_file_everywhere "${checkpoint_path##*/}"
	fi
fi
# センチネルの削除は、**リポジトリのすべての作業ツリー**に対して行う。チェックもすべてのツリーを見て止めるので、
# 自分のツリーだけ消すと、別のツリーに残ったセンチネルでブロックが続く。
kaizen_dirs=()
if declare -f kaizen_worktree_kaizen_dirs >/dev/null 2>&1; then
	while IFS= read -r -d '' kaizen_dir; do
		[ -n "${kaizen_dir}" ] || continue
		kaizen_dirs+=("${kaizen_dir}")
	done < <(kaizen_worktree_kaizen_dirs "")
fi
[ "${#kaizen_dirs[@]}" -gt 0 ] || kaizen_dirs=(".kaizen")

removed=0
sentinel_name=${sentinel_path##*/}
for kaizen_dir in "${kaizen_dirs[@]}"; do
	if [ "${sentinel_suffix_set}" -eq 1 ]; then
		targets=("${kaizen_dir}/${sentinel_name}")
	else
		# 引数なしの呼び出しは、後方互換のため、すべてのセンチネルを完了として扱う。他のエージェントや
		# 他のセッションのシグナルまで消すので、マルチエージェントや複数セッションの環境では
		# --sentinel-suffix と --session-id を必ず使う（チェックの案内は常に両方を含める）。
		targets=("${kaizen_dir}"/.pending-extract*)
	fi
	for target in "${targets[@]}"; do
		[ -e "${target}" ] || continue
		rm -f "${target}" || continue
		removed=$((removed + 1))
	done
done

# **空振りを成功と区別する。** `rm -f` は対象が無くても正常終了するため、終了コードでは
# 「解消した」と「解消するものが無かった」が同じ値になる。空振りに気づけないと、
# 抽出したつもりでセンチネルが別の場所に残ったまま進むことになる。
if [ "${removed}" -eq 0 ]; then
	printf 'kaizen-extract-done: 警告: 削除対象のセンチネルがありませんでした（%s を起点に %s 個の .kaizen/ を確認。既に解消済みか、--sentinel-suffix / --session-id が立てた本人と違う可能性があります）\n' \
		"$(pwd)" "${#kaizen_dirs[@]}" >&2
fi

# 適用されないまま古くなった pending を自動で忘却する。
#
# **実行する位置をここに置くのは、書き込む時点を「リポジトリを変更する意思が決まった時点」に
# 揃えるためである。** SessionStart に置くと、リポジトリを変更するつもりのない調査だけのセッションでも
# 追跡しているファイルが書き換わる。しかもその差分は未ステージのまま残るので、clean を確かめる工程
# （`git-worktree` の後片付け、`issue-batch` の収束）がそこで止まる。
# ここは「学びを 1 件記録し終えた直後」で、呼び出し側はこの後 `.kaizen/` を stage して
# commit を実行し直す。忘却の差分も新しいノートと同じ commit に入り、ツリーは clean に戻る。
# 台帳に 1 件足したときに、反対側から 1 件外れるという対称な形にもなる。
#
# **センチネルを解消した後に置く。** 掃引が失敗しても、抽出の完了の記録は済んでいる必要がある
# （ここで止めると、抽出したのにチェックが解除されず、commit がずっとできなくなる）。
# 同じ理由で、失敗はすべて握りつぶし、exit 0 を保つ。
#
# **`complete` に限る。** `--checkpoint-only` は、チェックが `git commit` の PreToolUse で
# 「候補ゼロを確かめられた」ことを記録するために呼ぶもので、学びは 1 件も記録されていない。
# ここで掃引すると、ユーザーが `git add` を済ませた状態の追跡ファイルを書き換えて
# **未ステージの差分を残す**。この実行位置で避けようとした dirty tree そのものになる。
# しかもチェックは出力を変数に取り込んで、0 以外のときしか出さないので、何を忘れたかも伝わらない。
if [ "${mode}" = "complete" ] && [ -n "${script_dir}" ] && [ -r "${script_dir}/kaizen-forget.sh" ]; then
	# **終了コードは握り潰すが、診断は捨てない。** 忘却側は「0 件」と「判定不能・書き込み失敗」を
	# 区別するために stderr へ理由を出す（`今日の日付を〜`、`skip (could not write the note)`）。
	# `2>/dev/null` で捨てると、掃引が恒久的に失敗していても 0 件成功と見分けが付かない。
	forget_stderr=$(mktemp) || forget_stderr=""
	if [ -n "${forget_stderr}" ]; then
		forgotten_notes=$(bash "${script_dir}/kaizen-forget.sh" --auto 2>"${forget_stderr}" || true)
		[ -s "${forget_stderr}" ] && cat "${forget_stderr}" >&2
		rm -f "${forget_stderr}"
	else
		forgotten_notes=$(bash "${script_dir}/kaizen-forget.sh" --auto || true)
	fi
	if [ -n "${forgotten_notes}" ]; then
		# 警告なしに忘れない。何を忘れたかを出しておかないと、注入から消えたことに気づけず、
		# 戻す判断（閾値の調整・status を pending へ戻す）ができない。
		{
			printf 'kaizen-extract-done: 適用されないまま閾値を過ぎた学びを忘却しました（status: forgotten。以降は SessionStart 注入に載りません）:\n'
			while IFS= read -r forgotten_note; do
				[ -n "${forgotten_note}" ] || continue
				printf '  %s\n' "${forgotten_note}"
			done <<<"${forgotten_notes}"
			printf '本文は残るので KEDB 照合では見つかります。再発したら status を pending へ戻してください。\n'
			printf '閾値は .kaizen/config の forget_after_days / forget_max_priority、停止は forget_auto=off です。\n'
		} >&2
	fi
fi

exit 0
