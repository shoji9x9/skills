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
set -euo pipefail

usage() {
	echo "Usage: $0 --skill <name> --prompt <text> --config <with_skill|without_skill> --out <dir> [--model <model>] [--repo <path>]" >&2
	exit 2
}

skill="" prompt="" config="" out="" model="" repo=""
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

if [ "${config}" = "with_skill" ]; then
	mkdir -p "${proj}/.claude/skills"
	cp -R -- "${src}" "${proj}/.claude/skills/${skill}"
fi

mkdir -p "${out}"

# Headless run with cwd fixed to the disposable project (cd holds within this one
# invocation). --dangerously-skip-permissions is acceptable: the target is a
# throwaway /tmp dir, never this repo.
# SKILL_EVAL_RUNNER overrides the executable (default `claude`) so isolation can
# be smoke-tested with a stub without spawning a real agent.
runner="${SKILL_EVAL_RUNNER:-claude}"
claude_args=(-p "${prompt}" --output-format json --dangerously-skip-permissions)
[ -n "${model}" ] && claude_args+=(--model "${model}")

rc=0
(cd "${proj}" && "${runner}" "${claude_args[@]}") >"${out}/result.json" 2>"${out}/stderr.log" || rc=$?
[ "${rc}" -ne 0 ] && echo "warn: claude exited ${rc} (see ${out}/stderr.log)" >&2

# Snapshot what the eval created in the isolated project (the installed skill copy
# is excluded so only eval artifacts remain for grading).
(cd "${proj}" && find . -path ./.claude/skills -prune -o -print | sort) >"${out}/project-tree.txt"
mkdir -p "${out}/project"
cp -R -- "${proj}/." "${out}/project/"
rm -rf -- "${out}/project/.claude/skills"

echo "done: config=${config} skill=${skill} -> ${out} (rc=${rc})"
exit "${rc}"
