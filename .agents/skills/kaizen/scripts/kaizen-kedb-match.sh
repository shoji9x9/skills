#!/usr/bin/env bash
# Deterministic KEDB lookup for kaizen notes.
# Top-level notes are searched in full; archived note bodies are never searched.
# Every supplied fixed-string keyword must match the same note or index entry.
set -euo pipefail

if [ "$#" -lt 2 ]; then
	echo "usage: kaizen-kedb-match.sh <event-keyword> <tool-or-path-keyword> [keyword ...]" >&2
	exit 2
fi
for keyword in "$@"; do
	if [ -z "${keyword}" ]; then
		echo "kaizen-kedb-match: keywords must not be empty" >&2
		exit 2
	fi
done

project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

[ -d .kaizen ] || exit 1

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

matches() {
	local haystack=$1
	local keyword
	for keyword in "${@:2}"; do
		grep -Fiq -- "${keyword}" <<<"${haystack}" || return 1
	done
	return 0
}

file_matches() {
	local file=$1
	local keyword
	local rc
	for keyword in "${@:2}"; do
		if grep -Fiq -- "${keyword}" "${file}"; then
			continue
		else
			rc=$?
			[ "${rc}" -gt 1 ] && return 2
			return 1
		fi
	done
	return 0
}

hit=0
for note in .kaizen/*.md; do
	[ -e "${note}" ] || continue
	if file_matches "${note}" "$@"; then
		status=$(frontmatter_field "${note}" status)
		printf '%s\tstatus=%s\n' "${note}" "${status:-unknown}"
		hit=1
	else
		rc=$?
		if [ "${rc}" -gt 1 ]; then
			echo "kaizen-kedb-match: failed to search ${note}" >&2
			exit 2
		fi
	fi
done

index=.kaizen/archive/INDEX.md
if [ -f "${index}" ]; then
	while IFS= read -r line; do
		case "${line}" in
		'- `'*'.md` — '*) ;;
		*) continue ;;
		esac
		if matches "${line}" "$@"; then
			base=${line#*- \`}
			base=${base%%\`*}
			metadata=${line#* — }
			metadata=${metadata%% — *}
			status=$(sed -n 's/.*status:[[:space:]]*\([^ ]*\).*/\1/p' <<<"${metadata}")
			printf '%s\tstatus=%s\n' ".kaizen/archive/${base}" "${status:-unknown}"
			hit=1
		fi
	done <"${index}"
fi

[ "${hit}" -eq 1 ] && exit 0
exit 1
