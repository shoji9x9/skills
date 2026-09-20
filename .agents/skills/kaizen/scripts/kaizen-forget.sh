#!/usr/bin/env bash
# kaizen forget helper
#
# 適用されないまま古くなった pending の学びを `status: forgotten` にする（Issue #339）。
#
#   kaizen-forget.sh --list        忘却候補を一覧する（何も変更しない）
#   kaizen-forget.sh --auto        条件を満たす候補を忘却する（抽出完了時に kaizen-extract-done.sh が呼ぶ既定経路）
#   kaizen-forget.sh FILE...       指定したノートを条件に関わらず忘却する（明示指示）
#
# **忘却はファイルを動かさない。** frontmatter の `status` を 1 行書き換えるだけにする——
# 自動で走る経路なので、`git mv` を含めると勝手にステージされた差分が生まれる。
# 狙いである「SessionStart 注入の肥大」は status だけで解ける
# （kaizen-context-inject.sh は `status: pending` しか注入しない）。
# 本文は top-level に残るので KEDB 照合（kaizen-kedb-match.sh）は従来どおり全文を照合し、
# **同じ事象が再発すればヒットする**。そこで pending へ戻せる（`references/extract.md`）。
# 物理的な移動は従来どおり明示の `kaizen archive` が担う。
#
# 判定材料:
#   - `status: pending`（applied / rejected / forgotten は対象外）
#   - `priority` が閾値以下（既定は medium まで。KEDB 照合で再発が見つかったノートは
#     `references/extract.md` の契約により優先度が上がるので、low のままは「再発していない」証跡）
#   - `date` から閾値日数以上が経過している（日付を読めないノートは対象外＝忘れない）
#
# 設定（`.kaizen/config` の `KEY=VALUE`。既定値はこのスクリプトが持つ）:
#   forget_auto=on|off              --auto の有効・無効（既定 on）
#   forget_after_days=<整数>        記録からこの日数が過ぎたら候補（既定 30）
#   forget_max_priority=low|medium|high  この優先度までを候補にする（既定 medium）
#
# 詳細手順は references/housekeeping.md を参照。
set -euo pipefail

orig_pwd=$(pwd)
orig_pwd=${orig_pwd%/}
kaizen_lib="$(dirname "${BASH_SOURCE[0]}")/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
if [ -r "${kaizen_lib}" ]; then
	. "${kaizen_lib}"
else
	printf '%s: 共通ライブラリを読めないため縮退します: %s\n' "$(basename "${BASH_SOURCE[0]}")" "${kaizen_lib}" >&2
fi
# `.kaizen/` は**いま作業している作業ツリー**基準で解決する（他の kaizen スクリプトと統一）。
if declare -f kaizen_resolve_project_root >/dev/null 2>&1; then
	project_root=$(kaizen_resolve_project_root "")
else
	project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
fi
if [ -n "${project_root}" ]; then
	cd "${project_root}" || {
		echo "kaizen-forget: failed to cd to project root: ${project_root}" >&2
		exit 1
	}
fi

resolve_path() {
	case "$1" in
	/*) printf '%s' "$1" ;;
	*) printf '%s/%s' "${orig_pwd}" "$1" ;;
	esac
}

# frontmatter（最初の `---` ブロック）の 1 フィールドを取り出す。
# 本文中の `status:` / `priority:` を拾わないよう範囲を frontmatter に限る
# （kaizen-context-inject.sh の frontmatter_field と同じ契約）。
frontmatter_field() { # $1: ノート $2: キー
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

config_value() { # $1: キー名
	declare -f kaizen_config_value >/dev/null 2>&1 || return 1
	kaizen_config_value "$1"
}

# --- 設定の解決 -------------------------------------------------------------
# 不正値は既定へ倒し、黙って倒さずに stderr へ出す（設定したつもりの閾値で動いていると
# 読めてしまうため。kaizen-precommit-gate.sh の resolve_retention_days と同じ方針）。
forget_auto=on
if raw=$(config_value forget_auto); then
	case "${raw}" in
	on | off) forget_auto=${raw} ;;
	*) printf 'kaizen-forget: .kaizen/config の forget_auto が不正です（%q）。既定の %s を使います。\n' "${raw:0:40}" "${forget_auto}" >&2 ;;
	esac
fi

forget_after_days=30
if raw=$(config_value forget_after_days); then
	if [[ "${raw}" =~ ^[0-9]{1,6}$ ]]; then
		forget_after_days=$((10#${raw}))
	else
		printf 'kaizen-forget: .kaizen/config の forget_after_days が不正です（%q）。既定の %s 日を使います。\n' "${raw:0:40}" "${forget_after_days}" >&2
	fi
fi

# priority の順位。数が大きいほど低い優先度（kaizen-context-inject.sh の rank と揃える）。
priority_rank() { # $1: priority
	case "$1" in
	high) printf '0' ;;
	medium) printf '1' ;;
	low) printf '2' ;;
	# 未知・未設定の priority は**忘却の対象外**にする。注入側は末尾へ回すだけだが、
	# こちらは「消える側」の操作なので、読めない値を最も低い優先度に倒すと
	# priority を書き忘れただけの学びが自動で忘れられる。
	*) return 1 ;;
	esac
}

forget_max_priority=medium
forget_max_rank=1
if raw=$(config_value forget_max_priority); then
	if rank=$(priority_rank "${raw}"); then
		forget_max_rank=${rank}
		forget_max_priority=${raw}
	else
		printf 'kaizen-forget: .kaizen/config の forget_max_priority が不正です（%q）。既定の %s を使います。\n' "${raw:0:40}" "${forget_max_priority}" >&2
	fi
fi

# --- 候補判定 ---------------------------------------------------------------
today_days=""
if declare -f kaizen_days_from_date >/dev/null 2>&1; then
	today_days=$(kaizen_days_from_date "$(date -u '+%Y-%m-%d' 2>/dev/null || true)") || today_days=""
fi

# 候補なら 0、そうでなければ 1 を返す。判定できない材料は候補から外す（忘れない側へ倒す）。
is_candidate() { # $1: ノート
	local note="$1" status priority rank note_days age
	status=$(frontmatter_field "${note}" status)
	[ "${status}" = "pending" ] || return 1
	priority=$(frontmatter_field "${note}" priority)
	rank=$(priority_rank "${priority}") || return 1
	[ "${rank}" -ge "${forget_max_rank}" ] || return 1
	[ -n "${today_days}" ] || return 1
	note_days=$(kaizen_days_from_date "$(frontmatter_field "${note}" date)") || return 1
	age=$((today_days - note_days))
	[ "${age}" -ge "${forget_after_days}" ] || return 1
	return 0
}

# 候補の一覧を stdout へ（1 行 1 ファイル、タブ区切りで判断材料も出す）。
list_candidates() {
	local note age note_days
	for note in .kaizen/*.md; do
		[ -e "${note}" ] || continue
		[ "$(basename "${note}")" = "INDEX.md" ] && continue
		is_candidate "${note}" || continue
		note_days=$(kaizen_days_from_date "$(frontmatter_field "${note}" date)") || continue
		age=$((today_days - note_days))
		printf '%s\t%s\t%s\t%s\n' "${note}" "$(frontmatter_field "${note}" date)" "$(frontmatter_field "${note}" priority)" "${age}"
	done
}

# frontmatter の `status:` 行だけを書き換える。本文の `status:` には触らない。
# 一時ファイルへ書いてから内容を戻すことで、元ファイルの mode とシンボリックリンクを保つ
# （kaizen-archive.sh のリンク補正と同じ手順）。
rewrite_status() { # $1: ノート
	local note="$1" tmp
	# **固定名にしない。** 掃引は抽出完了時に走るので、同じリポジトリで 2 セッションが
	# 同時に commit を通せば両方が同じ tmp を書き合い、`cat tmp >note` が途中の内容を
	# 書き戻してノートを壊す（rc 0 なので「忘却した」と報告される）。
	tmp=$(mktemp "${note}.kaizen-forget-XXXXXX") || return 2
	# 中断（Ctrl-C・SIGTERM）で untracked の残骸を残さない。残ると clean 確認を持つ工程が
	# そこで止まる。EXIT だけでは kill に届かないのでシグナルも拾う。
	trap 'rm -f "${tmp}"' EXIT INT TERM
	awk '
		BEGIN { fm = 0; done = 0 }
		/^---[[:space:]]*$/ { fm++; print; next }
		fm == 1 && !done && index($0, "status:") == 1 { print "status: forgotten"; done = 1; next }
		{ print }
		END { exit(done ? 0 : 1) }
	' "${note}" >"${tmp}" || {
		# frontmatter に status 行が無いノートは新形式ではない。書き換えると
		# 「忘却した」と「status を持たない」が区別できなくなるので触らない。
		rm -f "${tmp}"
		trap - EXIT INT TERM
		return 1
	}
	# 書き戻しの失敗を握り潰さない。この関数は `if rewrite_status ...` から呼ばれるため
	# 関数本文では `set -e` が効かず、`cat` が失敗しても最後の `rm -f` の終了コード（0）が
	# 返る——読み取り専用のノートや書き込み失敗で、**書き換わっていないのに「忘却した」と
	# 報告する**（そのぶんが注入から消えたと誤解される）。
	# 返す値で理由を分ける（1 = status 行が無い / 2 = 書き戻せなかった）。同じ 1 にすると
	# 書き込み権限の問題が「新形式ではない」と案内され、直しようがなくなる。
	if ! cat "${tmp}" >"${note}"; then
		rm -f "${tmp}"
		trap - EXIT INT TERM
		return 2
	fi
	rm -f "${tmp}"
	trap - EXIT INT TERM
}

# 忘却できなかった理由を出す。$1 = rewrite_status の戻り値、$2 = 表示するノート。
report_rewrite_failure() { # $1: 戻り値 $2: ノート
	if [ "$1" -eq 2 ]; then
		echo "kaizen-forget: skip (could not write the note): $2" >&2
	else
		echo "kaizen-forget: skip (no status line in frontmatter): $2" >&2
	fi
}

# --- モードの分岐 -----------------------------------------------------------
print_usage() {
	{
		echo "usage: kaizen-forget.sh --list     # list forget candidates (no changes)"
		echo "       kaizen-forget.sh --auto     # forget the candidates (used by kaizen-extract-done.sh)"
		echo "       kaizen-forget.sh FILE...    # forget the given notes regardless of the thresholds"
	} >&2
}

mode=""
case "${1:-}" in
--list)
	mode=list
	shift
	;;
--auto)
	mode=auto
	shift
	;;
"")
	print_usage
	exit 2
	;;
-*)
	# 未知のフラグをファイル名として飲み込まない。飲み込むと `--dry-run` のような打ち間違いが
	# 「skip (not a file)」＋ exit 0 になり、**1 件も忘却していないのに成功**として返る。
	echo "kaizen-forget: unknown option: $1" >&2
	print_usage
	exit 2
	;;
*)
	mode=explicit
	;;
esac

if [ "${mode}" != "explicit" ] && [ "$#" -gt 0 ]; then
	echo "kaizen-forget: ${mode} mode takes no file arguments" >&2
	exit 2
fi

# **フラグの検査は第 1 引数だけでは足りない。** 位置が 2 番目以降でも同じ打ち間違いは起きる。
# 上の case を通り抜けると `kaizen-forget.sh note.md --dry-run` が note を忘却したうえで
# 「skip (not a file): --dry-run」を出して exit 0 で返る——**一部は書き換わっているのに成功**。
# 書き換えの前に全引数を検査し、1 つでもフラグがあれば何もせずに落とす。
for arg in "$@"; do
	case "${arg}" in
	-*)
		echo "kaizen-forget: unknown option: ${arg}" >&2
		print_usage
		exit 2
		;;
	esac
done

# 日付を日数へ変換できない＝共通ライブラリを読めていない。この状態で候補を数えると
# 全件が「材料を読めない」で外れ、**「閾値に当てはまるものが無い」と同じ出力**になる。
# 検査できなかったことを 0 件と区別できるよう、別の診断と非 0 終了で返す。
require_today_days() {
	[ -n "${today_days}" ] && return 0
	echo "kaizen-forget: 今日の日付を日数へ変換できませんでした（共通ライブラリ kaizen-hook-common.sh を読めていない可能性があります）。候補の判定ができないので何もしません。" >&2
	return 1
}

case "${mode}" in
list)
	require_today_days || exit 1
	candidates=$(list_candidates)
	if [ -z "${candidates}" ]; then
		# 対象 0 件を黙って成功にしない。閾値が効いているのか材料が読めていないのかを
		# 呼び出し側が区別できるよう、使った閾値まで出す。
		echo "kaizen-forget: 忘却候補はありません（status: pending / priority ${forget_max_priority} 以下 / ${forget_after_days} 日以上）" >&2
		exit 0
	fi
	printf '%s\n' "${candidates}"
	;;
auto)
	if [ "${forget_auto}" = "off" ]; then
		echo "kaizen-forget: 自動忘却は無効です（.kaizen/config の forget_auto=off）" >&2
		exit 0
	fi
	require_today_days || exit 1
	forgotten=0
	while IFS=$'\t' read -r note _date _priority _age; do
		[ -n "${note}" ] || continue
		rc=0
		rewrite_status "${note}" || rc=$?
		if [ "${rc}" -eq 0 ]; then
			printf '%s\n' "${note}"
			forgotten=$((forgotten + 1))
		else
			report_rewrite_failure "${rc}" "${note}"
		fi
	done <<<"$(list_candidates)"
	echo "kaizen-forget: forgot ${forgotten} note(s)" >&2
	;;
explicit)
	forgotten=0
	for arg in "$@"; do
		f=$(resolve_path "${arg}")
		if [ ! -f "${f}" ]; then
			echo "kaizen-forget: skip (not a file): ${arg}" >&2
			continue
		fi
		status=$(frontmatter_field "${f}" status)
		case "${status}" in
		pending) ;;
		forgotten)
			echo "kaizen-forget: skip (already forgotten): ${arg}" >&2
			continue
			;;
		*)
			# applied / rejected は「対策が済んだ」「見送ると決めた」宣言で、適用先を持つ。
			# forgotten は適用先を持たない状態なので、書き換えると applied-to と矛盾して
			# kaizen-status-check.sh が exit 2 で落ちる。整理したいなら archive を使う。
			echo "kaizen-forget: skip (status is ${status:-unset}; forget only applies to pending — use kaizen archive instead): ${arg}" >&2
			continue
			;;
		esac
		rc=0
		rewrite_status "${f}" || rc=$?
		if [ "${rc}" -eq 0 ]; then
			printf '%s\n' "${f}"
			forgotten=$((forgotten + 1))
		else
			report_rewrite_failure "${rc}" "${arg}"
		fi
	done
	echo "kaizen-forget: forgot ${forgotten} note(s)" >&2
	;;
esac

exit 0
