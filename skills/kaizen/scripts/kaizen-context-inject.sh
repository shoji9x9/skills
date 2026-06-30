#!/usr/bin/env bash
# kaizen context inject (SessionStart hook)
#
# セッション開始時に `.kaizen/` の学びダイジェストを stdout に出力し、
# エージェントのコンテキストへ「参照データ」として供給する。これにより
# 各エージェント（Claude Code / Codex / Copilot）が過去の学びを踏まえて
# タスクに着手できる（KEDB 照合の入口）。
#
# これは「kaizen を実行せよ」という行動リマインダーではなく、過去の学びの
# 中身そのものを供給する点が echo リマインダーと異なる（references/extract.md
# 「使わない方式」参照）。SessionStart の stdout を context に注入できるかは
# エージェントごとに異なる: Claude Code は注入される。Codex / Copilot は
# 注入可否がドキュメント上不明確なため、効けば加点・効かなくても無害という
# ベストエフォート。失敗してもセッションを止めないよう常に exit 0 で抜ける。
#
# SessionStart フックとして各エージェントに設定する（SKILL.md Step 3 参照）。
set -euo pipefail

# .kaizen/ をプロジェクトルート基準で解決する（kaizen-archive.sh / kaizen-precommit-gate.sh と統一）。
# Claude Code は CLAUDE_PROJECT_DIR を設定しフックを基本ルート cwd で起動するため通常は no-op だが、
# cwd がサブディレクトリのときの取り違えを防ぐ。未設定なら git ルート、git 外は cwd のまま。
# このフックはベストエフォート（常に exit 0）なので、cd できなくてもセッションを止めず現状の cwd で続行する。
project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

# .kaizen/ が無ければ何も出さずに正常終了（初期化前のプロジェクト）。
if [ ! -d .kaizen ]; then
	exit 0
fi

# pending な学びファイルだけを対象にする（適用済み/却下済みは現在の作業に不要）。
pending_files=$(grep -l "^status: pending" .kaizen/*.md 2>/dev/null || true)
if [ -z "$pending_files" ]; then
	exit 0
fi

count=$(printf '%s\n' "$pending_files" | grep -c . || true)

echo "## kaizen: 未適用の学び（${count} 件）"
echo ""
echo "このプロジェクトには以下の未適用（status: pending）の学びがあります。"
echo "関連する作業では内容を踏まえ、同じ失敗を繰り返さないこと（根本原因分析の KEDB 照合の入口）。"
echo ""

# 指定見出し（例「## 提案」）直後の最初の非空行を返す。見出しは前方一致で判定し、
# 「## 提案（案）」のような派生表記も拾う。
first_line_under() {
	awk -v h="$1" 'index($0, h) == 1 {f = 1; next} f && NF {print; exit}' "$2" 2>/dev/null || true
}

# 各ファイルの date / type / priority と 1 行要約を出す。全文は出さず、参照すべき
# ファイルパスと要約に留める（コンテキスト肥大を避ける）。
# 要約は「## 提案」（＝一般化された行動規律）を優先する。事象（個別事案）の冒頭だけだと
# 過去の特定インシデントとしか結び付かず、別文脈での再発を防ぐトリガーになりにくい。
# 提案が無い古い学びは「## 事象」にフォールバックする。
printf '%s\n' "$pending_files" | while IFS= read -r f; do
	[ -n "$f" ] || continue
	meta=$(grep -E "^(date|type|priority):" "$f" 2>/dev/null | tr '\n' ' ' || true)
	summary_src=$(first_line_under "## 提案" "$f")
	[ -n "$summary_src" ] || summary_src=$(first_line_under "## 事象" "$f")
	# 先頭の箇条書き記号と「`type: rule`。」のような接頭辞を落として読みやすくし、120 字で切り詰める。
	# SC2016: sed の式はバッククォートを含むリテラル正規表現で、シェル展開させない意図のため単一引用符が正しい。
	# shellcheck disable=SC2016
	summary=$(printf '%s' "$summary_src" | sed -E 's/^- +//; s/^`type:[^`]*`。?[[:space:]]*//' | cut -c1-120 || true)
	echo "- \`${f}\` — ${meta}— ${summary}"
done

echo ""
echo "詳細は各ファイルを参照。適用するには kaizen スキルの apply フローを使う。"
exit 0
