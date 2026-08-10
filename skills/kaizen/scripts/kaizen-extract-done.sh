#!/usr/bin/env bash
# kaizen extract-done marker（抽出完了の記録）
#
# 既定（抽出完了時にエージェントが呼び出す）: 対象エージェントの未抽出センチネルを削除し、
# 抽出完了マーカー `.kaizen/.extract-done`（UTC タイムスタンプ）を書く。
# コミット前ゲート（kaizen-precommit-gate.sh）はマーカーがある間、Stop フックによる
# センチネル再装填を無視して commit を通す（ゲートはセッションにつき 1 回だけ抽出を要求する）。
# マーカーはセッション開始時に kaizen-context-inject.sh（SessionStart フック）が削除する。
#
# `--checkpoint-only`（ゲートが候補ゼロを検証できたときに呼ぶ）: transcript の処理位置
# `.kaizen/.extract-checkpoint` を走査器が報告した終端（`--scanned-bytes` / `--scanned-lines`。
# どちらも必須）まで進め、対象エージェントのセンチネルだけを削除する。
# **`.extract-done` は書かない**——セッション全体を抽出済みにすると、以降に新しい活動が
# 積まれても同一セッション内の commit が素通りしてしまうため。次の commit では checkpoint
# 以降の未処理範囲だけが再走査される。
#
# インラインの rm / リダイレクトは cwd 相対のため迷子ファイルを生み得る
#（kaizen-stop-mark.sh の注記参照）。このスクリプトでプロジェクトルート基準に統一する。
set -euo pipefail

# .kaizen/ をプロジェクトルート基準で解決する（他の kaizen スクリプトと統一）。
# CLAUDE_PROJECT_DIR 未設定かつ git ルートも解決できない（または cd に失敗する）場合は
# cwd 基準に縮退する（他の kaizen スクリプトと同じ縮退）。ただしこのスクリプトの場合、
# ゲートが見る .kaizen/ と別の場所へマーカーを書くとゲート解除が効かないため、
# 縮退したことを stderr に警告して気づけるようにする（exit 0 のまま続行はする）。
project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
if [ -z "${project_root}" ] || ! cd "${project_root}" 2>/dev/null; then
	echo "kaizen-extract-done: プロジェクトルートを解決できないため cwd（$(pwd)）基準で .kaizen/ に書き込みます" >&2
fi

mode=complete
sentinel_suffix=""
sentinel_suffix_set=0
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
"" | claude-code | codex) ;;
*)
	echo "kaizen-extract-done: invalid agent: ${agent}" >&2
	exit 2
	;;
esac
if [ "${mode}" = "checkpoint-only" ] && [ "${sentinel_suffix_set}" -ne 1 ]; then
	echo "kaizen-extract-done: checkpoint-only requires --sentinel-suffix" >&2
	exit 2
fi
# 走査済み位置はバイト位置と行数が対でしか意味を持たない（片方だけでは checkpoint の
# 2 行目と 4 行目が別の地点を指す）。片方だけの指定は呼び出し側の誤りなので、黙って
# 両方 wc へ縮退させず、モードに依らずここで落とす。
if { [ -n "${scanned_bytes}" ] && [ -z "${scanned_lines}" ]; } ||
	{ [ -z "${scanned_bytes}" ] && [ -n "${scanned_lines}" ]; }; then
	echo "kaizen-extract-done: --scanned-bytes and --scanned-lines must be given together" >&2
	exit 2
fi
# checkpoint-only は「走査器が候補ゼロを検証できた範囲」を記録するためのモード。ここで
# transcript を測り直すと、走査から呼び出しまでの間に追記されたレコードを検査しないまま
# 処理済みにしてしまう（fail open）。走査器が出した終端位置を必須にして塞ぐ。
if [ "${mode}" = "checkpoint-only" ] && { [ -z "${scanned_bytes}" ] || [ -z "${scanned_lines}" ]; }; then
	echo "kaizen-extract-done: checkpoint-only requires --scanned-bytes and --scanned-lines from the scanner" >&2
	exit 2
fi
# 逆向きも塞ぐ。抽出完了（--checkpoint-only なし）は transcript 全体を読んだ後の記録なので、
# 走査器の終端を受け付ける理由が無い。受け付けると checkpoint を任意の位置へ進められ、
# 未走査範囲を飛ばせてしまう（.extract-done と違い checkpoint はセッションをまたいで残る）。
if [ "${mode}" != "checkpoint-only" ] && { [ -n "${scanned_bytes}" ] || [ -n "${scanned_lines}" ]; }; then
	echo "kaizen-extract-done: --scanned-bytes / --scanned-lines require --checkpoint-only" >&2
	exit 2
fi
mkdir -p .kaizen

# PreToolUse が渡した transcript_path を受け取れる場合は、処理済みバイト位置を記録する。
# 次回の候補走査はこの位置より後だけを見る。パスを省略した従来の呼び出しも有効。
if [ "${mode}" = "checkpoint-only" ] && { [ -z "${transcript}" ] || [ ! -r "${transcript}" ]; }; then
	echo "kaizen-extract-done: checkpoint-only requires a readable transcript" >&2
	exit 2
fi
if [ -n "${transcript}" ] && [ -r "${transcript}" ]; then
	# mktemp が無い／失敗する環境でも、この後のセンチネル削除と .extract-done 記録まで
	# 必ず到達させる。ここで set -e に中断されるとゲートを解除する手段が無くなり、
	# commit が永久に止まる（ゲート解除はこのスクリプトだけが行う）。
	checkpoint_tmp=$(mktemp 2>/dev/null) || checkpoint_tmp=".kaizen/.extract-checkpoint.tmp.$$"
	trap 'rm -f "${checkpoint_tmp}"' EXIT
	# checkpoint の様式:
	#   1 行目 transcript パス / 2 行目 バイト位置 / 3 行目 エージェント（空可）/ 4 行目 行数
	# 3 行目は、新しいレコードが 1 件も無いときにレコードから判定できないエージェントを
	# 持ち越すため。4 行目は走査器が根拠の絶対行番号を出すときの起点で、これが無いと
	# 処理済み部分を毎回読み直すことになる（走査は O(差分) に保つ）。
	# 行位置を固定するため、agent が空でも 3 行目は空行として書く。
	# wc の出力は実装によって先頭に空白が入る。数値だけを書かないと読み側の
	# `^[0-9]+$` 検証に落ち、offset が無視されて毎回全走査へ静かに退行する。
	# 走査器から終端位置を渡された場合（checkpoint-only）はそれを使う。抽出完了
	# （--checkpoint-only なし）は transcript 全体を読んだ後なので現在位置を測る。
	# 採用条件にモードを含め、上の引数検査だけに依存しない（検査を後で緩めても穴が開かない）。
	if [ "${mode}" = "checkpoint-only" ] && [ -n "${scanned_bytes}" ] && [ -n "${scanned_lines}" ]; then
		checkpoint_bytes=${scanned_bytes}
		checkpoint_lines=${scanned_lines}
	else
		checkpoint_bytes=$(wc -c <"${transcript}" 2>/dev/null || true)
		checkpoint_bytes=${checkpoint_bytes//[[:space:]]/}
		checkpoint_lines=$(wc -l <"${transcript}" 2>/dev/null || true)
		checkpoint_lines=${checkpoint_lines//[[:space:]]/}
	fi
	checkpoint_written=0
	if [ -n "${checkpoint_bytes}" ] && [ -n "${checkpoint_lines}" ]; then
		if printf '%s\n%s\n%s\n%s\n' "${transcript}" "${checkpoint_bytes}" "${agent}" "${checkpoint_lines}" \
			>"${checkpoint_tmp}" 2>/dev/null &&
			mv "${checkpoint_tmp}" .kaizen/.extract-checkpoint 2>/dev/null; then
			checkpoint_written=1
		fi
	fi
	if [ "${checkpoint_written}" -eq 0 ]; then
		echo "kaizen-extract-done: checkpoint を記録できませんでした（次回は transcript を全走査します）" >&2
		# checkpoint-only は checkpoint を進めること自体が目的。書けないのにセンチネルを
		# 消すと未処理の活動を取りこぼすので、消さずに失敗させてゲートを fail closed に保つ。
		if [ "${mode}" = "checkpoint-only" ]; then
			exit 2
		fi
	fi
fi
if [ "${mode}" = "complete" ]; then
	date -u '+%Y-%m-%dT%H:%M:%SZ' >".kaizen/.extract-done"
fi
if [ "${sentinel_suffix_set}" -eq 1 ]; then
	rm -f ".kaizen/.pending-extract${sentinel_suffix}"
else
	# 引数なしの既存利用は後方互換のため全センチネルを完了扱いにする。
	# マルチエージェント環境では --sentinel-suffix を必ず使う。
	rm -f .kaizen/.pending-extract*
fi
exit 0
