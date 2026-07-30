#!/usr/bin/env bash
# Dev-only: read-isolation wrapper for skill-eval baselines (`--config without_skill`).
#
# WHY: `run-skill-eval.sh` isolates cwd and skill installation, but `claude -p` can
# still read any path on the machine and find this repo's skill sources from the
# skill name in the prompt. Every such run makes the baseline satisfy skill-specific
# assertions, and the measured Delta becomes meaningless
# (.kaizen/2026-07-28-eval-baseline-read-contamination.md — 5 recurrences).
#
# The blocked set is NOT "the repo path". It is every route that reaches the skill
# CONTENT, in 4 groups (each group was found by an actual contaminated run):
#   1. work tree      — this repo (and sibling projects with installed copies)
#   2. sibling runs   — /tmp, where a parallel with_skill run holds a full copy
#   3. OS mirrors     — WSL bind mounts that expose the same tree again
#   4. agent records  — transcripts/memory of this and other agents (the content's
#                       secondary store: ~/.claude/projects, ~/.codex, ~/.copilot)
#
# USAGE (as the runner override; the wrapper execs the real CLI inside the sandbox):
#   SKILL_EVAL_RUNNER="$PWD/scripts/eval-sandbox.sh" scripts/run-skill-eval.sh --config without_skill ...
#   scripts/eval-sandbox.sh --verify '<marker>' ...   # prove the blocking works first
#
# `--verify` runs the 2-stage check the kaizen entry requires: (1) the repo path is
# gone inside the sandbox, and (2) grepping for skill-specific markers over the
# reachable filesystem returns nothing. Stage 1 alone has missed routes before.
#
# Repo-internal tooling; not bundled in any distributed skill.
set -euo pipefail

self="$(readlink -f "$0")"
repo="$(dirname "$(dirname "${self}")")"
repo_parent="$(dirname "${repo}")"
home="${HOME:?HOME must be set}"

command -v bwrap >/dev/null 2>&1 || {
	echo "eval-sandbox: bwrap not found; cannot isolate reads. Install bubblewrap or record the run as UNISOLATED." >&2
	exit 3
}

# `--chdir` is added per mode at exec time: the CLI needs the disposable project as
# cwd, but `--verify` is invoked from this repo — a path that the tmpfs below hides,
# so chdir there would abort bwrap before any check runs.
args=(--dev-bind / / --die-with-parent)

# 1. work tree: hide this repo and every sibling project (installed copies of the
#    skill under .agents/.claude carry older revisions — a worse-than-useless baseline).
args+=(--tmpfs "${repo_parent}")

# 2. sibling runs: /tmp holds other configurations' disposable projects, each a full
#    copy of the skill. Keep only our own project (bind AFTER the tmpfs so it wins).
case "${PWD}" in
/tmp/*) args+=(--tmpfs /tmp --bind "${PWD}" "${PWD}") ;;
*) args+=(--tmpfs /tmp) ;;
esac

# 3. OS mirrors: WSL exposes the same home under /mnt/wslg and Windows drives under
#    /mnt/c. Never cover /mnt itself — /etc/resolv.conf -> /mnt/wsl/resolv.conf would
#    break and the run dies with `API Error: ENOTIMP`.
for d in /mnt/wslg /mnt/c; do
	[ -e "${d}" ] && args+=(--tmpfs "${d}")
done

# 4. agent records: conversation transcripts, memory, plans and task state restate
#    skill content verbatim. Keep what the CLI needs to start
#    (settings.json / .credentials.json / plugins / skills / session-env).
for d in projects sessions file-history shell-snapshots plans tasks paste-cache backups downloads cache jobs telemetry; do
	[ -e "${home}/.claude/${d}" ] && args+=(--tmpfs "${home}/.claude/${d}")
done
# `--dev-bind` (not `--ro-bind`): every other bind is mounted `nodev`, which turns a
# bound /dev/null into an unopenable file (EACCES) instead of an empty one.
[ -e "${home}/.claude/history.jsonl" ] && args+=(--dev-bind /dev/null "${home}/.claude/history.jsonl")
for d in "${home}/.codex" "${home}/.copilot" "${home}/.agents" "${home}/.vscode-server"; do
	[ -e "${d}" ] && args+=(--tmpfs "${d}")
done

if [ "${1:-}" = "--verify" ]; then
	shift
	[ "$#" -ge 1 ] || {
		echo "usage: $0 --verify <marker> [<marker>...]" >&2
		exit 2
	}
	# Stage 1: the repo must be unreachable. Stage 2: no marker anywhere reachable
	# (path enumeration cannot detect routes missing from the enumeration).
	markers=("$@")
	# Stage 2 roots: /mnt/wslg and /mnt/c are already tmpfs above, so only /mnt/wsl
	# stays reachable (skipped when absent — a missing root must not look like a
	# scanned one). Package/tool caches are excluded to keep the scan bounded and are
	# printed so the gap is visible rather than silent.
	# A killed scan must never read as "clean": the full scan measured ~85s on this
	# machine, so the budget is 600s and a timeout is reported as FAIL. `grep` rc 2
	# (unreadable paths) is not a failure — what this user cannot read, the run cannot
	# read either — but it is printed.
	# shellcheck disable=SC2016 # deliberate: $HOME / $1 / $m must expand inside the sandboxed shell, not here
	script='set -u -o pipefail; rc=0
printf "stage1 repo listing: "; if ls -A "$1" 2>/dev/null | grep -q .; then echo "REACHABLE (FAIL)"; rc=1; else echo "empty/absent (ok)"; fi
shift
excludes="--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=_cacache --exclude-dir=versions --exclude-dir=mise"
roots=("$HOME" /tmp)
[ -d /mnt/wsl ] && roots+=(/mnt/wsl)
echo "stage2 roots: ${roots[*]} (excluded: .git node_modules _cacache versions mise; /mnt/winsys not scanned)"
for m in "$@"; do
  printf "stage2 marker %s: " "$m"
  hits="$(timeout 600 grep -rlI $excludes -e "$m" "${roots[@]}" 2>/dev/null | head -5)"; gs=$?
  if [ -n "$hits" ]; then echo "FOUND (FAIL)"; echo "$hits" | sed "s/^/    /"; rc=1
  elif [ "$gs" -ge 124 ]; then echo "TIMED OUT (FAIL: scan incomplete after 600s; rerun or narrow the roots)"; rc=1
  elif [ "$gs" -gt 1 ]; then echo "not found (ok; grep rc=$gs — some paths unreadable)"
  else echo "not found (ok)"; fi
done
exit $rc'
	exec bwrap "${args[@]}" --chdir / -- /bin/bash -c "${script}" _ "${repo}" "${markers[@]}"
fi

[ "$#" -ge 1 ] || {
	echo "usage: $0 <cli-args...>   (or: $0 --verify <marker>...)" >&2
	exit 2
}

# `run-skill-eval.sh` substitutes this script for the CLI *name* and passes only the
# CLI's arguments (`-p <prompt> --output-format json ...`), so the binary has to be
# prepended here. EVAL_SANDBOX_CLI allows a stub for smoke tests.
cli="${EVAL_SANDBOX_CLI:-claude}"
exec bwrap "${args[@]}" --chdir "${PWD}" -- "${cli}" "$@"
