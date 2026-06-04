#!/usr/bin/env bash
# kaizen context inject (SessionStart hook)
#
# セッション開始時に `.kaizen/` の学びダイジェストを stdout に出力し、
# エージェントのコンテキストへ「参照データ」として供給する。これにより
# 各エージェント（Claude Code / Codex / Copilot）が過去の学びを踏まえて
# タスクに着手できる（KEDB 照合の入口）。
#
# これは「kaizen を実行せよ」という行動リマインダーではなく、過去の学びの
# 中身そのものを供給する点が echo リマインダーと異なる（extract.md
# 「使わない方式」参照）。SessionStart の stdout を context に注入できるかは
# エージェントごとに異なる: Claude Code は注入される。Codex / Copilot は
# 注入可否がドキュメント上不明確なため、効けば加点・効かなくても無害という
# ベストエフォート。失敗してもセッションを止めないよう常に exit 0 で抜ける。
#
# SessionStart フックとして各エージェントに設定する（SKILL.md Step 3 参照）。
set -euo pipefail

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

# 各ファイルの date / type / priority と「事象」見出しの要約を 1 行で出す。
# 全文は出さず、参照すべきファイルパスと事象の冒頭 1 行に留める（コンテキスト肥大を避ける）。
printf '%s\n' "$pending_files" | while IFS= read -r f; do
	[ -n "$f" ] || continue
	meta=$(grep -E "^(date|type|priority):" "$f" 2>/dev/null | tr '\n' ' ' || true)
	# 「## 事象」直後の最初の非空行を 1 行要約として併記する（長い場合は 80 字で切り詰め）。
	summary=$(awk '/^## 事象/{f=1; next} f && NF {print; exit}' "$f" 2>/dev/null | cut -c1-80 || true)
	echo "- \`${f}\` — ${meta}— ${summary}"
done

echo ""
echo "詳細は各ファイルを参照。適用するには kaizen スキルの apply フローを使う。"
exit 0
