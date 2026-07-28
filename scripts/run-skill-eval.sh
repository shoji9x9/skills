#!/usr/bin/env bash
# Dev-only: run ONE skill eval prompt in an isolated, disposable empty project so
# the eval's file mutations never touch this repo. Used to build regression
# benchmarks (see docs/skill-development.md "回帰テストを実行する").
#
# WHY a launcher-fixed cwd instead of telling an agent to `cd /tmp`:
#   A coding agent's Bash tool does NOT persist `cd` across separate tool calls
#   (the shell cwd resets to the project root each call), and relative-path file
#   ops resolve against the agent's base dir. So instructing a subagent to "work
#   in /tmp" lets the skill's relative-path steps (`mkdir .agents/...`, `ln -s`)
#   land in THIS repo. Here the cwd is fixed by the launcher within a single
#   shell invocation: `claude -p` runs with cwd = the temp project, so the nested
#   session's project root (and every cwd reset) stays inside it.
#
# This script is repo-internal tooling and is NOT bundled in any distributed skill.
#
# PRECONDITIONS: the disposable project is empty, un-trusted and non-interactive.
# mise shims (python3/node/jq) fail "No version is set" when un-trusted; gh/git
# skills have no repo context (use real PR/Issue numbers, not fake ones); and a
# headless `claude -p` has no responder for AskUserQuestion. Give prompts whose
# intent is unambiguous and ensure skills degrade gracefully. See
# docs/skill-development.md "eval 環境の前提（runtime / repo / 非対話）".
set -euo pipefail

usage() {
	echo "Usage: $0 --skill <name> --prompt <text> --config <with_skill|without_skill> --out <dir> [--model <model>] [--repo <path>] [--fixture <dir>]" >&2
	exit 2
}

skill="" prompt="" config="" out="" model="" repo="" fixture=""
while [ "$#" -gt 0 ]; do
	case "$1" in
	--skill)
		skill="$2"
		shift 2
		;;
	--prompt)
		prompt="$2"
		shift 2
		;;
	--config)
		config="$2"
		shift 2
		;;
	--out)
		out="$2"
		shift 2
		;;
	--model)
		model="$2"
		shift 2
		;;
	--repo)
		repo="$2"
		shift 2
		;;
	--fixture)
		fixture="$2"
		shift 2
		;;
	*) usage ;;
	esac
done
[ -n "$skill" ] && [ -n "$prompt" ] && [ -n "$config" ] && [ -n "$out" ] || usage
case "$config" in
with_skill | without_skill) ;;
*)
	echo "config must be with_skill|without_skill" >&2
	exit 2
	;;
esac
# --skill is used to build filesystem paths (src and the mktemp template), so
# restrict it to kebab-case up front to avoid path traversal (/, ..) or values
# starting with - being read as options.
case "$skill" in
-* | *[!a-z0-9-]*)
	echo "invalid --skill (expected kebab-case: a-z, 0-9, -): ${skill}" >&2
	exit 2
	;;
esac

# Resolve repo lazily: only fall back to the current git worktree when --repo
# wasn't given, so the script still works outside a worktree if --repo is set.
[ -n "${repo}" ] || repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "${repo}" ] || {
	echo "not in a git worktree; pass --repo <path>" >&2
	exit 2
}

src="${repo}/skills/${skill}"
[ -f "${src}/SKILL.md" ] || {
	echo "skill source not found: ${src}/SKILL.md" >&2
	exit 1
}

# Disposable empty project under /tmp. Its parents hold no .claude/skills, so a
# without_skill run sees no skills at all (honest baseline); a with_skill run
# only sees the one we install below.
proj="$(mktemp -d "/tmp/skill-eval-${skill}-XXXXXX")"
trap 'rm -rf -- "${proj}"' EXIT

# Optional fixture: seed the disposable project with a prepared state (config,
# .replace/ artifacts, etc.) so normal-path evals can exercise behavior beyond
# "stop on missing prerequisites". The fixture is copied, never mutated.
if [ -n "${fixture}" ]; then
	[ -d "${fixture}" ] || {
		echo "fixture dir not found: ${fixture}" >&2
		exit 1
	}
	cp -R -- "${fixture}/." "${proj}/"
fi

if [ "${config}" = "with_skill" ]; then
	mkdir -p -- "${proj}/.claude/skills"
	cp -R -- "${src}" "${proj}/.claude/skills/${skill}"
fi

mkdir -p -- "${out}"

# Headless run with cwd fixed to the disposable project (cd holds within this one
# invocation). --dangerously-skip-permissions is acceptable: the target is a
# throwaway /tmp dir, never this repo.
# SKILL_EVAL_RUNNER overrides the executable (default `claude`) so isolation can
# be smoke-tested with a stub without spawning a real agent.
runner="${SKILL_EVAL_RUNNER:-claude}"

# Headless eval has no one to answer interactive prompts (AskUserQuestion errors
# under `claude -p`). Inject a non-interactive notice here so the agent degrades
# gracefully — this keeps the eval-only instruction out of the distributed skills.
noninteractive_preamble='【非対話の自動評価環境】AskUserQuestion 等の対話確認ツールは使えません。確認が必要でも質問で停止せず続行しますが、破壊的・外向きの操作（commit / push / マージ / リモートへの書き込み等）は行わず、最も安全な非破壊のデフォルトを選び、採用した仮定を冒頭に明示してください。'
prompt="${noninteractive_preamble}

${prompt}"

claude_args=(-p "${prompt}" --output-format json --dangerously-skip-permissions)
[ -n "${model}" ] && claude_args+=(--model "${model}")

rc=0
(cd "${proj}" && "${runner}" "${claude_args[@]}") >"${out}/result.json" 2>"${out}/stderr.log" || rc=$?
[ "${rc}" -ne 0 ] && echo "warn: claude exited ${rc} (see ${out}/stderr.log)" >&2

# Snapshot the paths and bounded text contents created in the isolated project.
# Do not copy the project itself into tests/; repo clones and generated files can
# be large. The content snapshot keeps only lightweight files needed for grading.
(cd "${proj}" && find . \( -path "*/.git" -o -path "*/node_modules" -o -path "./.claude/skills" \) -prune -o -print | sort) >"${out}/project-tree.txt"
snapshot_dir="${out}/project-files"
skipped_log="${out}/project-files-skipped.txt"
rm -rf -- "${snapshot_dir}"
mkdir -p -- "${snapshot_dir}"
# Record files that matched the snapshot extensions but still did not make it in
# (size caps, unreadable, copy failure). Many eval assertions read "<path> is
# absent from project-files" as "the skill did not create it"; without this log a
# capped-out file is indistinguishable from one that was never written and the
# grading silently goes wrong. Always created: 0 lines means nothing was dropped.
: >"${skipped_log}"

total_bytes=0
max_file_bytes=$((256 * 1024))
max_total_bytes=$((5 * 1024 * 1024))
while IFS= read -r -d '' file; do
	rel="${file#./}"
	case "${rel}" in
	.git/* | .claude/skills/* | node_modules/* | pnpm-lock.yaml | package-lock.json | yarn.lock)
		continue
		;;
	# .ts / .tsx / .sql are the languages the replace-strategy skill family writes
	# into the target project (golden-dataset の投入ツール〈typescript | sql〉,
	# parity-suite の Playwright スイート・ロケータマッピング, parity-replace の新側実装).
	# Assertions name those files directly, so they must be gradable from the snapshot.
	*.md | *.txt | *.json | *.yml | *.yaml | *.toml | *.sh | *.js | *.mjs | *.ts | *.tsx | *.sql)
		;;
	*)
		continue
		;;
	esac

	# The agent may leave unreadable or vanishing files behind; under `set -e` a
	# failed wc/cp here would kill the whole run after the expensive eval, so skip
	# the file and keep snapshotting instead.
	size="$(wc -c 2>/dev/null <"${proj}/${rel}")" || {
		printf '%s\tunreadable\n' "${rel}" >>"${skipped_log}"
		continue
	}
	size="${size//[[:space:]]/}"
	if [ "${size}" -gt "${max_file_bytes}" ]; then
		printf '%s\tover-per-file-cap (%s B > %s B)\n' "${rel}" "${size}" "${max_file_bytes}" >>"${skipped_log}"
		continue
	fi
	# Skip rather than break: find's traversal order is arbitrary, so stopping at
	# the first file that would exceed the total cap can drop small
	# grading-critical artifacts that merely came later in the walk.
	if [ $((total_bytes + size)) -gt "${max_total_bytes}" ]; then
		printf '%s\tover-total-cap (total %s B)\n' "${rel}" "${total_bytes}" >>"${skipped_log}"
		continue
	fi
	mkdir -p -- "${snapshot_dir}/$(dirname -- "${rel}")"
	cp -- "${proj}/${rel}" "${snapshot_dir}/${rel}" || {
		printf '%s\tcopy-failed\n' "${rel}" >>"${skipped_log}"
		continue
	}
	total_bytes=$((total_bytes + size))
done < <(cd "${proj}" && find . \( -path "*/.git" -o -path "*/node_modules" -o -path "./.claude/skills" \) -prune -o -type f -print0)

echo "done: config=${config} skill=${skill} -> ${out} (rc=${rc})"
exit "${rc}"
