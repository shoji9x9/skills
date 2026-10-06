#!/usr/bin/env bash
# kaizen 定期実行（scheduled run）の設定解決とレポート生成。
#
# CI（GitHub Actions 等）から週次で呼ばれ、`.kaizen/` の未適用（status: pending）の
# 学びを 1 本の Issue にまとめる。LLM をここでは動かさない——エージェント実行は
# 呼び出し側（workflow）が担い、このスクリプトはその**入力と出力の素材**だけを作る。
#
# 使い方は次のとおりである（プロジェクトルートで実行する。kaizen のスクリプトすべてに共通）。
#   kaizen-schedule-report.sh config   有効な設定を KEY=VALUE で出力する（workflow の判定材料）。
#   kaizen-schedule-report.sh issue    通知 Issue の本文（Markdown）を出力する。
#   kaizen-schedule-report.sh prompt   エージェントへ渡す指示（Markdown）を出力する。
#
# 設定の解決順（上が優先）。**どの層の値を採ったかを stderr に出す**ので、
# 「設定したつもりの値で動いていない」を実行ログから切り分けられる。
#   1. 環境変数 KAIZEN_SCHEDULE_* = 一時的な上書き
#   2. `.kaizen/config` の schedule_* キー = リポジトリの意思（コミットされる）
#   3. 既定値
#
# 同梱のワークフローが第 1 層へ渡すのは、`workflow_dispatch` の入力（mode / agent / model /
# effort）と、リポジトリ変数 `vars.KAIZEN_SCHEDULE_SKIP` だけである。**`inputs.*` は schedule
# イベントでは常に空**なので、定期実行で有効になる上書きは KAIZEN_SCHEDULE_SKIP に限られる。
# mode / agent / model / effort を定期実行にも反映したいなら、`.kaizen/config` に書く
# （リポジトリ変数を増やすと `.kaizen/config` と範囲が重なるので、足していない）。
#
# 不正な値はデフォルトの値として扱い、そう扱ったことを stderr に出す（`.kaizen/config` の既存のキーと同じ方針）。
#
# **定期実行そのものは opt-in**（`schedule_enabled` の既定は off）。有効化するには
# `.kaizen/config` に `schedule_enabled=on` を書く。理由は `DEFAULT_SCHEDULE_ENABLED` の注記。
set -euo pipefail

kaizen_lib="$(dirname "${BASH_SOURCE[0]}")/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
if [ -r "${kaizen_lib}" ]; then
	. "${kaizen_lib}"
else
	printf '%s: 共通ライブラリを読めないため、機能を減らして動きます: %s\n' "$(basename "${BASH_SOURCE[0]}")" "${kaizen_lib}" >&2
fi
# 共通ライブラリを読めないときに、機能を減らして動く処理。**停止スイッチだけは、読めなければ止める側として扱う。**
# mode / agent がデフォルトの値になるのは「動き方が変わる」だけである。しかし `schedule_enabled=off` を
# 読み落とすと、「止めたはずのリポジトリが毎週動く」ことになる（凍結したプロジェクトや、
# レートリミットに近いときに止めるという、この停止スイッチがある理由そのものに反する）。
# 設定ファイルが在るのに読めないときは、ここで止める。**そもそも無い場合は
# ここでは扱わない。** `schedule_enabled` のデフォルトは off（opt-in）なので、下の `resolve_config` が
# 「キーが無い」として止める（「読めない」という理由と重ねないため）。
#
# 「読めない」のは、ライブラリが無いときだけではない。`kaizen_config_value` は設定ファイルを
# 読めないときもキーが無いときも同じ 1 を返すので、**パーミッションなどでファイルそのものを
# 読めない場合も、同じ抜けになる**。どちらも「在るのに読めない」として扱う。
config_unreadable=""
if [ -e .kaizen/config ] && [ ! -r .kaizen/config ]; then
	config_unreadable=".kaizen/config が在るのに読めない（パーミッション等）"
fi
if ! declare -f kaizen_config_value >/dev/null 2>&1; then
	# 機能を減らして動いたことを、必ず出力する（その実行と本番の構成の実行を、出力で区別できるようにする）。
	echo "kaizen-schedule-report: kaizen-hook-common.sh を読めないため .kaizen/config を読めない" >&2
	kaizen_config_value() { return 1; }
	if [ -e .kaizen/config ] && [ -z "${config_unreadable}" ]; then
		config_unreadable=".kaizen/config が在るのに読めない（共通ライブラリの欠落）"
	fi
fi

readonly DEFAULT_MODE=notify
readonly DEFAULT_AGENT=claude
# 定期実行は **opt-in**。`schedule_enabled` を書いていないリポジトリは動かさない。
# 既定を on にすると、テンプレートを `.github/workflows/` へ置いた（あるいは置かれた）
# だけで週次実行が始まり、配布先は「入れた覚えのない定期実行」に驚く。
# 逆極性のキー（`schedule_skip` 等）は足さない——二重の否定になって読み違えやすい。
readonly DEFAULT_SCHEDULE_ENABLED=off

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

# 値を「環境変数 → .kaizen/config → 既定」の順で解決し、採った層を stderr に出す。
# $1: 環境変数名 $2: config キー名 $3: 既定値 $4: 表示名
resolve_value() {
	local env_name=$1 config_key=$2 fallback=$3 label=$4 value
	value=${!env_name-}
	if [ -n "${value}" ]; then
		warn "${label}=${value}（環境変数 ${env_name}）"
		printf '%s' "${value}"
		return 0
	fi
	if value=$(kaizen_config_value "${config_key}") && [ -n "${value}" ]; then
		warn "${label}=${value}（.kaizen/config の ${config_key}）"
		printf '%s' "${value}"
		return 0
	fi
	warn "${label}=${fallback}（既定）"
	printf '%s' "${fallback}"
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

# frontmatter（最初の `---` ブロック）の 1 フィールドを取り出す。
# `sed | head` を使わないのは、kaizen-context-inject.sh と同じ理由である（早く終わる読み手と
# pipefail の組み合わせで、一致しているのに「一致しなかった」と読む形になる）。
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
	local index f priority date_value type_value rank sort_key
	index=$(mktemp)
	[ -d .kaizen ] || {
		printf '%s' "${index}"
		return 0
	}
	for f in .kaizen/*.md; do
		[ -e "${f}" ] || continue
		# status は frontmatter 限定で判定する。全文 grep だと本文やコードブロックの
		# `status: pending` を拾い、決着済みのノートまで未適用として数える。
		[ "$(frontmatter_field "${f}" status)" = "pending" ] || continue
		priority=$(frontmatter_field "${f}" priority)
		case "${priority}" in
		high) rank=0 ;;
		medium) rank=1 ;;
		low) rank=2 ;;
		*) rank=3 ;;
		esac
		date_value=$(frontmatter_field "${f}" date)
		type_value=$(frontmatter_field "${f}" type)
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
	local enabled_raw enabled_source skip_raw mode agent model effort bool_status

	skip="false"
	skip_reason=""

	if [ -n "${config_unreadable}" ]; then
		skip="true"
		skip_reason="${config_unreadable}。停止する側として扱った"
		warn "${skip_reason}"
	fi

	# 一時停止（環境変数 KAIZEN_SCHEDULE_SKIP）とリポジトリの意思（schedule_enabled）は
	# 別の軸。**どちらかが止めれば止まる**——一時停止は上書きではなく追加の安全弁なので、
	# 「環境変数が優先だから schedule_enabled=off を無視する」にはしない。
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

	# **判定点は 1 つだけ。** 「値の決定（どの層から採ったか）」と「その値で止めるか」を分け、
	# 既定値は他の層と同じく `enabled_raw` へ入れてから同じ判定へ通す。
	# 分岐ごとに `skip="true"` を書くと `DEFAULT_SCHEDULE_ENABLED` が実際の既定を決めなくなり、
	# 定数を on にしても挙動は止まったまま**メッセージだけが「既定 on」と嘘をつく**（実測）。
	#
	# 設定ファイルを読めないケースは上で既に停止済みなので、理由を重ねない
	# （「読めない」のに「キーが無い」とは言えない）。
	if [ -z "${config_unreadable}" ]; then
		if enabled_raw=$(kaizen_config_value schedule_enabled) && [ -n "${enabled_raw}" ]; then
			enabled_source=".kaizen/config の schedule_enabled=${enabled_raw}"
			parse_bool "${enabled_raw}" && bool_status=0 || bool_status=$?
			if [ "${bool_status}" = 2 ]; then
				# 不正な値を有効として扱うと、typo した `.kaizen/config` が opt-in の根拠になってしまう。
				warn "schedule_enabled=${enabled_raw} は真偽値として読めない。既定 ${DEFAULT_SCHEDULE_ENABLED} として扱う"
				enabled_source="${enabled_source} を真偽値として読めない（既定 ${DEFAULT_SCHEDULE_ENABLED}）"
				enabled_raw=${DEFAULT_SCHEDULE_ENABLED}
			fi
		else
			# キーが無い＝既定。既定が off なのでここで止まる（opt-in）。
			enabled_raw=${DEFAULT_SCHEDULE_ENABLED}
			enabled_source=".kaizen/config に schedule_enabled=on が無い（定期実行は opt-in）"
		fi
		if ! parse_bool "${enabled_raw}"; then
			skip="true"
			skip_reason="${skip_reason:+${skip_reason} / }${enabled_source}"
		fi
	fi

	mode=$(resolve_value KAIZEN_SCHEDULE_MODE schedule_mode "${DEFAULT_MODE}" mode)
	case "${mode}" in
	notify | agent) ;;
	*)
		warn "mode=${mode} は notify | agent のいずれでもない。既定 ${DEFAULT_MODE} として扱う"
		mode=${DEFAULT_MODE}
		;;
	esac

	agent=$(resolve_value KAIZEN_SCHEDULE_AGENT schedule_agent "${DEFAULT_AGENT}" agent)
	case "${agent}" in
	claude | codex | copilot) ;;
	*)
		warn "agent=${agent} は claude | codex | copilot のいずれでもない。既定 ${DEFAULT_AGENT} として扱う"
		agent=${DEFAULT_AGENT}
		;;
	esac

	model=$(resolve_value KAIZEN_SCHEDULE_MODEL schedule_model "" model)
	if [ -n "${model}" ] && ! [[ "${model}" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$ ]]; then
		warn "model=${model} は識別子として受理できない形。既定（エージェント側の既定モデル）として扱う"
		model=""
	fi

	effort=$(resolve_value KAIZEN_SCHEDULE_EFFORT schedule_effort "" effort)
	if [ -n "${effort}" ] && ! [[ "${effort}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$ ]]; then
		warn "effort=${effort} は識別子として受理できない形。既定として扱う"
		effort=""
	fi
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
	index=$(build_pending_index)
	count=$(wc -l <"${index}")
	count=${count//[[:space:]]/}
	rm -f "${index}"
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
   特に「決定性で選ぶ」——散文（rule / doc）で閉じる対策と、lint / hook / スクリプトなど
   機構へ寄せるべき対策を区別し、機構へ寄せるべきものはそう書く。
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
