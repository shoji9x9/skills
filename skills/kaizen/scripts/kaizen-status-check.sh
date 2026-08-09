#!/usr/bin/env bash
# kaizen lifecycle status checker
#
# 学びの適用先宣言（applied-to）と status、アーカイブ索引の整合を検査する。
# 不整合は exit 2 + stderr で返し、kaizen-precommit-gate.sh から commit を止める。
set -euo pipefail

project_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
[ -n "${project_root}" ] && cd "${project_root}" 2>/dev/null || true

[ -d .kaizen ] || exit 0

errors=0

frontmatter_state() {
	awk '
		BEGIN { fm = 0; present = 0; nonempty = 0; status = ""; in_applied = 0 }
		/^---[[:space:]]*$/ {
			fm++
			if (fm == 2) {
				printf "%s|%s|%s\n", status, present, nonempty
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
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			if (value != "" && value != "[]" && value != "null" && value != "~") nonempty = 1
			in_applied = 1
			next
		}
		in_applied && /^[[:space:]]+-[[:space:]]*[^[:space:]]/ { nonempty = 1; next }
		/^[[:alnum:]_-]+:[[:space:]]*/ { in_applied = 0 }
		END {
			if (fm < 2) printf "%s|%s|%s\n", status, present, nonempty
		}
	' "$1"
}

for note in .kaizen/*.md .kaizen/archive/*.md; do
	[ -e "${note}" ] || continue
	[ "$(basename "${note}")" = "INDEX.md" ] && continue
	state=$(frontmatter_state "${note}")
	IFS='|' read -r status present nonempty <<<"${state}"

	# applied-to が無い旧形式は後方互換のため検査対象外。新形式としてフィールドを
	# 宣言したノートだけを厳密に検査する。
	[ "${present}" = "1" ] || continue
	if [ "${status}" = "pending" ] && [ "${nonempty}" = "1" ]; then
		echo "kaizen-status-check: ${note}: applied-to is set but status is pending" >&2
		errors=$((errors + 1))
	elif { [ "${status}" = "applied" ] || [ "${status}" = "rejected" ]; } && [ "${nonempty}" = "0" ]; then
		echo "kaizen-status-check: ${note}: status is ${status} but applied-to is empty" >&2
		errors=$((errors + 1))
	fi
done

archive_dir=.kaizen/archive
index_file=${archive_dir}/INDEX.md
if [ -d "${archive_dir}" ]; then
	for note in "${archive_dir}"/*.md; do
		[ -e "${note}" ] || continue
		[ "$(basename "${note}")" = "INDEX.md" ] && continue
		base=$(basename "${note}")
		entry_count=0
		if [ -f "${index_file}" ]; then
			# shellcheck disable=SC2016 # sed の backtick と後方参照はリテラル。
			entry_count=$(sed -n 's/^- `\([^`]*\.md\)` .*$/\1/p' "${index_file}" | awk -v target="${base}" '$0 == target { count++ } END { print count + 0 }')
		fi
		if [ "${entry_count}" -ne 1 ]; then
			echo "kaizen-status-check: ${note}: expected exactly one entry in ${index_file}, found ${entry_count}" >&2
			errors=$((errors + 1))
		fi
	done

	if [ -f "${index_file}" ]; then
		# shellcheck disable=SC2016 # sed の backtick と後方参照はリテラル。
		while IFS= read -r base; do
			[ -n "${base}" ] || continue
			if [ ! -f "${archive_dir}/${base}" ]; then
				echo "kaizen-status-check: ${index_file}: stale entry for ${base}" >&2
				errors=$((errors + 1))
			fi
		done < <(sed -n 's/^- `\([^`]*\.md\)` .*$/\1/p' "${index_file}")
	fi
fi

if [ "${errors}" -gt 0 ]; then
	echo "kaizen-status-check: ${errors} lifecycle inconsistency(s); update status/applied-to or run kaizen-archive.sh --reindex" >&2
	exit 2
fi

exit 0
