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
# 「使わない方式」参照）。Claude Code は SessionStart の stdout を context に注入する。
# Codex は plain text の stdout を extra developer context として追加する
# (https://learn.chatgpt.com/docs/hooks#sessionstart)。
# Copilot は注入可否がドキュメント上不明確なため、効けば
# 加点・効かなくても無害というベストエフォート。失敗してもセッションを止めない
# よう常に exit 0 で抜ける。
#
# SessionStart フックとして各エージェントに設定する（SKILL.md Step 3 参照）。
set -euo pipefail

# stdin の Hook JSON を先に読む（`source` 判定と、この後の session key / プロジェクトルート解決に使う）。
# stdin が tty の場合（手動実行など JSON が流れない呼び出し）は読み取り自体をスキップする
# （cat が入力待ちでブロックし、タイムアウトで kill されるとマーカー削除ごと行われなくなるのを防ぐ）。
input=""
if [ ! -t 0 ]; then
	input=$(cat 2>/dev/null || true)
fi

kaizen_lib="$(dirname "${BASH_SOURCE[0]}")/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
[ -r "${kaizen_lib}" ] && . "${kaizen_lib}"

session_key=""
payload_cwd=""
if declare -f kaizen_hook_fields >/dev/null 2>&1; then
	{
		IFS= read -r hook_session_id
		IFS= read -r _hook_transcript
		IFS= read -r payload_cwd
	} <<<"$(kaizen_hook_fields "${input}")" || true
	session_key=$(kaizen_session_key "${hook_session_id}")
fi

# .kaizen/ をプロジェクトルート基準で解決する（kaizen-archive.sh / kaizen-precommit-gate.sh と統一）。
# 共通ライブラリが読めれば、コミットが実行される作業ツリー（git worktree を含む）を優先する。
# このフックはベストエフォート（常に exit 0）なので、cd できなくてもセッションを止めず現状の cwd で続行する。
if declare -f kaizen_resolve_project_root >/dev/null 2>&1; then
	project_root=$(kaizen_resolve_project_root "${payload_cwd}")
else
	project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
fi
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

# セッション開始 = 抽出完了マーカーの失効点。**このセッションの**マーカーを削除し、
# このセッションの活動には再びコミット前ゲートが効くようにする。マーカーは checkpoint を
# 記録できなかった抽出だけが書く fail safe（Issue #244）で、それが残っている間はそのセッションの
# commit が素通りするため、セッション境界で必ず失効させる。
# 他セッションのマーカーは消さない——消すと、まだ生きている別セッションが抽出済みの活動で
# 再びブロックされる（Issue #218 の奪い合いの一形態）。
# ただし SessionStart は自動圧縮（source: compact）でも発火し得る。圧縮は同一セッションの
# 継続なので、そのときだけマーカーを残す（消すと、まさに対象の長時間自律ループで commit が
# ゲートに再ブロックされる）。source は stdin の JSON から取り出す。取り出せない・無い場合は
# 削除側（ブロックが増える安全側）に倒す。
if ! printf '%s' "$input" | grep -Eq '"source"[[:space:]]*:[[:space:]]*"compact"'; then
	if declare -f kaizen_done_path >/dev/null 2>&1; then
		rm -f "$(kaizen_done_path "${session_key}")"
	fi
	# session 単位化より前に書かれた（key を持たない）マーカーは、同じく key を持たない
	# センチネルだけを覆う共有マーカー。持ち主を特定できないので従来どおりここで失効させる。
	rm -f .kaizen/.extract-done
fi

# .kaizen/ が無ければ何も出さずに正常終了（初期化前のプロジェクト）。
if [ ! -d .kaizen ]; then
	exit 0
fi

# frontmatter（最初の `---` ブロック）の 1 フィールドを取り出す。
# `sed ... | head -n 1` は使わない——大きなノートでは head が先に閉じて sed が SIGPIPE で死に、
# pipefail 下でスクリプトごと 141 で落ちる（実測: 5.7MB のノートで再現）。awk なら自前で exit
# するのでパイプが要らず、読めないファイルは `|| true` で空文字に倒せる。
# 本文中の `priority:` 等を拾わないよう、走査は frontmatter 内に限る。
frontmatter_field() {
	awk -v key="$2" '
		BEGIN { fm = 0 }
		/^---[[:space:]]*$/ {
			fm++
			if (fm == 2) exit
			next
		}
		fm == 1 && index($0, key ":") == 1 {
			value = substr($0, length(key) + 2)
			sub(/^[[:space:]]+/, "", value)
			sub(/[[:space:]]+$/, "", value)
			print value
			exit
		}
	' "$1" 2>/dev/null || true
}

# pending な学びを priority 降順（high / medium / low / 不明）、同順位は日付昇順に並べる。
# 未定義・未知の priority は既存ノートとの後方互換のため失敗させず末尾へ回す。
# ベストエフォート（常に exit 0）を守るため、一時ファイルの作成・追記・整列が失敗したら
# 注入を諦めて正常終了する。set -e のままだと mktemp 不在・TMPDIR 不正・書き込み失敗で
# SessionStart フックが非 0 終了し、学びの供給という加点機能がセッション開始を汚す。
pending_index=$(mktemp 2>/dev/null) || exit 0
trap 'rm -f "${pending_index}"' EXIT
for f in .kaizen/*.md; do
	[ -e "${f}" ] || continue
	# status も frontmatter 限定で判定する。全文 grep だと本文やコードブロックの
	# `status: pending` を拾い、frontmatter が applied / rejected のノートまで注入してしまう。
	[ "$(frontmatter_field "${f}" status)" = "pending" ] || continue
	priority=$(frontmatter_field "${f}" priority)
	case "${priority}" in
	high) rank=0 ;;
	medium) rank=1 ;;
	low) rank=2 ;;
	*) rank=3 ;;
	esac
	date_value=$(frontmatter_field "${f}" date)
	printf '%s\t%s\t%s\n' "${rank}" "${date_value:-9999-99-99}" "${f}" >>"${pending_index}" || exit 0
done
sort -t $'\t' -k1,1n -k2,2 -k3,3 "${pending_index}" -o "${pending_index}" 2>/dev/null || exit 0

if [ ! -s "${pending_index}" ]; then
	exit 0
fi

# wc の出力は実装によって先頭に空白が入るため数値だけに正規化する。
count=$(wc -l <"${pending_index}")
count=${count//[[:space:]]/}

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
while IFS=$'\t' read -r _rank _date f; do
	[ -n "$f" ] || continue
	# meta も frontmatter 限定にする。全文 grep だと本文の `type:` 等を拾って壊れる。
	meta="date: $(frontmatter_field "$f" date) type: $(frontmatter_field "$f" type) priority: $(frontmatter_field "$f" priority) "
	summary_src=$(first_line_under "## 提案" "$f")
	[ -n "$summary_src" ] || summary_src=$(first_line_under "## 事象" "$f")
	# 先頭の箇条書き記号と「`type: rule`。」のような接頭辞を落として読みやすくする。
	# SC2016: sed の式はバッククォートを含むリテラル正規表現で、シェル展開させない意図のため単一引用符が正しい。
	# shellcheck disable=SC2016
	summary=$(printf '%s' "$summary_src" | sed -E 's/^- +//; s/^`type:[^`]*`。?[[:space:]]*//' || true)
	# 120 文字に切り詰め。`cut -c` は使わない——GNU coreutils ではバイト単位で切るため、
	# 日本語（UTF-8 で 1 文字 3 バイト）だと文字の途中で割れ、壊れたバイト列がそのまま
	# エージェントのコンテキストへ入る（Issue #271。locale を変えても同じ）。
	# bash のパラメータ展開は UTF-8 ロケールでは文字単位なので割れない。
	# 非 UTF-8 ロケールではバイト単位に戻るため、UTF-8 のときだけ切り詰めて安全側に倒す
	# （kaizen-archive.sh の INDEX 生成と同じ方針。python 等の追加ランタイムには依存しない）。
	if locale charmap 2>/dev/null | grep -qi 'utf-\{0,1\}8' && [ "${#summary}" -gt 120 ]; then
		summary="${summary:0:119}…"
	fi
	echo "- \`${f}\` — ${meta}— ${summary}"
done <"${pending_index}"

echo ""
echo "詳細は各ファイルを参照。適用するには kaizen スキルの apply フローを使う。"
exit 0
