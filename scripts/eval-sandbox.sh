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
#   4. agent records  — transcripts/memory/installed skills of this and other agents
#                       (the content's secondary store: all of ~/.claude, ~/.codex,
#                       ~/.copilot). ~/.claude is covered wholesale rather than by an
#                       enumerated subdir list: an enumeration cannot detect the route
#                       it forgot, and ~/.claude/skills holds globally installed copies
#                       of the very skill under test.
#
# It also makes $HOME read-only. A baseline can otherwise WRITE outside the
# disposable project: one run rewrote ~/.claude/skills/skill-creator (a vendored
# skill) while "applying" a learning. Only the disposable project stays writable.
#
# USAGE (as the runner override; the wrapper runs the real CLI inside the sandbox):
#   SKILL_EVAL_RUNNER="$PWD/scripts/eval-sandbox.sh" scripts/run-skill-eval.sh --config without_skill ...
#   scripts/eval-sandbox.sh --verify '<marker>' ...   # prove the blocking works first
#
# `--verify` runs the checks the kaizen entry requires: (1) the repo path is gone
# inside the sandbox, (2) grepping for skill-specific markers over the reachable
# filesystem returns nothing — with one sentinel planted per scanned root, so no root
# can be silently unsearched — and (3) $HOME rejects writes, a writable path still
# accepts them (the positive control — without it, "write failed" could just mean the
# probe itself is broken), and the spots deliberately left writable under $HOME do not
# reach the host. Stage 1 alone has missed routes before.
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

# `--chdir` is added per mode at run time: the CLI needs the disposable project as
# cwd, but `--verify` is invoked from this repo — a path that the tmpfs below hides,
# so chdir there would abort bwrap before any check runs.
args=(--dev-bind / / --die-with-parent)

# 0. $HOME read-only, so nothing the run does escapes into the user's environment.
#    This must precede every mount under $HOME: bwrap applies operations in order,
#    and the tmpfs mounts below are what make the few needed spots writable again.
args+=(--ro-bind "${home}" "${home}")
# The CLI writes its own state to ~/.claude.json at startup, so give it a throwaway
# one. It must NOT be a copy of the real file: that file records per-project history
# and allowed tools — `--verify` caught a skill's own hook script name in there — plus
# account identifiers. `{}` is the minimum the CLI accepts (an empty file aborts as
# "corrupted"). `mktemp` lands in /tmp, resolved here on the host before the /tmp
# tmpfs below hides it inside the sandbox.
scratch_state="$(mktemp)"
trap 'rm -f -- "${scratch_state}"' EXIT
printf '{}\n' >"${scratch_state}"
args+=(--bind "${scratch_state}" "${home}/.claude.json")

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

# 4. agent records: conversation transcripts, memory, plans, task state and history
#    restate skill content verbatim, and ~/.claude/skills holds globally installed
#    copies of the skill under test. One tmpfs over the whole directory beats listing
#    subdirs — a list cannot detect the entry it forgot, and this doubles as the
#    writable scratch the CLI needs under a read-only $HOME. Only what the CLI needs
#    to start is bound back, read-only.
args+=(--tmpfs "${home}/.claude")
# settings.json / .credentials.json: the CLI needs them to start. CLAUDE.md: the
# user-global instruction file is NOT skill content, and hiding it from baselines
# only would make the two configurations differ by more than the skill under test.
# Reopening that route is guarded — `--verify` scans $HOME, so a CLAUDE.md that did
# restate skill content would surface as a marker hit.
for f in settings.json .credentials.json CLAUDE.md; do
	[ -e "${home}/.claude/${f}" ] && args+=(--ro-bind "${home}/.claude/${f}" "${home}/.claude/${f}")
done
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
	# (path enumeration cannot detect routes missing from the enumeration), with a
	# sentinel per root so an unsearched root cannot pass as a clean one.
	# Stage 3: $HOME must reject writes, a writable path must still accept them —
	# the positive control, without which a broken probe reads as containment — and
	# writes to the spots left writable under $HOME must not land on the host (that
	# last leg is checked by this shell after bwrap exits; from inside the sandbox a
	# tmpfs and a host bind are indistinguishable).
	markers=("$@")
	# Stage 2 roots: /mnt/wslg and /mnt/c are already tmpfs above, so only /mnt/wsl
	# stays reachable (skipped when absent — a missing root must not look like a
	# scanned one). Package/tool caches are excluded to keep the scan bounded and are
	# printed so the gap is visible rather than silent.
	# A killed scan must never read as "clean": the full scan measured ~85s on this
	# machine, so the budget is 600s and a timeout is reported as FAIL. `grep` rc 2
	# (unreadable paths) is not a failure — what this user cannot read, the run cannot
	# read either — but the rc is surfaced in the result line so the partial scan is
	# visible (stderr is discarded, so the unreadable paths themselves are not listed).
	# shellcheck disable=SC2016 # deliberate: $HOME / $1 / $m must expand inside the sandboxed shell, not here
	script='set -u -o pipefail; rc=0
printf "stage1 repo listing: "; if ls -A "$1" 2>/dev/null | grep -q .; then echo "REACHABLE (FAIL)"; rc=1; else echo "empty/absent (ok)"; fi
shift
excludes="--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=_cacache --exclude-dir=versions --exclude-dir=mise"
roots=("$HOME" /tmp)
[ -d /mnt/wsl ] && roots+=(/mnt/wsl)
echo "stage2 roots: ${roots[*]} (excluded: .git node_modules _cacache versions mise; /mnt/winsys not scanned)"
# Positive control: plant a sentinel in EVERY scanned root and require each one to be
# found. "No marker found" and "this root was never traversed" are the same output, so
# one control in /tmp would leave the $HOME leg unproven — and $HOME is where the agent
# records live and the leg that reports grep rc=2 (unreadable paths). A control inside
# the blocked set would prove nothing. $HOME itself is read-only here, so its sentinel
# goes under ~/.claude, the tmpfs that keeps it writable.
controls=()
for r in "${roots[@]}"; do
  if [ "$r" = "$HOME" ]; then p="$HOME/.claude/.eval-sandbox-stage2-control"; else p="$r/.eval-sandbox-stage2-control"; fi
  if printf "SENTINEL-EVAL-SANDBOX-STAGE2\n" >"$p" 2>/dev/null; then controls+=("$r|$p"); else controls+=("$r|"); fi
done
for c in "${controls[@]}"; do
  r="${c%%|*}"; p="${c#*|}"
  printf "stage2 positive control %s: " "$r"
  if [ -z "$p" ]; then echo "NOT PLANTED (FAIL: cannot prove this root is searchable)"; rc=1; continue; fi
  timeout 600 grep -rlIqF $excludes -e "SENTINEL-EVAL-SANDBOX-STAGE2" "$r" 2>/dev/null; cs=$?
  if [ "$cs" -eq 0 ]; then echo "sentinel found (ok)"
  elif [ "$cs" -ge 124 ]; then echo "TIMED OUT (FAIL: control scan incomplete after 600s; results for this root are meaningless)"; rc=1
  else echo "SENTINEL NOT FOUND (FAIL: this root is not being searched; its results below are meaningless)"; rc=1; fi
done
for c in "${controls[@]}"; do p="${c#*|}"; [ -n "$p" ] && rm -f "$p"; done
for m in "$@"; do
  printf "stage2 marker %s: " "$m"
  hits="$(timeout 600 grep -rlIF $excludes -e "$m" "${roots[@]}" 2>/dev/null | head -5)"; gs=$?
  if [ -n "$hits" ]; then echo "FOUND (FAIL)"; echo "$hits" | sed "s/^/    /"; rc=1
  elif [ "$gs" -ge 124 ]; then echo "TIMED OUT (FAIL: scan incomplete after 600s; rerun or narrow the roots)"; rc=1
  elif [ "$gs" -gt 1 ]; then echo "not found (ok; grep rc=$gs — some paths unreadable)"
  else echo "not found (ok)"; fi
done
printf "stage3 positive control (/tmp write): "
if probe="$(mktemp /tmp/eval-sandbox-probe-XXXXXX 2>/dev/null)"; then echo "writable (ok)"; rm -f "$probe"
else echo "FAILED (the write probe itself does not work; stage3 result below means nothing)"; rc=1; fi
printf "stage3 \$HOME write: "
if touch "$HOME/.eval-sandbox-write-probe" 2>/dev/null; then echo "WRITABLE (FAIL)"; rm -f "$HOME/.eval-sandbox-write-probe"; rc=1
else echo "rejected (ok)"; fi
# ~/.claude stays writable on purpose (the CLI needs scratch), and it is exactly where
# the run that escaped last time wrote (~/.claude/skills/skill-creator). A read-only
# $HOME says nothing about it, and from in here a tmpfs and a host bind look the same,
# so plant a marker and let the parent shell check the host path after bwrap exits.
printf "stage3 ~/.claude write containment: "
if : >"$HOME/.claude/.eval-sandbox-escape-probe" 2>/dev/null; then echo "probe planted (parent checks the host)"
else echo "NOT PLANTED (FAIL: ~/.claude must stay writable, and containment is unproven)"; rc=1; fi
exit $rc'
	rc=0
	bwrap "${args[@]}" --chdir / -- /bin/bash -c "${script}" _ "${repo}" "${markers[@]}" || rc=$?
	# Negative half of the containment check: the probe planted inside must not exist
	# on the host. A missing probe here only counts once the inner half reported
	# "probe planted" (it sets rc=1 otherwise), so "absent" cannot mean "never written".
	escape_probe="${home}/.claude/.eval-sandbox-escape-probe"
	printf "stage3 host leak check (~/.claude): "
	if [ -e "${escape_probe}" ]; then
		echo "LEAKED (FAIL: writes under ~/.claude reach the host)"
		rm -f -- "${escape_probe}"
		rc=1
	else
		echo "no leak (ok)"
	fi
	exit "${rc}"
fi

[ "$#" -ge 1 ] || {
	echo "usage: $0 <cli-args...>   (or: $0 --verify <marker>...)" >&2
	exit 2
}

# `run-skill-eval.sh` substitutes this script for the CLI *name* and passes only the
# CLI's arguments (`-p <prompt> --output-format json ...`), so the binary has to be
# prepended here. EVAL_SANDBOX_CLI allows a stub for smoke tests.
# Not `exec`: the EXIT trap has to survive the run to delete the throwaway state file.
cli="${EVAL_SANDBOX_CLI:-claude}"
rc=0
bwrap "${args[@]}" --chdir "${PWD}" -- "${cli}" "$@" || rc=$?
exit "${rc}"
