#!/usr/bin/env bash
# kaizen lifecycle status checker
#
# 学びの適用先宣言（applied-to）と status、アーカイブ索引の整合を検査する。
# 不整合は exit 2 + stderr で返し、kaizen-precommit-gate.sh から commit を止める。
#
# 加えて「機構で解決すると宣言した（`type: hook`）のにドキュメントだけで閉じた」ノートを**警告**する。
# こちらは exit 0 のまま出す。意図してドキュメントへ寄せる判断は実在する（検査にできない形の
# 学びは文書に置くしかない）ので、止めるとその判断を通せなくなる。
set -euo pipefail

# cd する前に解決する（BASH_SOURCE は起動時の cwd 相対になり得るため）。
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)
kaizen_lib="$(dirname "${BASH_SOURCE[0]}")/kaizen-hook-common.sh"
# 共通ライブラリは同梱物。source 先を静的追跡できない旨の SC1091 は仕様どおりなので抑止する。
# shellcheck source=./kaizen-hook-common.sh disable=SC1091
if [ -r "${kaizen_lib}" ]; then
	. "${kaizen_lib}"
else
	printf '%s: 共通ライブラリを読めないため、機能を減らして動きます: %s\n' "$(basename "${BASH_SOURCE[0]}")" "${kaizen_lib}" >&2
fi
# `.kaizen/` は**いま作業している作業ツリー**基準で解決する（他の kaizen スクリプトと統一）。
# $CLAUDE_PROJECT_DIR を最優先にすると、git worktree で作業しているときにコミット対象と
# 別の `.kaizen/` を見てしまう。
if declare -f kaizen_resolve_project_root >/dev/null 2>&1; then
	project_root=$(kaizen_resolve_project_root "")
else
	project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
fi
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

[ -d .kaizen ] || exit 0

errors=0
warnings=0

# $1: ノート $2: 1 なら archive のノートとして読む。
# archive のノートは注入されず、同梱のスクリプトも読まないので、status・type・confidence の行末のコメントと、
# confidence の対になった引用符を落として値を確かめる（過去の書き方を理由に commit を止めない。キーの形のチェックを当てないのと同じ理由である）。
frontmatter_state() {
	awk '
		# 空配列は `[]` だけでなく `[ ]` のような空白入りでも、フォーマッタによる折り返しでも
		# 書かれる。内部の空白を落とし、折り返し分を連結してから判定しないと、pending は
		# 誤ってブロック（空なのに「適用先あり」）し、applied / rejected はチェックの抜け（空なのにそのまま通る）になる。
		# 最後のフィールドは applied-to の要素を `,` で連ねたもの（括弧と引用符は落とす）。
		# 「空か否か」だけでは、決定論的な対策を提案したノートが doc だけで閉じられたことを
		# 判定できない。要素は read の最後の変数へ丸ごと渡すため `|` を含んでも
		# 前のフィールドはずれない。
		function emit(  merged, body, n, i, parts, item, out) {
			merged = applied_value
			if (merged != "" && merged != "[]" && merged != "null" && merged != "~") nonempty = 1
			body = merged
			sub(/^\[/, "", body)
			sub(/\]$/, "", body)
			out = ""
			# 要素のアンカー・エイリアス・タグ（`- *ref`・`[&a docs/a.md]`・`[!!str x]`）も、値そのものと同じく 1 行の文字列として読めない。
			# ブロックシーケンスの要素は collect_item が 1 つずつ確かめる（要素の中の `,` は区切りではない）。
			# flow 配列は、本文（折り返した行を含む）を element_has_marker で確かめる。
			# 値そのものの形（`applied-to: *ref`）を記録したノートでは、同じ問題を 2 回数えない。
			flow = flow_value
			sub(/^\[/, "", flow)
			sub(/\]$/, "", flow)
			if (!applied_form_bad && (block_marker || element_has_marker(flow))) add_bad("applied-to:item")
			n = split(body, parts, ",")
			for (i = 1; i <= n; i++) {
				item = parts[i]
				gsub(/^["'"'"']+|["'"'"']+$/, "", item)
				if (item == "" || item == "null" || item == "~") continue
				out = (out == "" ? item : out "," item)
			}
			# 不正な値が 1 つでもあれば、最後の値ではなく、不正な値をすべて連ねたものを渡す。重なったキーの値を 1 回の実行でまとめて報告するためである。
			if (conf_bad != "") confidence = conf_bad
			# 区切りの `|` を値に含むと、read が後ろのフィールドをずらす（`confidence: low|high` が
			# low として通る）。最後の applied-to 以外の文字列の値では `|` を全角の `｜` に置き換える。
			# メッセージに出る値が書いた文字と見た目で対応するように、半角の `/` などの別の文字にはしない。
			gsub(/\|/, "｜", status)
			gsub(/\|/, "｜", type)
			gsub(/\|/, "｜", confidence)
			# confidence は、出てきた回数と、コロンの後に空白が無い形があったか（0 か 1）を別のフィールドで渡す。
			# キーを引用符で囲んだ形・コロンの前に空白を書いた形・アンカーやタグを付けた形があったか（0 か 1）も、別のフィールドで渡す。
			# status・type・priority・date・applied-to は、出てきた回数と、受け付けない形（「キー:種類」を「,」で連ねたもの）を渡す。
			# 種類は block・tag・anchor・word・date（値）、key・nospace・explicit（キーの書き方）、item（applied-to の要素）である。
			gsub(/\|/, "｜", date)
			printf "%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n", status, present, nonempty, type, conf_count, conf_nospace, conf_key, confidence, status_count, type_count, priority_count, date_count, date, applied_count, bad_forms, out
		}
		# ブロックスカラー（`|`・`>-` の次の行に値を書く形）とタグ（`!!str applied`）は、1 行の値として読めないので記録する。
		# 値は、コメントと前後の空白を落とした後、引用符を落とす前のものを渡す（引用符で囲んだ `"|"` は文字列である）。
		# アンカー（`&s pending`）とエイリアス（`*s`）も、1 行の値として読めないので記録する。
		function add_bad(form) {
			bad_forms = (bad_forms == "" ? "" : bad_forms ",") form
		}
		function note_form(key, value,  kind) {
			kind = ""
			if (value ~ /^[|>][-+0-9]*$/) kind = "block"
			else if (value ~ /^!/) kind = "tag"
			else if (value ~ /^[&*]/) kind = "anchor"
			# status・type・priority は 1 つの語なので、英数字・`_`・`-` だけの語（と空の値）を受け付け、それ以外の形はすべて止める。
			# date は `YYYY-MM-DD` の形（と空の値）だけを受け付ける。
			# 記号を 1 つずつ拒否する形にすると、YAML の記号（`[`・`%`・引用符・行末のコメントなど）の数だけ抜けが残る。
			# 同梱のスクリプト（kaizen_frontmatter_values）は、行末のコメントや引用符を値の一部として読む。ここで止めるので、読み方を広げずに済む。
			else if (key == "date" && value != "" && value !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) kind = "date"
			else if (key != "applied-to" && key != "date" && value != "" && value !~ /^[A-Za-z0-9][A-Za-z0-9_-]*$/) kind = "word"
			# priority の打ち間違い（hgih）は、注入では末尾に回り、忘却では候補から外れ続けるので、3 つの値のほかを止める。
			else if (key == "priority" && value != "" && value !~ /^(high|medium|low)$/) kind = "level"
			if (kind == "") return
			add_bad(key ":" kind)
			if (key == "applied-to") applied_form_bad = 1
		}
		# 値を読むのは、引用符の無いキーの直後にコロンと空白を書いた形（`status: `）だけである。
		# 同梱のスクリプト（kaizen_frontmatter_values）も、引用符の無いキーの直後にコロンを書いた行だけを読む。
		# 引用符で囲んだキー・コロンの前の空白・キーに付けたアンカーやタグ（`&k status:`）は、数えはするが値を読まないので、形の誤りとして記録する。
		# コロンの後に空白が無い形（`status:applied`）は YAML の mapping にならないので、confidence と同じく止める。
		function note_key(key, line) {
			if (index(line, key ":") != 1) add_bad(key ":key")
			else if (substr(line, length(key) + 2) ~ /^[^[:space:]]/) add_bad(key ":nospace")
		}
		# flow 配列の本文（内部の空白は落としたもの）で、要素の先頭がアンカー・エイリアス・タグかを見る。
		# 引用符の中の `,` は要素の区切りではないので、引用符の外だけを見る（`"docs/a, *b.md"` は 1 つの文字列である）。
		function element_has_marker(body,  i, c, q, start) {
			q = ""
			start = 1
			for (i = 1; i <= length(body); i++) {
				c = substr(body, i, 1)
				if (q != "") {
					# 二重引用符の中の `\"` は文字列の続きである（単引用符の中では `\` はエスケープにならない）。
					if (q == "\"" && c == "\\") i++
					else if (c == q) q = ""
					continue
				}
				if (c == ",") {
					start = 1
					continue
				}
				if (start && c ~ /[&*!]/) return 1
				start = 0
				if (c == "\"" || c == "'"'"'") q = c
			}
			return 0
		}
		# ブロックシーケンスの 1 項目を flow 配列と同じ表記へ畳み込む。要素の分類にしか
		# 使わないので、flow 側と同じく内部の空白は落とす（値の復元には使わない）。
		function collect_item(line,  item) {
			item = line
			sub(/^[[:space:]]*-[[:space:]]*/, "", item)
			sub(/[[:space:]]+#.*$/, "", item)
			if (item ~ /^[&*![{|>]/) block_marker = 1
			gsub(/[[:space:]]/, "", item)
			if (item == "") return
			applied_value = (applied_value == "" ? item : applied_value "," item)
		}
		BEGIN { status_seen = 0; type_seen = 0; date_seen = 0; date = ""; fm = 0; present = 0; nonempty = 0; status = ""; type = ""; conf_count = 0; conf_nospace = 0; conf_bad = ""; confidence = ""; in_applied = 0; applied_value = ""; status_count = 0; type_count = 0; priority_count = 0; date_count = 0; applied_count = 0; bad_forms = ""; applied_form_bad = 0; conf_key = 0; flow_value = ""; block_marker = 0 }
		/^---[[:space:]]*$/ {
			fm++
			if (fm == 2) {
				emit()
				exit
			}
			next
		}
		fm != 1 { next }
		# キーの重なりは、confidence と同じく YAML として正しくない（実装によってエラーになるか、どちらかの値を採る）ので、
		# 引用符で囲んだキーとアンカーやタグを付けたキー（`&a !!str status:` のように 2 つ付けた形も）を含めて出てきた回数を数える。値を読むのは、引用符の無いキーだけである。
		/^([&!][^[:space:]]*[[:space:]]+)*("status"|'"'"'status'"'"'|status)[[:space:]]*:/ { status_count++; note_key("status", $0) }
		/^([&!][^[:space:]]*[[:space:]]+)*("type"|'"'"'type'"'"'|type)[[:space:]]*:/ { type_count++; note_key("type", $0) }
		/^([&!][^[:space:]]*[[:space:]]+)*("priority"|'"'"'priority'"'"'|priority)[[:space:]]*:/ { priority_count++; note_key("priority", $0) }
		/^([&!][^[:space:]]*[[:space:]]+)*("date"|'"'"'date'"'"'|date)[[:space:]]*:/ { date_count++; note_key("date", $0) }
		# YAML の明示的なキー（`? status` の次の行に `: applied`）は、キーと値が別の行になるので、1 行で読めない。
		# どの欄のキーかに関わらず止める（キーの重なりとしても数えられない）。
		/^\?([[:space:]]|$)/ { add_bad("?:explicit") }
		/^([&!][^[:space:]]*[[:space:]]+)*("applied-to"|'"'"'applied-to'"'"'|applied-to)[[:space:]]*:/ { applied_count++; note_key("applied-to", $0) }
		# キーが重なったときは、同梱のスクリプト（kaizen_frontmatter_values）と同じく最初の値を使う（type も同じ）。
		/^status:[[:space:]]*/ {
			value = $0
			sub(/^status:[[:space:]]*/, "", value)
			if (lenient) sub(/[[:space:]]+#.*$/, "", value)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			note_form("status", value)
			if (!status_seen) status = value
			status_seen = 1
			in_applied = 0
			next
		}
		# type は「その学びが何で解決されるべきか」の宣言。`hook` は機構を要求する type なので、
		# 適用先がドキュメントだけなら宣言と結果が食い違っている。
		/^type:[[:space:]]*/ {
			value = $0
			sub(/^type:[[:space:]]*/, "", value)
			if (lenient) sub(/[[:space:]]+#.*$/, "", value)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			note_form("type", value)
			if (!type_seen) type = value
			type_seen = 1
			in_applied = 0
			next
		}
		/^priority:[[:space:]]*/ {
			value = $0
			sub(/^priority:[[:space:]]*/, "", value)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			note_form("priority", value)
			in_applied = 0
			next
		}
		/^date:[[:space:]]*/ {
			value = $0
			sub(/^date:[[:space:]]*/, "", value)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			note_form("date", value)
			if (!date_seen) date = value
			date_seen = 1
			in_applied = 0
			next
		}
		# confidence は任意の欄。この欄を足す前に書いたノートには無いので、在るときだけ値を検査する。
		# 同梱のスクリプト（kaizen_frontmatter_values）と同じく、引用符の無いキーの直後にコロンを書いた行の、コロンより後ろを値として読む。
		# 行末のコメントと引用符は値の一部として読み、high・medium・low に当たらない値として止める。
		# キーを引用符で囲んだ形・コロンの前に空白を書いた形・アンカーやタグを付けた形は、同梱のスクリプトが読まないので止める。
		# キーの重なりは YAML として正しくない（実装によってエラーになるか、どちらかの値を採る）ので、
		# 出てきた回数を数えて止める。コロンの後に空白が無い形（`confidence:high`）は YAML の mapping に
		# ならないので止める。
		/^([&!][^[:space:]]*[[:space:]]+)*("confidence"|'"'"'confidence'"'"'|confidence)[[:space:]]*:/ {
			conf_count++
			confidence = $0
			if (index($0, "confidence:") != 1) conf_key = 1
			sub(/^([&!][^[:space:]]*[[:space:]]+)*("confidence"|'"'"'confidence'"'"'|confidence)[[:space:]]*:/, "", confidence)
			if (confidence ~ /^[^[:space:]]/) conf_nospace = 1
			if (lenient) sub(/[[:space:]]+#.*$/, "", confidence)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", confidence)
			if (lenient && (confidence ~ /^".*"$/ || confidence ~ /^'"'"'.*'"'"'$/)) confidence = substr(confidence, 2, length(confidence) - 2)
			# キーが重なったときに前の不正な値を見逃さないよう、不正な値はすべて「, 」で連ねて残す。空の値は <empty> と書く。
			if (confidence != "high" && confidence != "medium" && confidence != "low") {
				bad = (confidence == "" ? "<empty>" : confidence)
				conf_bad = (conf_bad == "" ? bad : conf_bad ", " bad)
			}
			in_applied = 0
			next
		}
		/^applied-to:[[:space:]]*/ {
			present = 1
			value = $0
			sub(/^applied-to:[[:space:]]*/, "", value)
			sub(/[[:space:]]+#.*$/, "", value)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			# 要素を読むのは最後の applied-to だけなので、値そのものの形の記録もキーごとに戻す。
			applied_form_bad = 0
			block_marker = 0
			note_form("applied-to", value)
			gsub(/[[:space:]]/, "", value)
			applied_value = value
			flow_value = value
			in_applied = 1
			next
		}
		in_applied && /^[[:space:]]+-[[:space:]]*[^[:space:]]/ {
			nonempty = 1
			collect_item($0)
			next
		}
		# ブロックシーケンスは親キーと同じ桁 0 に置いても正しい YAML で、フォーマッタ次第で
		# その形で書かれる。桁 0 というだけで値の終わりと判定すると、空でない applied-to が空と
		# 読まれ、applied / rejected は誤ってブロックし、pending はチェックの抜けになる（実測）。
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
			flow_value = flow_value cont
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
	' lenient="${2:-0}" "$1"
}

# 参照注入（kaizen-context-inject.sh）が要約に使う節の**先頭段落**が、複数の物理行に
# 折り返されていないかを判定する。注入はその節の最初の非空行だけを供給するため、
# 折り返されていると注入される要約が文の途中で切れる。切れても注入は
# 成功し終了コードも 0 なので、書いた時点で気づける方法はこの形式のチェックしかない。
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

# 機構（lint / hook / script / CI）で解決すべきだと宣言している type。
#
# 判定材料を提案の文面から採らないのは、実データで分離できないと測れたため。
# このリポジトリの applied 131 件で語（lint / hook / script / CI / 検査 / 起票 …）を照合すると、
# 一致 16 件はすべて `検査` / `ゲート` / `スクリプト` の 3 語で、どれも「提案が何について
# 述べているか」を指すだけだった。適用先に機構が入ったノートへの一致は 38%、doc だけの
# ノートへの一致は 33% で、2 つのクラスをほとんど分離していない。
# 一方 `type` は書き手が明示的に宣言した値で、`hook` は機構 6 件 / doc だけ 1 件に分かれる。
mechanism_types="hook"

# applied-to の要素がドキュメント（`.md`）だけか。要素が 1 つも無ければ偽
# （空の applied-to は別の検査が exit 2 で落とすので、こちらで二重に鳴らさない）。
#
# 判定は拡張子だけで足りる。`.md` 以外の要素（スクリプト・設定・CI のパスと `#<Issue 番号>`）は、
# 「ドキュメントで閉じていない」という点では同じ扱いでよい
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
	# 読めないノートはチェックできていないので、そのまま通さず、不整合として数えてブロックする。
	lenient=0
	case "${note}" in
	.kaizen/archive/*) lenient=1 ;;
	esac
	if ! state=$(frontmatter_state "${note}" "${lenient}" 2>/dev/null); then
		# 失敗理由は権限とは限らない（破損・awk の内部エラー等）。捨てると「何の不整合か
		# 分からないまま commit できない」状態に戻るので、失敗時だけ読み直して診断を添える。
		detail=$(frontmatter_state "${note}" "${lenient}" 2>&1 >/dev/null | tr '\n' ' ') || true
		echo "kaizen-status-check: ${note}: could not read the frontmatter: ${detail:-no diagnostics from awk}" >&2
		errors=$((errors + 1))
		continue
	fi
	# entries は最後の変数なので、要素に `|` が含まれても前のフィールドはずれない。
	IFS='|' read -r status present nonempty type conf_count conf_nospace conf_key confidence status_count type_count priority_count date_count date_value applied_count bad_forms entries <<<"${state}"

	# status・type・priority・date・applied-to も、confidence と同じく、キーの重なりと 1 行で読めない形（値とキーの書き方）を止める。
	# 重なると、このチェックは最後の値を読むが、YAML の実装によってはエラーになるか、別の値を採る。
	# archive のノートには当てない。注入されず書き換えもしない記録なので、下の折り返しのチェックと同じく、
	# 過去の書き方を理由に commit を止めない（アーカイブしたノートの書き方で、関係の無い commit が止まる）。
	key_checks=1
	case "${note}" in
	.kaizen/archive/*) key_checks=0 ;;
	esac
	if ! [[ "${status_count}" =~ ^[0-9]+$ && "${type_count}" =~ ^[0-9]+$ && "${priority_count}" =~ ^[0-9]+$ && "${date_count}" =~ ^[0-9]+$ && "${applied_count}" =~ ^[0-9]+$ ]]; then
		echo "kaizen-status-check: ${note}: could not read the key counts: status=${status_count} type=${type_count} priority=${priority_count} date=${date_count} applied-to=${applied_count}" >&2
		errors=$((errors + 1))
	elif [ "${key_checks}" = "1" ]; then
		for key_count in "status:${status_count}" "type:${type_count}" "priority:${priority_count}" "date:${date_count}" "applied-to:${applied_count}"; do
			if [ "${key_count##*:}" -gt 1 ]; then
				echo "kaizen-status-check: ${note}: ${key_count%:*} is declared ${key_count##*:} times (declare it once)" >&2
				errors=$((errors + 1))
			fi
		done
	fi
	if [ "${key_checks}" = "1" ] && [ -n "${bad_forms}" ]; then
		IFS=',' read -r -a bad_form_list <<<"${bad_forms}"
		for bad_form in "${bad_form_list[@]}"; do
			case "${bad_form##*:}" in
			block) echo "kaizen-status-check: ${note}: ${bad_form%:*} uses a block scalar; write the value on the same line as the key" >&2 ;;
			tag) echo "kaizen-status-check: ${note}: ${bad_form%:*} has a YAML tag; write the plain value without the tag" >&2 ;;
			anchor) echo "kaizen-status-check: ${note}: ${bad_form%:*} uses a YAML anchor or alias; write the plain value" >&2 ;;
			word) echo "kaizen-status-check: ${note}: ${bad_form%:*} is not a plain word (letters, digits, _ and - only); write it without quotes, comments or YAML syntax" >&2 ;;
			date) echo "kaizen-status-check: ${note}: ${bad_form%:*} is not a YYYY-MM-DD date; write it without quotes, comments or YAML syntax" >&2 ;;
			level) echo "kaizen-status-check: ${note}: ${bad_form%:*} is not high, medium or low" >&2 ;;
			explicit) echo "kaizen-status-check: ${note}: uses a YAML explicit key (? key); write it as key: value on one line" >&2 ;;
			item) echo "kaizen-status-check: ${note}: ${bad_form%:*} has an element with a YAML anchor, alias, tag or nested collection; write each element as a plain string" >&2 ;;
			nospace) echo "kaizen-status-check: ${note}: ${bad_form%:*} needs a space after the colon (${bad_form%:*}: <value>)" >&2 ;;
			*) echo "kaizen-status-check: ${note}: ${bad_form%:*} key is quoted, has a space before the colon, or has an anchor or tag; write it as ${bad_form%:*}: <value>" >&2 ;;
			esac
			errors=$((errors + 1))
		done
	fi

	# date は形（YYYY-MM-DD）に加えて、暦の日付として読めるかを確かめる。13 月のような値は、忘却が日数に変換できず、
	# 候補から外したことを報告しないまま pending に残る。形が誤っている値は、上で報告したので重ねない。
	if [ "${key_checks}" = "1" ] && [[ ",${bad_forms}," != *",date:"* ]] && declare -f kaizen_days_from_date >/dev/null 2>&1; then
		if [ -n "${date_value}" ] && ! kaizen_days_from_date "${date_value}" >/dev/null; then
			echo "kaizen-status-check: ${note}: date is not a real calendar date: ${date_value}" >&2
			errors=$((errors + 1))
		fi
	fi

	# confidence は欠けていても通す（欄を足す前に書いたノートには無い）。在るなら 1 回だけ、3 つの値だけを受け付ける。
	# 当てはまる問題はまとめて報告し、直すたびに別の問題で止まり直さないようにする。
	if ! [[ "${conf_count}" =~ ^[0-9]+$ && "${conf_nospace}" =~ ^[01]$ && "${conf_key}" =~ ^[01]$ ]]; then
		# 読み取りの出力の形が変わったときに、検査を飛ばして exit 0 にしない。
		echo "kaizen-status-check: ${note}: could not read the confidence state: count=${conf_count} nospace=${conf_nospace} key=${conf_key}" >&2
		errors=$((errors + 1))
	else
		if [ "${conf_nospace}" = "1" ]; then
			echo "kaizen-status-check: ${note}: confidence needs a space after the colon (confidence: <value>)" >&2
			errors=$((errors + 1))
		fi
		# status・type・applied-to のキーの形のチェックと同じく、archive のノートには当てない（key_checks）。
		if [ "${conf_key}" = "1" ] && [ "${key_checks}" = "1" ]; then
			echo "kaizen-status-check: ${note}: confidence key is quoted, has a space before the colon, or has an anchor or tag; write it as confidence: <value>" >&2
			errors=$((errors + 1))
		fi
		if [ "${conf_count}" -gt 1 ]; then
			echo "kaizen-status-check: ${note}: confidence is declared ${conf_count} times (declare it once)" >&2
			errors=$((errors + 1))
		fi
		# 値は、重なりや空白の問題と並べて確かめる（`frontmatter_state` は、不正な値があればそれをすべて連ねたものを、無ければ最後の値を渡す）。
		if [ "${conf_count}" -ge 1 ]; then
			case "${confidence}" in
			high | medium | low) ;;
			*)
				echo "kaizen-status-check: ${note}: unknown confidence: ${confidence:-<empty>} (expected high, medium or low)" >&2
				errors=$((errors + 1))
				;;
			esac
		fi
	fi

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
				# 判定できないものをそのまま通さない（ループの先頭の frontmatter の読み取りと同じく、ブロックする）。
				# 素通りさせると「検査した」と「検査できなかった」が同じ exit 0 になる。
				# 理由を捨てると直しようがないので、失敗時だけ読み直して awk の診断を添える。
				detail=$(section_lead_state "${lead_section}" "${note}" 2>&1 >/dev/null | tr '\n' ' ') || true
				echo "kaizen-status-check: ${note}: could not inspect the lead paragraph under ${lead_section}: ${detail:-no diagnostics from awk}" >&2
				errors=$((errors + 1))
				;;
			esac
		fi
		# 機構で解決すると宣言した（`type: hook`）のにドキュメントだけで閉じたノートを知らせる。
		# `status: applied` は「対策が済んだ」宣言なので、ここで言わないと
		# 機構が作られないまま閉じ、症状は同じ学びの再発としてしか現れない
		# （実例: 2026-09-08 の `type: hook` なノートが `.md` 3 本で閉じられ、8 日後に
		# 同じ系統が再発して別ノートとして起票された）。
		# archive 配下は履歴なので対象外にする（もう直せない指摘を毎コミット出しても雑音になる）。
		if [ "${status}" = "applied" ] && [[ " ${mechanism_types} " == *" ${type} "* ]] && applied_to_is_docs_only "${entries}"; then
			echo "kaizen-status-check: ${note}: warning: type is ${type} (a mechanism) but applied-to lists documents only; build the mechanism, or change type to match what was actually done" >&2
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
	# 件数の二乗に比例して重くなり、コミット前のチェックの実行時間が延びる。
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
	# 警告は終了コードに入れない（止めるとドキュメントへ寄せる判断を通せなくなる）。
	# 件数だけは出す。1 件ずつの行は他の出力に紛れるので、総数が無いと見落とす。
	echo "kaizen-status-check: ${warnings} warning(s); see the notes above" >&2
fi

if [ "${errors}" -gt 0 ]; then
	# スクリプトは PATH に無いので、そのまま貼れる形で案内する。
	if [ -n "${script_dir}" ]; then
		reindex_cmd="bash \"${script_dir}/kaizen-archive.sh\" --reindex"
	else
		reindex_cmd="バンドルされた kaizen-archive.sh を --reindex 付きで実行"
	fi
	echo "kaizen-status-check: ${errors} problem(s); fix status/type/priority/date/applied-to/confidence or the reported note text, or ${reindex_cmd}" >&2
	exit 2
fi

exit 0
