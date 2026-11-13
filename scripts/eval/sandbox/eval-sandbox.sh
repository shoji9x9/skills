#!/usr/bin/env bash
# Dev-only: read-isolation wrapper for skill-eval baselines (`--config without_skill`).
#
# WHY: `run-skill-eval.sh` isolates cwd and skill installation, but `claude -p` can
# still read any path on the machine and find this repo's skill sources from the
# skill name in the prompt. Every such run makes the baseline satisfy skill-specific
# assertions, and the measured Delta becomes meaningless (this happened 5 times).
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
# And it hides the user's credentials (Issue #1008). $HOME starts as an empty
# tmpfs and only the places the CLIs and tools need to start are bound back
# (home_allow below). Hiding an enumerated list of credential stores was rejected:
# a run could read ~/.config/box/refresh_token, and a list cannot detect the next
# tool's store. With the allowlist, a forgotten place surfaces as a start-up
# failure instead of a token in the model input and in raw/. The keyring daemon
# serves ~/.local/share/keyrings over the session bus, so the runtime dir that holds
# the bus and the agent sockets is hidden too.
#
# USAGE (as the runner override; the wrapper runs the real CLI inside the sandbox):
#   SKILL_EVAL_RUNNER="$PWD/scripts/eval/sandbox/eval-sandbox.sh" scripts/eval/run/run-skill-eval.sh --config without_skill ...
#   scripts/eval/sandbox/eval-sandbox.sh --verify '<marker>' ...   # prove the blocking works first
#
# `--verify` runs the checks the kaizen entry requires: (1) the repo path is gone
# inside the sandbox, (2) grepping for skill-specific markers over the reachable
# filesystem returns nothing — with one sentinel planted per scanned root, so no root
# can be silently unsearched — and (3) $HOME rejects writes, a writable path still
# accepts them (the positive control — without it, "write failed" could just mean the
# probe itself is broken), and the spots deliberately left writable under $HOME do not
# reach the host. Stage 1 alone has missed routes before. Stage 4 checks the network,
# and (5) every host path under $HOME outside the allowlist is absent while every
# path bound back is readable, and the runtime dir and agent socket variables are gone.
#
# Repo-internal tooling; not bundled in any distributed skill.
set -euo pipefail

self="$(readlink -f "$0")"
# <repo>/scripts/eval/sandbox/eval-sandbox.sh -> <repo>
repo="$(dirname "$(dirname "$(dirname "$(dirname "${self}")")")")"
repo_parent="$(dirname "${repo}")"
# Resolved: bwrap cannot mount a tmpfs onto a symlinked $HOME, and paths resolved with
# readlink -f (the CLI) must be spelled the same way as the mount targets.
home="$(realpath -m -- "${HOME:?HOME must be set}")"
cli="${EVAL_SANDBOX_CLI:-claude}"
vendor="${EVAL_SANDBOX_VENDOR:-}"
if [ -z "${vendor}" ]; then
	case "$(basename -- "${cli}")" in
	codex) vendor="codex" ;;
	claude | claude-code) vendor="claude-code" ;;
	*)
		echo "eval-sandbox: EVAL_SANDBOX_VENDOR is required when the CLI is a wrapper: ${cli}" >&2
		exit 3
		;;
	esac
fi
case "${vendor}" in
claude-code | codex) ;;
*)
	echo "eval-sandbox: unsupported EVAL_SANDBOX_VENDOR: ${vendor}" >&2
	exit 3
	;;
esac
codex_home_raw="${CODEX_HOME:-${home}/.codex}"
codex_home="$(realpath -m -- "${codex_home_raw}")"
codex_auth="${codex_home}/auth.json"
if [ "${vendor}" = "codex" ] && [ ! -d "${codex_home}" ]; then
	echo "eval-sandbox: CODEX_HOME does not exist: ${codex_home}" >&2
	exit 3
fi
cli_launcher="$(type -P -- "${cli}" 2>/dev/null || true)"
[ -n "${cli_launcher}" ] && [ -f "${cli_launcher}" ] && [ -x "${cli_launcher}" ] || {
	echo "eval-sandbox: CLI not found: ${cli}" >&2
	exit 3
}
cli_real="$(readlink -f -- "${cli_launcher}" 2>/dev/null || true)"
[ -n "${cli_real}" ] && [ -f "${cli_real}" ] && [ -x "${cli_real}" ] || {
	echo "eval-sandbox: CLI not found: ${cli}" >&2
	exit 3
}

command -v bwrap >/dev/null 2>&1 || {
	echo "eval-sandbox: bwrap not found; cannot isolate reads. Install bubblewrap or record the run as UNISOLATED." >&2
	exit 3
}

# `--chdir` is added per mode at run time: the CLI needs the disposable project as
# cwd, but `--verify` is invoked from this repo — a path that the tmpfs below hides,
# so chdir there would abort bwrap before any check runs.
args=(--dev-bind / / --die-with-parent)
[ "${vendor}" = "codex" ] && args+=(--setenv CODEX_HOME "${codex_home}")

scratch_state="$(mktemp)"
scratch_settings=""
scratch_etc=""
host_etc_mount=""
home_lists=""
probe_out=""
# shellcheck disable=SC2329 # invoked by the EXIT trap below
cleanup() {
	rm -f -- "${scratch_state}"
	[ -z "${scratch_settings}" ] || rm -f -- "${scratch_settings}"
	[ -z "${home_lists}" ] || rm -rf -- "${home_lists}"
	[ -z "${probe_out}" ] || rm -f -- "${probe_out}"
	[ -z "${scratch_etc}" ] || rm -rf -- "${scratch_etc}"
	[ -z "${host_etc_mount}" ] || rmdir -- "${host_etc_mount}" 2>/dev/null || true
}
trap cleanup EXIT
printf '{}\n' >"${scratch_state}"

# 1. work tree: hide this repo and every sibling project (installed copies of the
#    skill under .agents/.claude carry older revisions — a worse-than-useless baseline).
args+=(--tmpfs "${repo_parent}")

# 1b. other work trees of the same repository. When eval-sandbox runs from a git
#     worktree placed outside the main checkout's parent (e.g. /tmp/wt-244 while the
#     checkout lives in ~/projects/skills), ${repo_parent} covers only the worktree
#     and the main checkout stays readable — with its own .agents/.claude installed
#     copies at whatever revision that tree is on. Measured: a without_skill run read
#     ~/projects/skills/.agents/skills/kaizen/ and described the PRE-change design,
#     and contamination.txt flagged it CONTAMINATED. Hide the parent of every work
#     tree git reports, not just our own.
if command -v git >/dev/null 2>&1; then
	declare -A hidden_worktree_parents=(
		["${repo_parent}"]=1
		["/tmp"]=1
	)
	while IFS= read -r wt; do
		[ -n "${wt}" ] || continue
		wt_parent="$(dirname "${wt}")"
		# Already covered by ${repo_parent} (or by the /tmp tmpfs below), or a path
		# whose removal would take the disposable project with it.
		# A parent under one already hidden must be skipped too: bwrap creates the
		# mount point inside the outer tmpfs, so the repo dir reappears (empty but
		# listable) and `--verify` stage 1 reports it as REACHABLE.
		covered=""
		for hidden in "${!hidden_worktree_parents[@]}"; do
			case "${wt_parent}/" in "${hidden}"/*) covered=1 ;; esac
		done
		[ -z "${covered}" ] || continue
		case "${PWD}/" in "${wt_parent}"/*) continue ;; esac
		if [ -e "${wt_parent}" ]; then
			hidden_worktree_parents["${wt_parent}"]=1
			args+=(--tmpfs "${wt_parent}")
		fi
	done < <(git -C "${repo}" worktree list --porcelain 2>/dev/null |
		sed -n 's/^worktree //p')
fi

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

# 0. $HOME: an empty tmpfs with only the start-up allowlist bound back read-only.
#    It comes after groups 1-3 so that it wins over them wherever they overlap: a
#    work tree under $HOME is covered again, and a $HOME under /tmp (the tests) or
#    under the disposable project is replaced rather than exposed by the /tmp bind.
#    Every later mount under $HOME needs this tmpfs to create its mount point, and
#    the --remount-ro at the end (after the last mount under $HOME) makes it
#    read-only so nothing the run does escapes into the user's environment.
#    The disposable project is never under $HOME (run-skill-eval.sh makes it under
#    /tmp); a cwd under $HOME is hidden here and bwrap fails on --chdir, visibly.
args+=(--tmpfs "${home}")
# What the CLIs and tools read to start, measured by hiding everything else and
# starting each of them (Issue #1008). Credentials are deliberately absent:
# ~/.config/box, ~/.config/gh, ~/.ssh, ~/.aws, ~/.gnupg, ~/.docker,
# ~/.local/share/keyrings and the rest of $HOME stay hidden without being named.
# Each entry is bound only when it exists on the host.
#   .local/bin           CLI launchers (claude, codex, mise)
#   .local/share/claude  the Claude Code release the launcher points at
#   mise (4 entries)     mise, its global config and the node/pnpm/python it installs
#   pnpm (3 entries)     the package store, so an offline install still works
#   .cache/ms-playwright, .cache/puppeteer  browsers for browser-driven skills
#   .gitconfig, .config/git/{config,ignore,attributes}  the commit identity and global
#                        ignore. Not the whole .config/git: git credential-store keeps
#                        its tokens in .config/git/credentials.
home_allow=(
	.local/bin
	.local/share/claude
	.local/share/mise .config/mise .local/state/mise .cache/mise
	.local/share/pnpm .local/state/pnpm .cache/pnpm
	.cache/ms-playwright .cache/puppeteer
	.gitconfig .config/git/config .config/git/ignore .config/git/attributes
)
for rel in "${home_allow[@]}"; do
	[ -e "${home}/${rel}" ] && args+=(--ro-bind "${home}/${rel}" "${home}/${rel}")
done
# The CLI writes its own state to ~/.claude.json at startup, so give it a throwaway
# one. It must NOT be a copy of the real file: that file records per-project history
# and allowed tools — `--verify` caught a skill's own hook script name in there — plus
# account identifiers. `{}` is the minimum the CLI accepts (an empty file aborts as
# "corrupted"). `mktemp` lands in /tmp on the host; bwrap reads bind sources from
# the host, so the /tmp tmpfs above does not hide it.
args+=(--bind "${scratch_state}" "${home}/.claude.json")

# 4. agent records: conversation transcripts, memory, plans, task state and history
#    restate skill content verbatim, and ~/.claude/skills holds globally installed
#    copies of the skill under test. One tmpfs over the whole directory beats listing
#    subdirs — a list cannot detect the entry it forgot, and this doubles as the
#    writable scratch the CLI needs under a read-only $HOME. Only what the CLI needs
#    to start is bound back, read-only.
args+=(--tmpfs "${home}/.claude")
# .credentials.json: the CLI needs it to start. CLAUDE.md: the
# user-global instruction file is NOT skill content, and hiding it from baselines
# only would make the two configurations differ by more than the skill under test.
# Reopening that route is guarded — `--verify` scans $HOME, so a CLAUDE.md that did
# restate skill content would surface as a marker hit.
for f in .credentials.json CLAUDE.md; do
	[ -e "${home}/.claude/${f}" ] && args+=(--ro-bind "${home}/.claude/${f}" "${home}/.claude/${f}")
done
# settings.json is NOT bound as is: it holds the user's hooks, permissions and the
# autoMode environment text, which names this repo's path and .kaizen/ notes — a
# without_skill run read them. Bind a copy that keeps only the keys the CLI needs
# to reach the API (sanitize-claude-settings.ts holds the allowlist).
if [ -e "${home}/.claude/settings.json" ]; then
	scratch_settings="$(mktemp)"
	# Run node from the repo: the cwd here is the disposable project under /tmp, where a
	# version manager's shim (mise) may not resolve node.
	(cd "${repo}" && node "$(dirname "${self}")/sanitize-claude-settings.ts" "${home}/.claude/settings.json" "${scratch_settings}") || {
		echo "eval-sandbox: cannot sanitize ${home}/.claude/settings.json" >&2
		exit 3
	}
	args+=(--ro-bind "${scratch_settings}" "${home}/.claude/settings.json")
fi
declare -A hidden_agent_dirs=()
for d in "${home}/.codex" "${codex_home}" "${home}/.copilot" "${home}/.agents" "${home}/.vscode-server"; do
	[ -e "${d}" ] || continue
	d="$(realpath -m -- "${d}")"
	[ -z "${hidden_agent_dirs["${d}"]+present}" ] || continue
	hidden_agent_dirs["${d}"]=1
	args+=(--tmpfs "${d}")
done
# The standalone Codex launcher commonly resolves into CODEX_HOME/packages,
# which the tmpfs above deliberately hides together with user config, histories and
# globally installed skills. Reopen only its read-only bin directory (Codex also
# spawns the sibling codex-code-mode-host) and auth file:
# `--ignore-user-config --ephemeral` keeps config/session state out of the run,
# while authentication still needs auth.json. Both mounts are read-only.
case "${cli_real}" in
"${home}/.codex/"* | "${codex_home}/"*)
	cli_bin_dir="$(dirname -- "${cli_real}")"
	args+=(--ro-bind "${cli_bin_dir}" "${cli_bin_dir}")
	;;
esac
# Group 5: the network. The four groups above hide the skill CONTENT on this machine,
# but the repository is public — a baseline can `git clone https://github.com/<owner>/<repo>`
# and answer from the real sources. That is not hypothetical: it happened on the first
# claude-code baseline of iteration-16 (contamination.txt reported CONTAMINATED, and the
# run quoted kaizen-candidate-scan.sh from the cloned tree).
#
# The block is **default-deny by name resolution**, not a list of forbidden hosts. An
# enumeration of blocked hosts cannot detect the mirror it forgot (this file's own
# doctrine, see group 4), so instead `/etc/resolv.conf` points at an unroutable
# nameserver and `/etc/hosts` carries ONLY loopback plus the vendor API addresses that
# the CLI itself needs, resolved here on the host at start-up. Every other hostname —
# github.com, any mirror, any forge, any search endpoint — fails to resolve.
# `hosts: files dns` in nsswitch.conf is what makes the allowlist win; the resolver
# never gets a chance to answer for anything else.
#
# Residual gap: a host reachable by literal IP is not blocked, and the allowlisted API
# is a live model endpoint, so a baseline could in principle ask the model itself about
# the skill. Both are out of reach of a mount-namespace wrapper.
#
# EVAL_SANDBOX_NET_ALLOW adds space-separated hostnames (for a vendor endpoint this
# script does not know about). EVAL_SANDBOX_NET=off restores the host network for
# debugging; it must never be used for a run whose Delta is reported.
net_hosts_default=""
case "${vendor}" in
claude-code) net_hosts_default="api.anthropic.com statsig.anthropic.com" ;;
codex) net_hosts_default="chatgpt.com api.openai.com auth.openai.com" ;;
esac
net_allow="${net_hosts_default} ${EVAL_SANDBOX_NET_ALLOW:-}"

scratch_etc=""
host_etc_mount=""
if [ "${EVAL_SANDBOX_NET:-on}" != "off" ] || { [ "${vendor}" = "codex" ] && [ -f "${codex_auth}" ]; }; then
	# One /etc symlink farm serves both purposes: the network allowlist (hosts,
	# resolv.conf) and Codex's managed requirements. Everything else keeps pointing at
	# the host's real /etc through a read-only mirror, so nsswitch.conf, ssl certs and
	# the rest stay exactly as they are.
	host_etc_mount="$(mktemp -d "/tmp/eval-sandbox-host-etc-XXXXXX")"
	scratch_etc="$(mktemp -d)"
	while IFS= read -r -d '' entry; do
		name="$(basename -- "${entry}")"
		case "${name}" in
		codex) continue ;;
		hosts | resolv.conf)
			[ "${EVAL_SANDBOX_NET:-on}" != "off" ] && continue
			;;
		esac
		ln -s -- "${host_etc_mount}/${name}" "${scratch_etc}/${name}"
	done < <(find /etc -mindepth 1 -maxdepth 1 -print0)
fi

if [ "${EVAL_SANDBOX_NET:-on}" != "off" ]; then
	{
		echo "127.0.0.1 localhost"
		echo "::1 localhost ip6-localhost ip6-loopback"
	} >"${scratch_etc}/hosts"
	resolved_any=0
	for net_host in ${net_allow}; do
		# A vendor host that does not resolve here would resolve to nothing inside
		# either, so the run would fail with a confusing network error instead of a
		# clear one. Record which ones were reachable and fail closed below if none was.
		if addrs="$(getent ahostsv4 "${net_host}" 2>/dev/null | awk '{print $1}' | sort -u)" && [ -n "${addrs}" ]; then
			while IFS= read -r addr; do
				[ -n "${addr}" ] || continue
				printf '%s %s\n' "${addr}" "${net_host}" >>"${scratch_etc}/hosts"
			done <<<"${addrs}"
			resolved_any=1
		fi
	done
	if [ "${resolved_any}" -eq 0 ]; then
		echo "eval-sandbox: could not resolve any allowlisted API host (${net_allow// /, }); refusing to start a run that cannot reach its model. Set EVAL_SANDBOX_NET_ALLOW, or EVAL_SANDBOX_NET=off for a debugging run whose Delta is not reported." >&2
		exit 3
	fi
	# Unroutable nameserver: anything not in the hosts file above simply has no answer.
	echo "nameserver 0.0.0.0" >"${scratch_etc}/resolv.conf"
fi

if [ "${vendor}" = "codex" ] && [ -f "${codex_auth}" ]; then
	args+=(--ro-bind "${codex_auth}" "${codex_auth}")
	# The CLI must read auth.json during startup, but agent-issued shell commands
	# must not. Bind an admin requirements file only inside this mount namespace;
	# Codex applies deny_read after it has loaded credentials and users cannot
	# weaken the rule through project or CLI config.
	[ ! -e /etc/codex ] || {
		echo "eval-sandbox: /etc/codex already exists; refusing to replace managed requirements. Add the auth.json deny_read rule to the managed policy or use a dedicated credential store." >&2
		exit 3
	}
	mkdir -p -- "${scratch_etc}/codex"
	{
		echo "[permissions.filesystem]"
		printf 'deny_read = ["%s"]\n' "${codex_auth}"
	} >"${scratch_etc}/codex/requirements.toml"
fi

[ -n "${scratch_etc}" ] && args+=(--ro-bind /etc "${host_etc_mount}" --ro-bind "${scratch_etc}" /etc)

# Credentials served by agents rather than read from files. The runtime dir holds the
# session bus, through which the keyring daemon hands out what ~/.local/share/keyrings
# stores, and the ssh-agent and gpg-agent sockets. Measured: the Secret Service was
# reachable from inside before this. The tmpfs keeps the dir writable for tools that
# put locks there (pnpm). Neither CLI needs the bus: Claude Code reads
# ~/.claude/.credentials.json and Codex reads auth.json.
# Residual gap: an abstract-namespace socket is not a file, and the network namespace
# is shared, so a bus that listens only on one stays reachable.
# XDG_RUNTIME_DIR and /run/user/<uid> can differ (WSLg points the variable elsewhere
# while the systemd user bus stays under /run/user), so both are hidden.
runtime_dirs=()
for d in "${XDG_RUNTIME_DIR:-}" "/run/user/$(id -u)"; do
	[ -n "${d}" ] && [ -d "${d}" ] || continue
	case " ${runtime_dirs[*]} " in *" ${d} "*) continue ;; esac
	runtime_dirs+=("${d}")
	args+=(--tmpfs "${d}")
done
args+=(--unsetenv DBUS_SESSION_BUS_ADDRESS --unsetenv SSH_AUTH_SOCK --unsetenv GPG_AGENT_INFO)

# Last mount under $HOME is above; from here on $HOME is read-only (step 0).
args+=(--remount-ro "${home}")

# What decides a path inside the sandbox is the LAST mount whose target is the path or
# one of its parents (bwrap applies them in order). The mounts are read from args once,
# here; --verify stage 5 asks covering_mount which of its targets put a path back.
mount_flags=()
mount_targets=()
for i in "${!args[@]}"; do
	case "${args[i]}" in
	--bind | --ro-bind | --dev-bind) mount_flags+=("${args[i]}") mount_targets+=("${args[i + 2]}") ;;
	--tmpfs) mount_flags+=("${args[i]}") mount_targets+=("${args[i + 1]}") ;;
	esac
done
# Print the index (into mount_flags / mount_targets) of the mount that decides $1.
covering_mount() {
	local p="$1" i t found=""
	for i in "${!mount_targets[@]}"; do
		t="${mount_targets[i]}"
		if [ "${t}" = / ]; then
			found="${i}"
			continue
		fi
		case "${p}" in "${t}" | "${t}"/*) found="${i}" ;; esac
	done
	printf '%s\n' "${found}"
}

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
printf "stage1 repo listing: "; if [ -n "$(ls -A "$1" 2>/dev/null)" ]; then echo "REACHABLE (FAIL)"; rc=1; else echo "empty/absent (ok)"; fi
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
  # Detection is judged by OUTPUT, not by the exit code. The grep here can be ugrep,
  # which returns 2 whenever it meets an unreadable path even when -q matched (GNU
  # documents the opposite: -q plus a match wins). Trusting the code would FAIL the
  # control on any root holding an unreadable dir — a false "this root is not searched".
  hit="$(timeout 600 grep -rlIF $excludes -e "SENTINEL-EVAL-SANDBOX-STAGE2" "$r" 2>/dev/null | head -1)"; cs=$?
  if [ -n "$hit" ]; then echo "sentinel found (ok)"
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
if printf "%s\n" "$SENTINEL" >"$HOME/.claude/.eval-sandbox-escape-probe" 2>/dev/null; then echo "probe planted (parent checks the host)"
else echo "NOT PLANTED (FAIL: ~/.claude must stay writable, and containment is unproven)"; rc=1; fi
# Stage 4: the network. Judged by a pair, never by the deny half alone — "github.com
# does not resolve" is also what a sandbox with no network at all looks like, and that
# would silently break every run instead of isolating it. The allow half is the
# positive control that proves resolution still works for what the CLI needs.
printf "stage4 positive control (allowlisted API resolves): "
allow_ok=0
for h in $ALLOW_HOSTS; do getent ahostsv4 "$h" >/dev/null 2>&1 && { echo "$h (ok)"; allow_ok=1; break; }; done
[ "$allow_ok" -eq 1 ] || { echo "NONE RESOLVED (FAIL: the sandbox has no usable network; the deny results below mean nothing)"; rc=1; }
for h in github.com raw.githubusercontent.com codeload.github.com gitlab.com; do
  printf "stage4 deny %s: " "$h"
  if getent ahostsv4 "$h" >/dev/null 2>&1; then echo "RESOLVED (FAIL)"; rc=1; else echo "not resolvable (ok)"; fi
done
printf "stage4 deny git clone (end to end): "
if timeout 30 git clone -q --depth 1 "$CLONE_PROBE_URL" /tmp/.eval-sandbox-clone-probe >/dev/null 2>&1; then
  echo "CLONE SUCCEEDED (FAIL)"; rm -rf /tmp/.eval-sandbox-clone-probe; rc=1
else echo "blocked (ok)"; fi
exit $rc'
	# Stage 5: credentials, in a bwrap call of its own so the tests can run this script
	# on the host (where nothing is hidden) and see each FAIL branch fire without bwrap.
	# Judged by a pair again. The positive control is that every path bound back under
	# $HOME is readable; without it, "absent" could just mean the probe looks in the
	# wrong place. The paths are printed, never their content.
	# shellcheck disable=SC2016 # deliberate: the variables expand inside the sandboxed shell
	credentials_script='set -u -o pipefail; rc=0
printf "stage5 home allowlist positive control: "
shown=0; unread=()
while IFS= read -r -d "" p; do shown=$((shown+1)); [ -r "$p" ] || unread+=("$p"); done <"$HOME_LISTS/shown"
if [ "$shown" -eq 0 ]; then echo "NOTHING BOUND (FAIL: cannot prove the probe sees $HOME)"; rc=1
elif [ "${#unread[@]}" -gt 0 ]; then echo "NOT READABLE (FAIL)"; printf "    %s\n" "${unread[@]}"; rc=1
else echo "$shown bound paths readable (ok)"; fi
printf "stage5 home outside the allowlist: "
hidden=0; seen=()
while IFS= read -r -d "" p; do hidden=$((hidden+1)); if [ -e "$p" ] || [ -L "$p" ]; then seen+=("$p"); fi; done <"$HOME_LISTS/hidden"
if [ "$hidden" -eq 0 ]; then echo "NOTHING TO CHECK (FAIL: no host path lies outside the allowlist, so hiding is unproven)"; rc=1
elif [ "${#seen[@]}" -gt 0 ]; then echo "VISIBLE (FAIL)"; printf "    %s\n" "${seen[@]}"; rc=1
else echo "$hidden host paths absent (ok)"; fi
# Each line is "<entries on the host>|<dir>". `ls | grep -q` is not used: under
# pipefail, grep exiting on the first line makes ls die of SIGPIPE in a dir with many
# entries, and the pipeline then reads as "empty".
runtime_lines=0
while IFS= read -r -d "" l; do
  runtime_lines=$((runtime_lines+1)); n="${l%%|*}"; d="${l#*|}"
  printf "stage5 runtime dir %s: " "$d"
  if [ "$n" -eq 0 ]; then echo "no entries on the host (nothing to hide)"
  elif [ -n "$(ls -A "$d" 2>/dev/null)" ]; then echo "VISIBLE (FAIL)"; rc=1
  else echo "hidden (ok; $n entries on the host)"; fi
done <"$HOME_LISTS/runtime"
[ "$runtime_lines" -gt 0 ] || echo "stage5 runtime dir: none on the host (nothing to hide)"
printf "stage5 agent socket variables: "
set_vars=""
for v in DBUS_SESSION_BUS_ADDRESS SSH_AUTH_SOCK GPG_AGENT_INFO; do [ -z "${!v+set}" ] || set_vars="$set_vars $v"; done
if [ -n "$set_vars" ]; then echo "SET (FAIL):$set_vars"; rc=1; else echo "unset (ok)"; fi
exit $rc'
	# Stage 5 inputs, listed here on the host (paths only, NUL-separated). "shown" is
	# every bind target under $HOME. "hidden" is every host path under $HOME that no
	# mount puts back: the walk descends only into directories that hold a mount
	# target, so a store that nobody named here is still checked.
	# Under /tmp, not TMPDIR: a TMPDIR under $HOME would put the bind target inside the
	# read-only $HOME, where bwrap cannot create the mount point.
	home_lists="$(mktemp -d /tmp/eval-sandbox-home-lists-XXXXXX)"
	: >"${home_lists}/shown"
	: >"${home_lists}/hidden"
	home_targets=()
	for i in "${!mount_targets[@]}"; do
		t="${mount_targets[i]}"
		case "${t}" in "${home}"/*) ;; *) continue ;; esac
		# A mount that a later one covers (a work tree under $HOME, placed before the
		# $HOME tmpfs) puts nothing back, so its path stays in "hidden".
		[ "$(covering_mount "${t}")" = "${i}" ] || continue
		home_targets+=("${t}")
		[ "${mount_flags[i]}" = --tmpfs ] || printf '%s\0' "${t}" >>"${home_lists}/shown"
	done
	walk_home() {
		local e t below
		for e in "$1"/* "$1"/.[!.]* "$1"/..?*; do
			[ -e "${e}" ] || [ -L "${e}" ] || continue
			below=""
			for t in "${home_targets[@]}"; do
				[ "${e}" = "${t}" ] && continue 2
				case "${t}" in "${e}"/*) below=1 ;; esac
			done
			if [ -n "${below}" ] && [ -d "${e}" ] && [ ! -L "${e}" ]; then
				walk_home "${e}"
			else
				printf '%s\0' "${e}" >>"${home_lists}/hidden"
			fi
		done
	}
	walk_home "${home}"
	: >"${home_lists}/runtime"
	for d in "${runtime_dirs[@]}"; do
		printf '%s|%s\0' "$(find "${d}" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)" "${d}" >>"${home_lists}/runtime"
	done
	rc=0
	escape_sentinel="SENTINEL-EVAL-SANDBOX-ESCAPE"
	clone_probe_url="${EVAL_SANDBOX_CLONE_PROBE_URL:-https://github.com/shoji9x9/skills}"
	bwrap "${args[@]}" --setenv SENTINEL "${escape_sentinel}" \
		--setenv ALLOW_HOSTS "${net_allow}" --setenv CLONE_PROBE_URL "${clone_probe_url}" \
		--chdir / -- /bin/bash -c "${script}" _ "${repo}" "${markers[@]}" || rc=$?
	bwrap "${args[@]}" --ro-bind "${home_lists}" "${home_lists}" \
		--setenv HOME_LISTS "${home_lists}" \
		--chdir / -- /bin/bash -c "${credentials_script}" || rc=$?
	# Negative half of the containment check: the probe planted inside must not exist
	# on the host. A missing probe here only counts once the inner half reported
	# "probe planted" (it sets rc=1 otherwise), so "absent" cannot mean "never written".
	# Delete only what this check wrote: the file is identified by its sentinel content,
	# so a same-named file that is NOT ours fails the check and is left untouched
	# (a verification step must never destroy a user file on a false positive).
	escape_probe="${home}/.claude/.eval-sandbox-escape-probe"
	printf "stage3 host leak check (~/.claude): "
	if [ ! -e "${escape_probe}" ]; then
		echo "no leak (ok)"
	elif [ "$(cat -- "${escape_probe}" 2>/dev/null)" = "${escape_sentinel}" ]; then
		echo "LEAKED (FAIL: writes under ~/.claude reach the host)"
		rm -f -- "${escape_probe}"
		rc=1
	else
		echo "COLLISION (FAIL: ${escape_probe} exists but is not this check's probe; left untouched — move it aside and rerun)"
		rc=1
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
# Ask the sandbox what it shows instead of predicting it from the mounts: a $HOME
# reached through a symlink, a later tmpfs over an earlier bind and links inside the
# allowlist each made a prediction wrong in review. One short bwrap call with the same
# args looks at the CLI and at every PATH directory that has entries on the host.
# A hidden CLI makes bwrap fail with a bare exec error. A hidden PATH directory does not
# stop the CLI, so the run would see "command not found" for its tools, end with rc=0
# and record a degraded answer for both configurations. Stop before either.
probe=("${cli_real}")
IFS=: read -r -a path_dirs <<<"${PATH}"
for d in "${path_dirs[@]}"; do
	if [ -n "${d}" ] && [ -d "${d}" ] && [ -n "$(ls -A -- "${d}" 2>/dev/null)" ]; then probe+=("${d}"); fi
done
probe_out="$(mktemp /tmp/eval-sandbox-probe-XXXXXX)"
# shellcheck disable=SC2016 # deliberate: $p expands inside the sandboxed shell
probe_script='for p; do if [ -f "$p" ] || [ -n "$(ls -A -- "$p" 2>/dev/null)" ]; then printf "%s\0" "$p"; fi; done'
bwrap "${args[@]}" --setenv EVAL_SANDBOX_PROBE 1 --chdir / -- /bin/bash -c "${probe_script}" _ "${probe[@]}" \
	>"${probe_out}" </dev/null || {
	echo "eval-sandbox: the sandbox did not start for the start-up check of the CLI and PATH" >&2
	exit 3
}
shown_paths=()
while IFS= read -r -d '' p; do shown_paths+=("${p}"); done <"${probe_out}"
hidden_paths=()
for p in "${probe[@]}"; do
	seen=""
	for q in "${shown_paths[@]}"; do [ "${q}" != "${p}" ] || seen=1; done
	[ -n "${seen}" ] || hidden_paths+=("${p}")
done
[ "${#hidden_paths[@]}" -eq 0 ] || {
	echo "eval-sandbox: the sandbox hides these, so the run would start without them: ${hidden_paths[*]}." \
		"Drop the PATH entries the run does not need. To keep one, bind it back in ${self} after the mount" \
		"that covers it (home_allow for a plain path under \$HOME)." >&2
	exit 3
}
rc=0
bwrap "${args[@]}" --chdir "${PWD}" -- "${cli_real}" "$@" || rc=$?
exit "${rc}"
