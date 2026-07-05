#!/usr/bin/env bash
# kaizen extract-done marker（抽出完了の記録）
#
# 抽出完了時にエージェントが呼び出す: 未抽出センチネル `.kaizen/.pending-extract*` を
# 削除し、抽出完了マーカー `.kaizen/.extract-done`（UTC タイムスタンプ）を書く。
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

mkdir -p .kaizen
rm -f .kaizen/.pending-extract*
date -u '+%Y-%m-%dT%H:%M:%SZ' >".kaizen/.extract-done"
exit 0
