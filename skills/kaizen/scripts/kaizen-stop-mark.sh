#!/usr/bin/env bash
# kaizen stop sentinel mark (Stop / sessionEnd hook)
#
# タスク/セッション終了時に未抽出センチネル `.kaizen/.pending-extract<suffix>` を残し、
# 「未抽出の活動がある」ことを記録する。コミット前ゲート（kaizen-precommit-gate.sh）が
# これを検出して `git commit` をブロックし、エージェントに kaizen --current を促す。
#
# 第 1 引数 $1: センチネルのサフィックス（例: -codex / -copilot）。省略時は空（Claude Code 用）。
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

# .kaizen/ をプロジェクトルート基準で解決する。Claude Code は CLAUDE_PROJECT_DIR を
# 設定するため通常 no-op。未設定（Codex/Copilot/手動）なら git ルート、git 外は cwd。
# cd できなければ現状の cwd で続行する（記録役なのでセッションを止めない）。
project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

mkdir -p .kaizen
date -u '+%Y-%m-%dT%H:%M:%SZ' >".kaizen/.pending-extract${suffix}"
exit 0
