#!/usr/bin/env bash
# kaizen 定期実行（scheduled run）の設定解決とレポート生成。
#
# CI（GitHub Actions 等）から週次で呼ばれ、`.kaizen/` の未適用（status: pending）の
# 学びを 1 本の Issue にまとめる。LLM をここでは動かさない——エージェント実行は
# 呼び出し側（workflow）が担い、このスクリプトはその**入力と出力の素材**だけを作る。
#
# 使い方（プロジェクトルートで実行する。全 kaizen スクリプト共通）:
#   kaizen-schedule-report.sh config   実効設定を KEY=VALUE で出力（workflow の判定材料）
#   kaizen-schedule-report.sh issue    通知 Issue の本文（Markdown）
#   kaizen-schedule-report.sh prompt   エージェントへ渡す指示（Markdown）
#
# 設定の解決順（上が優先）。**どの層の値を採ったかを stderr に出す**ので、
# 「設定したつもりの値で動いていない」を実行ログから切り分けられる。
#   1. 環境変数 KAIZEN_SCHEDULE_* = 一時的な上書き
#   2. `.kaizen/config` の schedule_* キー = リポジトリの意思（コミットされる）
#   3. 既定値
#
# 同梱ワークフローが第 1 層へ流すのは、`workflow_dispatch` の入力（mode / agent / model /
# effort）と、リポジトリ変数 `vars.KAIZEN_SCHEDULE_SKIP` だけ。**`inputs.*` は schedule
# イベントでは常に空**なので、定期実行で効く上書きは KAIZEN_SCHEDULE_SKIP に限られる。
# mode / agent / model / effort を定期実行にも効かせたいなら `.kaizen/config` へ書く
# （リポジトリ変数を増やすと `.kaizen/config` とスコープが重なるため足していない）。
#
# 不正値は既定へ倒し、倒したことを stderr に出す（`.kaizen/config` 既存キーと同じ方針）。
set -euo pipefail

kaizen_lib="$(dirname "${BASH_SOURCE[0]}")/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
if [ -r "${kaizen_lib}" ]; then
	. "${kaizen_lib}"
fi
# 共通ライブラリを読めないときの縮退。**停止スイッチだけは fail-closed に倒す**——
# mode / agent が既定へ倒れるのは「動き方が変わる」だけだが、`schedule_enabled=off` を
# 読み落とすと「止めたはずのリポジトリが毎週動く」側へ倒れる（凍結プロジェクト・
# レートリミット接近時という、この停止スイッチの存在理由そのものを裏切る）。
# 設定ファイルが在るのに読めないときだけ停止し、そもそも無いなら尊重する設定が無いので進む。
#
# 「読めない」経路はライブラリ欠落だけではない。`kaizen_config_value` は設定ファイルを
# 読めないときもキーが無いときも同じ 1 を返すため、**パーミッション等でファイル自体が
# 読めない場合も同じ穴**になる。どちらも「在るのに読めない」として扱う。
config_unreadable=""
if [ -e .kaizen/config ] && [ ! -r .kaizen/config ]; then
	config_unreadable=".kaizen/config が在るのに読めない（パーミッション等）"
fi
if ! declare -f kaizen_config_value >/dev/null 2>&1; then
	# 縮退したことを黙らせない（縮退した run と本番構成の run を出力で区別できるようにする）。
	echo "kaizen-schedule-report: kaizen-hook-common.sh を読めないため .kaizen/config を読めない" >&2
	kaizen_config_value() { return 1; }
	if [ -e .kaizen/config ] && [ -z "${config_unreadable}" ]; then
		config_unreadable=".kaizen/config が在るのに読めない（共通ライブラリの欠落）"
	fi
fi

readonly DEFAULT_MODE=notify
readonly DEFAULT_AGENT=claude

warn() { echo "kaizen-schedule-report: $*" >&2; }

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
# 呼び出し側に既定へ倒させる（不正値を黙って偽＝skip に倒すと、止めたつもりのない
# リポジトリが無言で止まる／止めたつもりのリポジトリが動く、のどちらにも化ける）。
parse_bool() {
	case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
	on | true | yes | 1) return 0 ;;
	off | false | no | 0) return 1 ;;
	*) return 2 ;;
	esac
}

# frontmatter（最初の `---` ブロック）の 1 フィールドを取り出す。
# `sed | head` を使わないのは kaizen-context-inject.sh と同じ理由（早く抜ける読み手 ×
# pipefail で、一致しているのに「一致しなかった」と読む経路ができる）。
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
# 各行は `rank <TAB> date <TAB> priority <TAB> type <TAB> path`。
build_pending_index() {
	local index f priority date_value type_value rank
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
		printf '%s\t%s\t%s\t%s\t%s\n' \
			"${rank}" "${date_value:-9999-99-99}" "${priority:-unknown}" "${type_value:-unknown}" "${f}" \
			>>"${index}"
	done
	sort -t $'\t' -k1,1n -k2,2 -k5,5 "${index}" -o "${index}"
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
	printf '%s' "${summary}"
}

# ---- 設定解決 ----------------------------------------------------------------

resolve_config() {
	local enabled_raw skip_raw mode agent model effort bool_status

	skip="false"
	skip_reason=""

	if [ -n "${config_unreadable}" ]; then
		skip="true"
		skip_reason="${config_unreadable}。停止側へ倒した"
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
			skip_reason="環境変数 KAIZEN_SCHEDULE_SKIP=${skip_raw}"
			;;
		1) : ;;
		*) warn "KAIZEN_SCHEDULE_SKIP=${skip_raw} は真偽値として読めない。skip しない側へ倒す" ;;
		esac
	fi

	if enabled_raw=$(kaizen_config_value schedule_enabled) && [ -n "${enabled_raw}" ]; then
		parse_bool "${enabled_raw}" && bool_status=0 || bool_status=$?
		case "${bool_status}" in
		0) : ;;
		1)
			skip="true"
			skip_reason="${skip_reason:+${skip_reason} / }.kaizen/config の schedule_enabled=${enabled_raw}"
			;;
		*) warn "schedule_enabled=${enabled_raw} は真偽値として読めない。既定 on へ倒す" ;;
		esac
	fi

	mode=$(resolve_value KAIZEN_SCHEDULE_MODE schedule_mode "${DEFAULT_MODE}" mode)
	case "${mode}" in
	notify | agent) ;;
	*)
		warn "mode=${mode} は notify | agent のいずれでもない。既定 ${DEFAULT_MODE} へ倒す"
		mode=${DEFAULT_MODE}
		;;
	esac

	agent=$(resolve_value KAIZEN_SCHEDULE_AGENT schedule_agent "${DEFAULT_AGENT}" agent)
	case "${agent}" in
	claude | codex | copilot) ;;
	*)
		warn "agent=${agent} は claude | codex | copilot のいずれでもない。既定 ${DEFAULT_AGENT} へ倒す"
		agent=${DEFAULT_AGENT}
		;;
	esac

	model=$(resolve_value KAIZEN_SCHEDULE_MODEL schedule_model "" model)
	if [ -n "${model}" ] && ! [[ "${model}" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$ ]]; then
		warn "model=${model} は識別子として受理できない形。既定（エージェント側の既定モデル）へ倒す"
		model=""
	fi

	effort=$(resolve_value KAIZEN_SCHEDULE_EFFORT schedule_effort "" effort)
	if [ -n "${effort}" ] && ! [[ "${effort}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$ ]]; then
		warn "effort=${effort} は識別子として受理できない形。既定へ倒す"
		effort=""
	fi
	# effort を受け取るのは codex だけ（openai/codex-action の `effort` 入力）。
	# claude-code-action / Copilot CLI には対応する入力が無いため、黙って捨てずに知らせる。
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
	# pending が 0 件なら、エージェントを起動しても読む材料が無い。起動前に notify へ倒す。
	if [ "${count}" -eq 0 ] && [ "${resolved_mode}" = agent ]; then
		warn "pending が 0 件なので mode=agent を notify へ倒す（エージェントへ渡す材料が無い）"
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
	local index count rank date_value priority type_value f
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
	while IFS=$'\t' read -r rank date_value priority type_value f; do
		[ -n "${f}" ] || continue
		# SC2016: 表のセルを囲むバックティックはリテラル。展開させない意図で単一引用符が正しい。
		# shellcheck disable=SC2016
		printf '| %s | %s | %s | `%s` | %s |\n' \
			"${priority}" "${type_value}" "${date_value}" "${f}" "$(summary_of "${f}")"
	done <"${index}"
	rm -f "${index}"
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
   判断基準はスキル本体のガイド `references/apply.md` の「記述先（適用先）の選び方」に従う。
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
	while IFS=$'\t' read -r _rank _date priority type_value f; do
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
