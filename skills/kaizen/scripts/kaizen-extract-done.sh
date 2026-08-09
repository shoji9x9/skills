#!/usr/bin/env bash
# kaizen extract-done marker（抽出完了の記録）
#
# 抽出完了時にエージェントが呼び出す: 対象エージェントの未抽出センチネルを削除し、
# 抽出完了マーカー `.kaizen/.extract-done`（UTC タイムスタンプ）を書く。
# コミット前ゲート（kaizen-precommit-gate.sh）はマーカーがある間、Stop フックによる
# センチネル再装填を無視して commit を通す（ゲートはセッションにつき 1 回だけ抽出を要求する）。
# マーカーはセッション開始時に kaizen-context-inject.sh（SessionStart フック）が削除する。
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
while [ "$#" -gt 0 ]; do
	case "$1" in
	--checkpoint-only)
		mode=checkpoint-only
		shift
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
if [ "${mode}" = "checkpoint-only" ] && [ "${sentinel_suffix_set}" -ne 1 ]; then
	echo "kaizen-extract-done: checkpoint-only requires --sentinel-suffix" >&2
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
	checkpoint_tmp=$(mktemp)
	trap 'rm -f "${checkpoint_tmp}"' EXIT
	{
		printf '%s\n' "${transcript}"
		wc -c <"${transcript}"
	} >"${checkpoint_tmp}"
	mv "${checkpoint_tmp}" .kaizen/.extract-checkpoint
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
