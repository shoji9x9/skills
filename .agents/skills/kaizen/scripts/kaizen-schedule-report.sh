#!/usr/bin/env bash
# kaizen 定期実行（scheduled run）の設定解決とレポート生成。
#
# CI（GitHub Actions 等）から週次で呼ばれ、`.kaizen/` の未適用（status: pending）の
# 学びを 1 本の Issue にまとめる。LLM をここでは動かさない。エージェント実行は
# 呼び出し側（workflow）が担い、このスクリプトはその**入力と出力の素材**だけを作る。
#
# 使い方は次のとおりである（プロジェクトルートで実行する。kaizen のスクリプトすべてに共通）。
#   kaizen-schedule-report.sh config   有効な設定を KEY=VALUE で出力する（workflow の判定材料）。
#   kaizen-schedule-report.sh issue    通知 Issue の本文（Markdown）を出力する。
#   kaizen-schedule-report.sh prompt   エージェントへ渡す指示（Markdown）を出力する。
#
# 設定は kaizen の設定ファイル（`.config/skills/shoji9x9/kaizen.jsonc` の schedule_* キー。references/config-files.md）
# から、同梱の読み取りで読む。解決の順序は、環境変数 KAIZEN_SCHEDULE_MODE・AGENT・MODEL・EFFORT（workflow が渡す一時的な上書き）、
# 設定ファイル、スキーマのデフォルトである。**どの層の値を採ったかを stderr に出す**ので、
# 「設定したつもりの値で動いていない」を実行ログから切り分けられる。
#
# 同梱のワークフローが環境変数へ渡すのは、`workflow_dispatch` の入力（mode / agent / model /
# effort）と、リポジトリ変数 `vars.KAIZEN_SCHEDULE_SKIP` だけである。**`inputs.*` は schedule
# イベントでは常に空**なので、定期実行で有効になる上書きは KAIZEN_SCHEDULE_SKIP に限られる。
# mode / agent / model / effort を定期実行にも反映したいなら、kaizen.jsonc に書く
# （リポジトリ変数を増やすと kaizen.jsonc と範囲が重なるので、足していない）。
#
# 不正な値（設定ファイルと環境変数のどちらも）は、デフォルトの値で動かずに exit 1 で止める。
# 定期実行が失敗として記録されるので、設定を直す人が気付ける。
#
# **定期実行そのものは opt-in**（`schedule_enabled` のデフォルトは false）。有効にするには
# kaizen.jsonc に `"schedule_enabled": true` を書く。理由はスキーマの schedule_enabled の注記と、下の resolve_config にある。
set -euo pipefail

kaizen_lib="$(dirname "${BASH_SOURCE[0]}")/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
if [ -r "${kaizen_lib}" ]; then
	. "${kaizen_lib}"
else
	printf '%s: 共通ライブラリを読めないため、機能を減らして動きます: %s\n' "$(basename "${BASH_SOURCE[0]}")" "${kaizen_lib}" >&2
fi
# 共通ライブラリを読めないときは、設定を読めない。**停止スイッチだけは、読めなければ止める側として扱う。**
# mode / agent がデフォルトの値になるのは「動き方が変わる」だけである。しかし `schedule_enabled: false` を
# 読み落とすと、「止めたはずのリポジトリが毎週動く」ことになる（凍結したプロジェクトや、
# レートリミットに近いときに止めるという、この停止スイッチがある理由そのものに反する）。
# schedule_enabled のデフォルトは false なので、読めないときに止めても、設定していないリポジトリの動きは変わらない。
config_unloadable=""
if ! declare -f kaizen_config_load >/dev/null 2>&1; then
	# 機能を減らして動いたことを、必ず出力する（その実行と本番の構成の実行を、出力で区別できるようにする）。
	config_unloadable="kaizen-hook-common.sh を読めないため、kaizen の設定を読めない"
	echo "kaizen-schedule-report: ${config_unloadable}" >&2
	kaizen_config_load() { return 0; }
	kaizen_config_value() { return 1; }
	kaizen_config_source() { return 1; }
fi

# Issue 本文に載せる表の最大行数と、1 行の要約の最大文字数。
# GitHub の Issue 本文は 65,536 文字が上限で、超えると `gh issue create/edit` が失敗し、
# その週のレポートが 1 件も届かない。
#
# **予算はコメントで宣言するだけでなく実装で強制する。** 要約を切らずに「1 行およそ
# 400 文字」と書いていた版は、実データで既に 439 文字の行を出していた（実測）。
# 1 行 = 要約 120 + パス・優先度・種別・記録日・区切り およそ 150 で 270 文字、
# 60 行で 16,200 文字。切った分は、件数と参照先を明示する
# （警告なしに省くと「表に無い＝存在しない」と読まれる）。
readonly MAX_TABLE_ROWS=60
readonly MAX_SUMMARY_CHARS=120

warn() { echo "kaizen-schedule-report: $*" >&2; }

# 要約の切り詰めは文字単位で行う必要があるため、ロケールを 1 回だけ判定して使い回す
# （`summary_of` はノートごとに呼ばれるので、毎回 `locale` を起動しない）。
# bash のパラメータ展開は UTF-8 ロケールでは文字単位、非 UTF-8 ではバイト単位になる。
# 後者で切ると日本語が文字の途中で割れるので切らず、代わりに警告を出す。
# GitHub Actions のランナーは UTF-8（`C.UTF-8`）なので、CI では常に切り詰める。
# パイプで渡さない。`grep -q` は一致した時点で終わるので、書き手がまだ書き終えていないと
# EPIPE → SIGPIPE でパイプライン全体が 0 以外になり、**UTF-8 なのに UTF-8 でないと読む**。
# `kaizen-context-inject.sh` と同じ仕組みで、repo のチェックもこの形をエラーにする。herestring なら
# 書き手のプロセスが無いので、この問題は起きない。
utf8_locale=0
if grep -qi 'utf-\{0,1\}8' <<<"$(locale charmap 2>/dev/null)"; then
	utf8_locale=1
fi

# キーの値を出力し、採った層を stderr に出す。値が無ければ空を出力する。
# $1: キー名 $2: 表示名
resolve_value() {
	local key=$1 label=$2 value source where
	value=$(kaizen_config_value "${key}") || value=""
	source=$(kaizen_config_source "${key}") || source=""
	case "${source}" in
	env) where="環境変数 KAIZEN_SCHEDULE_$(printf '%s' "${key#schedule_}" | tr '[:lower:]' '[:upper:]')" ;;
	default) where="既定" ;;
	"") where="未設定" ;;
	*) where="kaizen の設定ファイル（${source} の層）の ${key}" ;;
	esac
	warn "${label}=${value}（${where}）"
	printf '%s' "${value}"
}

# 真偽値の解釈。on/true/yes/1 を真、off/false/no/0 を偽とし、それ以外は 2 を返して
# 呼び出し側にデフォルトの値を使わせる。不正な値を警告なしに偽（skip）として扱うと、2 通りの誤りが起きうる。
# 止めたつもりのないリポジトリが警告なしに止まるか、止めたつもりのリポジトリが動く。
parse_bool() {
	case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
	on | true | yes | 1) return 0 ;;
	off | false | no | 0) return 1 ;;
	*) return 2 ;;
	esac
}

# 指定見出し（例「## 提案」）直後の最初の非空行を返す。見出しは前方一致で判定する。
first_line_under() {
	awk -v h="$1" 'index($0, h) == 1 {f = 1; next} f && NF {print; exit}' "$2" 2>/dev/null || true
}

# pending なノートを priority 降順・日付昇順に並べた索引を一時ファイルへ作り、パスを返す。
# 各行は `rank <TAB> sort key <TAB> date <TAB> priority <TAB> type <TAB> path`。
#
# **ソート用のセンチネルと表示値を兼用しない。** 日付が無いノートを末尾へ回すための
# `9999-99-99` をそのまま表示に使うと、Issue の「記録日」列にありもしない日付が出る
# （priority / type は `unknown` になるのに、date だけ誤った値になる）。列を分ける。
build_pending_index() {
	local index f status priority date_value type_value rank sort_key
	# frontmatter の欄は、共通ライブラリの kaizen_frontmatter_values で読む（同梱のスクリプトで読み方を 1 つにする）。
	# 共通ライブラリを読めないときは、どの学びが pending かを判定できないので、0 件と区別できるように止める。
	if ! declare -f kaizen_frontmatter_values >/dev/null 2>&1; then
		echo "kaizen-schedule-report: kaizen-hook-common.sh を読めないため、学びの status を読めない" >&2
		return 1
	fi
	index=$(mktemp)
	[ -d .kaizen ] || {
		printf '%s' "${index}"
		return 0
	}
	for f in .kaizen/*.md; do
		[ -e "${f}" ] || continue
		# status は frontmatter 限定で判定する。全文 grep だと本文やコードブロックの
		# `status: pending` を拾い、決着済みのノートまで未適用として数える。
		{
			IFS= read -r status
			IFS= read -r priority
			IFS= read -r date_value
			IFS= read -r type_value
		} <<<"$(kaizen_frontmatter_values "${f}" status priority date type)" || true
		[ "${status}" = "pending" ] || continue
		case "${priority}" in
		high) rank=0 ;;
		medium) rank=1 ;;
		low) rank=2 ;;
		*) rank=3 ;;
		esac
		sort_key=${date_value:-9999-99-99}
		printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
			"${rank}" "${sort_key}" "${date_value:-unknown}" \
			"${priority:-unknown}" "${type_value:-unknown}" "${f}" \
			>>"${index}"
	done
	sort -t $'\t' -k1,1n -k2,2 -k6,6 "${index}" -o "${index}"
	printf '%s' "${index}"
}

summary_of() {
	local f=$1 summary
	summary=$(first_line_under "## 提案" "${f}")
	[ -n "${summary}" ] || summary=$(first_line_under "## 事象" "${f}")
	# 先頭の箇条書き記号と「`type: rule`。」のような接頭辞を落とす。
	# SC2016: sed の式はシェル展開させないリテラル正規表現なので単一引用符が正しい。
	# shellcheck disable=SC2016
	summary=$(printf '%s' "${summary}" | sed -E 's/^- +//; s/^`type:[^`]*`。?[[:space:]]*//' || true)
	# 表のセルに入れるので `|` と改行を落とす。
	summary=${summary//|/｜}
	# 予算どおりに切り詰める。`cut -c` は使わない。GNU coreutils ではバイト単位で切るので、
	# 日本語が文字の途中で切れる（kaizen-context-inject.sh と同じ理由・同じ方式）。
	# bash のパラメータ展開は UTF-8 ロケールでは文字単位なので、途中で切れない。UTF-8 でなければ
	# バイト単位に戻るので切らず、途中で切れた文字を出さない（CI のランナーは UTF-8）。
	# 長さの判定を先に置き、大半の短い要約ではロケールの判定のためのプロセスを起動しない。
	if [ "${#summary}" -gt "${MAX_SUMMARY_CHARS}" ]; then
		if [ "${utf8_locale}" = 1 ]; then
			summary="${summary:0:$((MAX_SUMMARY_CHARS - 1))}…"
		else
			# 機能を減らして動いたことを必ず出力する。UTF-8 でなければ予算が機能しないので、本文が上限に近づいても
			# 「切ったはず」と読めてしまう（機能を減らして動く実行と本番の構成の実行を、
			# 出力で区別できるようにする、というこのリポジトリの方針）。
			warn "ロケールが UTF-8 でないため要約を切り詰めない（文字が割れるため）: ${f}"
		fi
	fi
	printf '%s' "${summary}"
}

# ---- 設定解決 ----------------------------------------------------------------

resolve_config() {
	local enabled enabled_source skip_raw mode agent model effort bool_status

	skip="false"
	skip_reason=""

	# 設定を読めないとき（不正な値・旧い場所の設定・node が無いのに設定ファイルがある）は止める。
	# 定期実行は CI で動くので、失敗として記録して設定を直してもらう。
	if ! kaizen_config_load; then
		warn "${kaizen_config_error:-}"
		warn "kaizen の設定を読めないので止める（設定を直してから実行し直す）"
		exit 1
	fi
	if [ -n "${config_unloadable}" ]; then
		skip="true"
		skip_reason="${config_unloadable}。停止する側として扱った"
		warn "${skip_reason}"
	fi

	# 一時停止（環境変数 KAIZEN_SCHEDULE_SKIP）とリポジトリの意思（schedule_enabled）は
	# 別の軸。**どちらかが止めれば止まる**。一時停止は上書きではなく追加の安全弁なので、
	# 「環境変数が優先だから schedule_enabled: false を無視する」にはしない。
	skip_raw=${KAIZEN_SCHEDULE_SKIP-}
	if [ -n "${skip_raw}" ]; then
		parse_bool "${skip_raw}" && bool_status=0 || bool_status=$?
		case "${bool_status}" in
		0)
			skip="true"
			# 追記にする。上書きにすると、先に記録した理由（読めないので止めた、など）が
			# step summary からも要約からも消え、停止の実態と表示がずれる。
			skip_reason="${skip_reason:+${skip_reason} / }環境変数 KAIZEN_SCHEDULE_SKIP=${skip_raw}"
			;;
		1) : ;;
		*) warn "KAIZEN_SCHEDULE_SKIP=${skip_raw} は真偽値として読めない。skip しない側として扱う" ;;
		esac
	fi

	# schedule_enabled は、スキーマが真偽値に限り、デフォルトを false にしている（opt-in）。
	# テンプレートを `.github/workflows/` へ置いただけで週次実行が始まると、配布先は「入れた覚えのない定期実行」に驚く。
	# 逆極性のキー（`schedule_skip` 等）は足さない。二重の否定になって読み違えやすい。
	if [ -z "${config_unloadable}" ]; then
		enabled=$(kaizen_config_value schedule_enabled) || enabled=false
		if [ "${enabled}" != true ]; then
			skip="true"
			if [ "$(kaizen_config_source schedule_enabled || true)" = default ]; then
				enabled_source="kaizen.jsonc に \"schedule_enabled\": true が無い（定期実行は opt-in）"
			else
				enabled_source="kaizen の設定ファイルの schedule_enabled が false"
			fi
			skip_reason="${skip_reason:+${skip_reason} / }${enabled_source}"
		fi
	fi

	# 値の形（mode・agent の選択肢、model・effort の識別子の形）は、スキーマが検証している。
	mode=$(resolve_value schedule_mode mode)
	[ -n "${mode}" ] || mode=notify
	agent=$(resolve_value schedule_agent agent)
	[ -n "${agent}" ] || agent=claude
	model=$(resolve_value schedule_model model)
	effort=$(resolve_value schedule_effort effort)
	# effort を受け取るのは codex だけ（openai/codex-action の `effort` 入力）。
	# claude-code-action / Copilot CLI には対応する入力が無いので、警告なしに捨てずに知らせる。
	if [ -n "${effort}" ] && [ "${agent}" != "codex" ]; then
		warn "effort=${effort} は agent=${agent} では渡す先が無いので無視する（対応は codex のみ）"
		effort=""
	fi

	resolved_mode=${mode}
	resolved_agent=${agent}
	resolved_model=${model}
	resolved_effort=${effort}
}

# ---- 出力 --------------------------------------------------------------------

cmd_config() {
	local index count
	resolve_config
	if [ -n "${config_unloadable}" ]; then
		# 共通ライブラリを読めないときは、学びの status を読めないので pending を数えられない。
		# このときは設定も読めず、停止する側として扱っている（skip=true）ので、件数は使われない。
		# workflow は pending_count を 10 進の件数として読むので、0 を書く。
		count=0
	else
		index=$(build_pending_index)
		count=$(wc -l <"${index}")
		count=${count//[[:space:]]/}
		rm -f "${index}"
	fi
	# pending が 0 件なら、エージェントを起動しても読む材料が無い。起動する前に notify に切り替える。
	if [ "${count}" -eq 0 ] && [ "${resolved_mode}" = agent ]; then
		warn "pending が 0 件なので mode=agent を notify に切り替える（エージェントへ渡す材料が無い）"
		resolved_mode=notify
	fi
	printf 'skip=%s\n' "${skip}"
	printf 'skip_reason=%s\n' "${skip_reason}"
	printf 'mode=%s\n' "${resolved_mode}"
	printf 'agent=%s\n' "${resolved_agent}"
	printf 'model=%s\n' "${resolved_model}"
	printf 'effort=%s\n' "${resolved_effort}"
	printf 'pending_count=%s\n' "${count}"
}

cmd_issue() {
	local index count rank sort_key date_value priority type_value f shown
	resolve_config
	index=$(build_pending_index)
	count=$(wc -l <"${index}")
	count=${count//[[:space:]]/}

	echo "\`.kaizen/\` に未適用（\`status: pending\`）の学びが **${count} 件** あります。"
	echo
	echo "適用するには、このリポジトリを開いたセッションで \`/kaizen apply\` を実行してください。"
	echo "適用せずに終わりにしてよい学びは、閾値（\`forget_after_days\` / \`forget_max_priority\`）に"
	echo "達した時点で自動的に \`status: forgotten\` になります。"
	echo

	if [ "${count}" -eq 0 ]; then
		rm -f "${index}"
		return 0
	fi

	echo "| 優先度 | 種別 | 記録日 | ノート | 提案の要約 |"
	echo "| --- | --- | --- | --- | --- |"
	shown=0
	while IFS=$'\t' read -r rank sort_key date_value priority type_value f; do
		[ -n "${f}" ] || continue
		[ "${shown}" -lt "${MAX_TABLE_ROWS}" ] || break
		# SC2016: 表のセルを囲むバックティックはリテラル。展開させない意図で単一引用符が正しい。
		# shellcheck disable=SC2016
		printf '| %s | %s | %s | `%s` | %s |\n' \
			"${priority}" "${type_value}" "${date_value}" "${f}" "$(summary_of "${f}")"
		shown=$((shown + 1))
	done <"${index}"
	rm -f "${index}"
	if [ "${count}" -gt "${shown}" ]; then
		echo
		echo "> 優先度の高い ${shown} 件だけを載せています（Issue 本文の文字数上限を超えないため）。"
		echo "> 残り $((count - shown)) 件は \`.kaizen/\` を直接参照してください。"
	fi
}

cmd_prompt() {
	local index count f
	resolve_config
	index=$(build_pending_index)
	count=$(wc -l <"${index}")
	count=${count//[[:space:]]/}

	cat <<'EOS'
あなたはこのリポジトリの kaizen（失敗からの学びを成果物へ反映する仕組み）の定期レビュー担当です。
リポジトリはチェックアウト済みで、作業ディレクトリのルートにいます。

## やること

1. `.kaizen/` 配下の未適用（frontmatter が `status: pending`）のノートを読む。対象は末尾に列挙してある。
2. 同じ根本原因・同じ `type`・同じ適用先になるものをグループにまとめる。
3. 各グループについて、**どこへ何を書けば再発を止められるか**を提案する。
   判断基準はスキル本体のガイド `references/apply.md` の「記述先の選び方」に従う。
   置き場はインストール形態で変わるので、次の順に最初に読めたものを使う:
   `.claude/skills/kaizen/references/apply.md` / `.agents/skills/kaizen/references/apply.md` /
   `.github/skills/kaizen/references/apply.md` / `skills/kaizen/references/apply.md`。
   特に「決定性で選ぶ」に従い、散文（rule / doc）で閉じる対策と、lint / hook / スクリプトなど
   機構へ寄せるべき対策を区別し、機構へ寄せるべきものはそう書く。
   機構へ寄せる提案には、同じガイドの「機構を作る前に効果と費用を書く」に従い、効果と費用を添える。
4. 優先して着手すべきグループを上位 3 つまで挙げ、理由を添える。

## 制約

- **リポジトリを変更しない。** 既存ファイルの編集・削除、commit、push、Issue や PR の作成は行わない。
  ただし呼び出し側からレポートの書き出し先ファイルを指定された場合、**そのファイルを作る（上書きする）ことだけ**は例外として行う。
  出力はレポート本文だけで、それは呼び出し側が Issue に転記する。
- ノートに書かれていないことを推測で補わない。読めなかったノートは「読めなかった」と書く。
- 出力は日本語の Markdown。見出しは `##` から始める（`#` は使わない）。
- 各グループの見出しには、対象ノートのパスを列挙する。

## 出力の形

```markdown
## グループ 1: <一文の要約>

- 対象: `.kaizen/xxx.md`, `.kaizen/yyy.md`
- 根本原因: ...
- 提案する適用先: ...（散文 / 機構のどちらに寄せるかを明示する）
- 決定性の判断: ...
- 効果と費用: ...（機構を提案するときだけ。効果は同じ種類の誤りが繰り返されていること、費用は例外・分岐・実行時間）

## 優先順位

1. グループ N — 理由
```

## 未適用の学び
EOS

	if [ "${count}" -eq 0 ]; then
		echo
		echo "（0 件。対象が無いのでその旨だけを報告してください。）"
		rm -f "${index}"
		return 0
	fi

	echo
	while IFS=$'\t' read -r _rank _sort_key _date priority type_value f; do
		[ -n "${f}" ] || continue
		# shellcheck disable=SC2016
		printf -- '- `%s`（priority: %s / type: %s）\n' "${f}" "${priority}" "${type_value}"
	done <"${index}"
	rm -f "${index}"
}

case "${1-}" in
config) cmd_config ;;
issue) cmd_issue ;;
prompt) cmd_prompt ;;
*)
	echo "usage: $(basename "$0") <config|issue|prompt>" >&2
	exit 2
	;;
esac
