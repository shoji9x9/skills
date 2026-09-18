#!/usr/bin/env bash
# kaizen lifecycle status checker
#
# 学びの適用先宣言（applied-to）と status、アーカイブ索引の整合を検査する。
# 不整合は exit 2 + stderr で返し、kaizen-precommit-gate.sh から commit を止める。
#
# 加えて「決定論的な対策を提案したのにドキュメントだけで閉じた」ノートを**警告**する（Issue #341）。
# こちらは exit 0 のまま出す——意図してドキュメントへ寄せる判断は実在する（検査にできない形の
# 学びは文書に置くしかない）ので、止めるとその判断を通せなくなる。
set -euo pipefail

# cd する前に解決する（BASH_SOURCE は起動時の cwd 相対になり得るため）。
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)
kaizen_lib="$(dirname "${BASH_SOURCE[0]}")/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
[ -r "${kaizen_lib}" ] && . "${kaizen_lib}"
# `.kaizen/` は**いま作業している作業ツリー**基準で解決する（他の kaizen スクリプトと統一）。
# $CLAUDE_PROJECT_DIR を最優先にすると、git worktree で作業しているときにコミット対象と
# 別の `.kaizen/` を見てしまう（Issue #218）。
if declare -f kaizen_resolve_project_root >/dev/null 2>&1; then
	project_root=$(kaizen_resolve_project_root "")
else
	project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
fi
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

[ -d .kaizen ] || exit 0

errors=0
warnings=0

frontmatter_state() {
	awk '
		# 空配列は `[]` だけでなく `[ ]` のような空白入りでも、フォーマッタによる折り返しでも
		# 書かれる。内部の空白を落とし、折り返し分を連結してから判定しないと、pending は
		# 誤ブロック（空なのに「適用先あり」）、applied / rejected は検査漏れ（空なのに素通り）になる。
		# 4 つ目のフィールドは applied-to の要素を `,` で連ねたもの（括弧と引用符は落とす）。
		# 「空か否か」だけでは、決定論的な対策を提案したノートが doc だけで閉じられたことを
		# 判定できない（Issue #341）。要素は read の最後の変数へ丸ごと渡すため `|` を含んでも
		# 前 3 フィールドはずれない。
		function emit(  merged, body, n, i, parts, item, out) {
			merged = applied_value
			if (merged != "" && merged != "[]" && merged != "null" && merged != "~") nonempty = 1
			body = merged
			sub(/^\[/, "", body)
			sub(/\]$/, "", body)
			out = ""
			n = split(body, parts, ",")
			for (i = 1; i <= n; i++) {
				item = parts[i]
				gsub(/^["'"'"']+|["'"'"']+$/, "", item)
				if (item == "" || item == "null" || item == "~") continue
				out = (out == "" ? item : out "," item)
			}
			printf "%s|%s|%s|%s\n", status, present, nonempty, out
		}
		# ブロックシーケンスの 1 項目を flow 配列と同じ表記へ畳み込む。要素の分類にしか
		# 使わないので、flow 側と同じく内部の空白は落とす（値の復元には使わない）。
		function collect_item(line,  item) {
			item = line
			sub(/^[[:space:]]*-[[:space:]]*/, "", item)
			sub(/[[:space:]]+#.*$/, "", item)
			gsub(/[[:space:]]/, "", item)
			if (item == "") return
			applied_value = (applied_value == "" ? item : applied_value "," item)
		}
		BEGIN { fm = 0; present = 0; nonempty = 0; status = ""; in_applied = 0; applied_value = "" }
		/^---[[:space:]]*$/ {
			fm++
			if (fm == 2) {
				emit()
				exit
			}
			next
		}
		fm != 1 { next }
		/^status:[[:space:]]*/ {
			status = $0
			sub(/^status:[[:space:]]*/, "", status)
			sub(/[[:space:]]+#.*$/, "", status)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", status)
			in_applied = 0
			next
		}
		/^applied-to:[[:space:]]*/ {
			present = 1
			value = $0
			sub(/^applied-to:[[:space:]]*/, "", value)
			sub(/[[:space:]]+#.*$/, "", value)
			gsub(/[[:space:]]/, "", value)
			applied_value = value
			in_applied = 1
			next
		}
		in_applied && /^[[:space:]]+-[[:space:]]*[^[:space:]]/ {
			nonempty = 1
			collect_item($0)
			next
		}
		# ブロックシーケンスは親キーと同じ桁 0 に置いても正しい YAML で、フォーマッタ次第で
		# その形で書かれる。桁 0 というだけで値の終わりに倒すと、非空の applied-to が空と
		# 読まれ、applied / rejected は誤ブロック、pending は検査漏れ（fail open）になる（実測）。
		# 閉じ `---` は先頭のルールが先に next するのでここへは来ない。
		in_applied && /^-[[:space:]]+[^[:space:]]/ {
			nonempty = 1
			collect_item($0)
			next
		}
		# 折り返された flow 配列（`applied-to:` の次行以降にインデントで続く値）を拾う。
		# Markdown フォーマッタを .kaizen/*.md に掛けていると applied-to が長いだけで折り返される。
		in_applied && /^[[:space:]]+[^[:space:]#]/ {
			cont = $0
			sub(/[[:space:]]+#.*$/, "", cont)
			gsub(/[[:space:]]/, "", cont)
			applied_value = applied_value cont
			next
		}
		# ここへ来る桁 0 の行は applied-to の値の終わり（桁 0 に置ける継続行はブロック
		# シーケンスだけで、それは上のルールが先に next する）。リセット条件を
		# キー名の字種（`[[:alnum:]_-]+:`）で絞ると、それ以外の文字を含むキー（`kedb.ref:` や
		# 引用符付きキー）の後ろで in_applied が残り、そのブロックスカラー本文まで applied_value へ
		# 連結されて、空の `applied-to: []` が非空と判定される（実測）。
		# 桁 0 のコメントだけは値の途中に現れ得るのでリセットしない。
		/^[^[:space:]#]/ { in_applied = 0 }
		END {
			if (fm < 2) emit()
		}
	' "$1"
}

# 参照注入（kaizen-context-inject.sh）が要約に使う節の**先頭段落**が、複数の物理行に
# 折り返されていないかを判定する。注入はその節の最初の非空行だけを供給するため、
# 折り返されていると注入される要約が文の途中で切れる（Issue #301）。切れても注入は
# 成功し終了コードも 0 なので、書いた時点で気づける経路はこの形式検査しかない。
# 節の選び方は注入側と同じにする（見出しは前方一致、最初の非空行を要約とみなす）。
# 出力: `none`（その節に要約となる行が無い）/ `ok` / `wrapped` / `error`（読めなかった）。
# 判定が付いた時点で awk を `exit` させる（END は実行される）。5MB 級のノートを最後まで
# 読まずに済み、判定後に現れる同名見出しで結論が覆ることもない。
section_lead_state() {
	awk -v h="$1" '
		BEGIN { found = 0; wrapped = 0 }
		index($0, h) == 1 { in_sec = 1; next }
		# 見出しは節と段落の境界。境界に当たるまでに非空行が無ければ `none`（節が空）、
		# 先頭行を見つけた後なら段落はそこで閉じているので `ok`。これが無いと、次の見出しを
		# 先頭行と読んで（a）空の `## 提案` で `## 事象` へのフォールバックが起きず、
		# （b）1 行の先頭段落の直後に見出しが来るだけで `wrapped` と誤報する（実測）。
		# 注入側の `first_line_under()` は節を区切らないので、`## 提案` が空のときに注入される
		# 要約は次の見出し行そのものになる。その形は本検査の対象（折り返し）とは別の欠陥。
		in_sec && /^#/ { exit }
		in_sec && !found && NF { found = 1; lead = $0; next }
		in_sec && found {
			# 空行で先頭段落が閉じていれば折り返しではない。
			if (NF) {
				# 箇条書きの先頭項目に別の箇条書き項目が続くのは折り返しではなく兄弟項目。
				# 注入は先頭項目だけを要約に使う設計なので、後続項目の不在は欠落ではない。
				marker = "^[[:space:]]*([-*+]|[0-9]+\\.)[[:space:]]"
				if (!(lead ~ marker && $0 ~ marker)) wrapped = 1
			}
			exit
		}
		END { print (found ? (wrapped ? "wrapped" : "ok") : "none") }
	' "$2" || printf 'error\n'
}

# 見出し `$1` の節の本文を 1 つの文字列として返す（次の見出しまで）。節が無ければ空。
# 決定論的な対策の語を探すのは**提案の節だけ**にする。全文を対象にすると、事象の説明で
# 「lint が落ちた」と書いただけのノートが「lint を足す提案」と読まれる（偽陽性）。
section_text() { # $1: 見出し $2: ノート
	awk -v h="$1" '
		index($0, h) == 1 { in_sec = 1; next }
		in_sec && /^#/ { exit }
		in_sec { print }
	' "$2" 2>/dev/null || true
}

# 決定論的な対策を指す語。ここが正本で、採用先は `.kaizen/config` の
# `deterministic_measure_words` に**追加**できる（置換ではない。置換にすると採用先ごとに
# 判定がずれ、上流が語を足しても届かない）。
#
# ASCII の語は `grep -Eiw` で語境界を要求する——`ci` を部分一致にすると `decision` /
# `efficiency` に当たって警告が埋まる（実測で確認した偽陽性）。日本語の語は語境界の概念が
# 効かない（UTF-8 ロケールでは仮名・漢字が [[:alnum:]] に入るため `-w` が常に偽になる）ので
# 固定文字列の部分一致にする。
deterministic_words=(lint hook script CI pre-commit 検査 起票 スクリプト フック リンタ ゲート)
if declare -f kaizen_config_value >/dev/null 2>&1; then
	if extra_words=$(kaizen_config_value deterministic_measure_words); then
		# 区切りは空白かカンマ。空の設定値は「語を足さない」であって既定を消す指示ではない。
		extra_words=${extra_words//,/ }
		for word in ${extra_words}; do
			[ -n "${word}" ] && deterministic_words+=("${word}")
		done
	fi
fi

# 提案に決定論的な対策の語があるか。
proposes_mechanism() { # $1: ノート
	local text word
	text=$(section_text "## 提案" "$1")
	[ -n "${text}" ] || return 1
	for word in "${deterministic_words[@]}"; do
		if [[ "${word}" =~ ^[A-Za-z0-9._-]+$ ]]; then
			grep -Eiqw -- "${word}" <<<"${text}" && return 0
		else
			grep -Fq -- "${word}" <<<"${text}" && return 0
		fi
	done
	return 1
}

# applied-to の要素がドキュメント（`.md`）だけか。要素が 1 つも無ければ偽
# （空の applied-to は別の検査が exit 2 で落とすので、こちらで二重に鳴らさない）。
#
# 判定は拡張子だけで足りる。`.md` 以外の要素——スクリプト・設定・CI のパスも、
# `#<Issue 番号>` も、「ドキュメントで閉じていない」という点では同じ扱いでよい
# （Issue への切り出しは追跡可能な委譲なので、`references/apply.md` はこれを許している）。
applied_to_is_docs_only() { # $1: `,` 区切りの要素
	local entry found=""
	[ -n "$1" ] || return 1
	IFS=',' read -r -a entry_list <<<"$1"
	for entry in "${entry_list[@]}"; do
		[ -n "${entry}" ] || continue
		case "${entry}" in
		*.md) found=1 ;;
		*) return 1 ;;
		esac
	done
	[ -n "${found}" ]
}

for note in .kaizen/*.md .kaizen/archive/*.md; do
	[ -e "${note}" ] || continue
	[ "$(basename "${note}")" = "INDEX.md" ] && continue
	# 1 件の読み取り失敗でループごと落とさない（set -e で残りのノートが未検査になり、
	# 診断も awk のメッセージだけになって「何の不整合か分からないまま commit できない」状態になる）。
	# 読めないノートは検査できていないので、素通りさせず不整合として数えて fail closed を保つ。
	if ! state=$(frontmatter_state "${note}" 2>/dev/null); then
		# 失敗理由は権限とは限らない（破損・awk の内部エラー等）。捨てると「何の不整合か
		# 分からないまま commit できない」状態に戻るので、失敗時だけ読み直して診断を添える。
		detail=$(frontmatter_state "${note}" 2>&1 >/dev/null | tr '\n' ' ') || true
		echo "kaizen-status-check: ${note}: could not read the frontmatter: ${detail:-no diagnostics from awk}" >&2
		errors=$((errors + 1))
		continue
	fi
	# entries は最後の変数なので、要素に `|` が含まれても前 3 フィールドはずれない。
	IFS='|' read -r status present nonempty entries <<<"${state}"

	# 折り返し検査の対象は、参照注入が実際に読む集合（archive を除く `.kaizen/*.md` のうち
	# status: pending）に揃える。archive と applied / rejected / forgotten は注入されないので、
	# 過去の書き方を理由に commit を止めない。
	case "${note}" in
	.kaizen/archive/*) ;;
	*)
		if [ "${status}" = "pending" ]; then
			lead_section="## 提案"
			lead_state=$(section_lead_state "${lead_section}" "${note}" 2>/dev/null)
			# 注入は「## 提案」に要約となる行が無ければ「## 事象」へフォールバックする。
			if [ "${lead_state}" = "none" ]; then
				lead_section="## 事象"
				lead_state=$(section_lead_state "${lead_section}" "${note}" 2>/dev/null)
			fi
			case "${lead_state}" in
			wrapped)
				echo "kaizen-status-check: ${note}: the lead paragraph under ${lead_section} is wrapped onto the next line; the session-start digest injects only its first line, so keep the lead on one physical line" >&2
				errors=$((errors + 1))
				;;
			ok | none) ;;
			*)
				# 判定不能を素通りさせない（ループ先頭の frontmatter 読み取りと同じ fail closed）。
				# 素通りさせると「検査した」と「検査できなかった」が同じ exit 0 になる。
				# 理由を捨てると直しようがないので、失敗時だけ読み直して awk の診断を添える。
				detail=$(section_lead_state "${lead_section}" "${note}" 2>&1 >/dev/null | tr '\n' ' ') || true
				echo "kaizen-status-check: ${note}: could not inspect the lead paragraph under ${lead_section}: ${detail:-no diagnostics from awk}" >&2
				errors=$((errors + 1))
				;;
			esac
		fi
		# 決定論的な対策を提案したのにドキュメントだけで閉じたノートを知らせる（Issue #341）。
		# `status: applied` は「対策が済んだ」宣言なので、ここで言わないと提案の 2 つ目以降が
		# 未実施のまま閉じ、症状は同じ学びの再発としてしか現れない。
		# archive 配下は履歴なので対象外にする（もう直せない指摘を毎コミット出しても雑音になる）。
		# 判定の順は安い方から——要素の分類は文字列操作だけで済むが、提案の走査はノートを読む。
		if [ "${status}" = "applied" ] && applied_to_is_docs_only "${entries}" && proposes_mechanism "${note}"; then
			echo "kaizen-status-check: ${note}: warning: the proposal names a deterministic measure (lint / hook / script / CI) but applied-to lists documents only; apply it to a mechanism, or record where it will be done" >&2
			warnings=$((warnings + 1))
		fi
		;;
	esac

	# applied-to が無い旧形式は後方互換のため検査対象外。新形式としてフィールドを
	# 宣言したノートだけを厳密に検査する。
	[ "${present}" = "1" ] || continue
	# applied-to を宣言したノートは新形式なので status も必須。status 行が無い／読めないと
	# pending / applied / rejected / forgotten のどれにも一致せず、以降の検査を素通りしてしまう。
	if [ -z "${status}" ]; then
		echo "kaizen-status-check: ${note}: applied-to is declared but status is missing" >&2
		errors=$((errors + 1))
	elif { [ "${status}" = "pending" ] || [ "${status}" = "forgotten" ]; } && [ "${nonempty}" = "1" ]; then
		# forgotten は「適用しないまま一旦忘れる」なので、pending と同じく適用先を持たない。
		# 値があるなら applied / rejected のどれかであるべきで、status の取り違えを示す。
		echo "kaizen-status-check: ${note}: applied-to is set but status is ${status}" >&2
		errors=$((errors + 1))
	elif { [ "${status}" = "applied" ] || [ "${status}" = "rejected" ]; } && [ "${nonempty}" = "0" ]; then
		echo "kaizen-status-check: ${note}: status is ${status} but applied-to is empty" >&2
		errors=$((errors + 1))
	elif [ "${status}" != "pending" ] && [ "${status}" != "applied" ] && [ "${status}" != "rejected" ] && [ "${status}" != "forgotten" ]; then
		# 未知の status は非空なのでどの分岐にも当たらず、全検査を素通りしていた。
		# applied-to を宣言した時点で新形式なので、定義済みの 4 値だけを受け付ける。
		echo "kaizen-status-check: ${note}: unknown status: ${status} (expected pending, applied, rejected or forgotten)" >&2
		errors=$((errors + 1))
	fi
done

archive_dir=.kaizen/archive
index_file=${archive_dir}/INDEX.md
if [ -d "${archive_dir}" ]; then
	# エントリ一覧は 1 度だけ抽出する。archived note ごとに INDEX.md を読み直すと
	# 件数の二乗に比例して重くなり、コミット前ゲートの実行時間へ効いてくる。
	index_entries=""
	if [ -f "${index_file}" ]; then
		# shellcheck disable=SC2016 # sed の backtick と後方参照はリテラル。
		index_entries=$(sed -n 's/^- `\([^`]*\.md\)` .*$/\1/p' "${index_file}")
	fi
	for note in "${archive_dir}"/*.md; do
		[ -e "${note}" ] || continue
		[ "$(basename "${note}")" = "INDEX.md" ] && continue
		base=$(basename "${note}")
		entry_count=0
		if [ -n "${index_entries}" ]; then
			entry_count=$(awk -v target="${base}" '$0 == target { count++ } END { print count + 0 }' <<<"${index_entries}")
		fi
		if [ "${entry_count}" -ne 1 ]; then
			echo "kaizen-status-check: ${note}: expected exactly one entry in ${index_file}, found ${entry_count}" >&2
			errors=$((errors + 1))
		fi
	done

	if [ -n "${index_entries}" ]; then
		while IFS= read -r base; do
			[ -n "${base}" ] || continue
			if [ ! -f "${archive_dir}/${base}" ]; then
				echo "kaizen-status-check: ${index_file}: stale entry for ${base}" >&2
				errors=$((errors + 1))
			fi
		done <<<"${index_entries}"
	fi
fi

if [ "${warnings}" -gt 0 ]; then
	# 警告は終了コードに入れない（Issue #341: 止めるとドキュメントへ寄せる判断を通せなくなる）。
	# 件数だけは出す——1 件ずつの行は他の出力に紛れるので、総数が無いと見落とす。
	echo "kaizen-status-check: ${warnings} warning(s); add the deterministic words your project uses to deterministic_measure_words in .kaizen/config" >&2
fi

if [ "${errors}" -gt 0 ]; then
	# スクリプトは PATH に無いので、そのまま貼れる形で案内する。
	if [ -n "${script_dir}" ]; then
		reindex_cmd="bash \"${script_dir}/kaizen-archive.sh\" --reindex"
	else
		reindex_cmd="バンドルされた kaizen-archive.sh を --reindex 付きで実行"
	fi
	echo "kaizen-status-check: ${errors} problem(s); fix status/applied-to or the reported note text, or ${reindex_cmd}" >&2
	exit 2
fi

exit 0
