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
#
# BASELINE INTEGRITY (`--config without_skill`): isolating cwd and skill
# installation is not enough — `claude -p` can read this repo's skill sources and
# then satisfy skill-specific assertions, which silently voids the measured
# Delta. That happened 5 times, and every time it was fixed by hand-building the
# same wrapper (.kaizen/2026-07-28-eval-baseline-read-contamination.md). So the
# harness, not the operator, owns it: baselines run inside scripts/eval-sandbox.sh
# by default, unisolated baselines are serialized against with_skill runs, and
# every baseline run gets a contamination verdict.
#
# EXIT CODES: 0 / the CLI's own code on a failed run; 2 usage; 3 could not
# acquire the serialization lock; 4 the run itself succeeded but the baseline is
# contaminated (CONTAMINATED) or the contamination check could not be trusted
# (CHECK-BROKEN / SKIPPED — a check that did not run is not a clean verdict).
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
# without_skill run has no skill installed; a with_skill run only sees the one we
# install below. Not installing the skill is necessary but NOT sufficient for an
# honest baseline — see BASELINE INTEGRITY above for the read side.
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

# Read isolation, applied to BOTH configurations. Isolating only the baseline
# leaves the comparison differing by more than the skill: a with_skill run reads
# $HOME freely, and ~/.claude/projects holds transcripts of the session that wrote
# the skill and designed the assertions (observed: runs cited ~/.claude/skills and
# grepped a globally installed skill's source). The sandbox hides the same routes
# from both, so the only remaining difference is the skill inside the disposable
# project. SKILL_EVAL_RUNNER still wins so a stub can be used for smoke tests, but
# leaving it unset no longer means "no isolation": the sandbox is the default and
# its absence is recorded rather than assumed away.
sandbox="${repo}/scripts/eval-sandbox.sh"
if [ -n "${SKILL_EVAL_RUNNER:-}" ]; then
	isolation="UNVERIFIED (operator-supplied SKILL_EVAL_RUNNER=${SKILL_EVAL_RUNNER})"
elif [ ! -x "${sandbox}" ]; then
	isolation="UNISOLATED (${sandbox} missing or not executable)"
elif ! command -v bwrap >/dev/null 2>&1; then
	isolation="UNISOLATED (bwrap not found; install bubblewrap to isolate reads)"
else
	runner_override="${sandbox}"
	isolation="sandboxed (scripts/eval-sandbox.sh)"
fi

# Serialize whenever read isolation is not proven. A parallel with_skill run keeps
# a full copy of the skill under /tmp, which an unisolated baseline reads; the
# sandbox hides /tmp, so only the unproven cases need to exclude the world. An
# unproven baseline takes an exclusive lock and an unproven with_skill run takes a
# shared one (many may overlap each other, and they contaminate nobody by
# themselves), which is what turns "run configurations sequentially" from advice
# into harness behavior.
lock_mode=""
case "${config}:${isolation}" in
*:sandboxed*) ;;
with_skill:*) lock_mode="-s" ;;
*) lock_mode="-x" ;;
esac
serialization="none (isolated)"
if [ -n "${lock_mode}" ]; then
	if command -v flock >/dev/null 2>&1; then
		lockfile="/tmp/skill-eval-${skill}.lock"
		exec 9>"${lockfile}"
		# Fail closed: a timed-out wait must not fall through to an overlapping run.
		flock -w 7200 "${lock_mode}" 9 || {
			echo "could not acquire ${lock_mode} lock on ${lockfile} within 7200s" >&2
			exit 3
		}
		serialization="${lock_mode} lock on ${lockfile}"
	else
		serialization="NONE (flock not found; run configurations sequentially by hand)"
		echo "warn: flock not found; overlapping runs can contaminate an unisolated baseline" >&2
	fi
fi

if [ "${config}" = "with_skill" ]; then
	mkdir -p -- "${proj}/.claude/skills"
	cp -R -- "${src}" "${proj}/.claude/skills/${skill}"
fi

mkdir -p -- "${out}"
{
	echo "config: ${config}"
	echo "isolation: ${isolation}"
	echo "serialization: ${serialization}"
} >"${out}/isolation.txt"
case "${isolation}" in
UNISOLATED* | UNVERIFIED*) echo "warn: read isolation is ${isolation} (see ${out}/isolation.txt)" >&2 ;;
esac

# Headless run with cwd fixed to the disposable project (cd holds within this one
# invocation). --dangerously-skip-permissions is acceptable: the target is a
# throwaway /tmp dir, never this repo.
# SKILL_EVAL_RUNNER overrides the executable (default `claude`) so isolation can
# be smoke-tested with a stub without spawning a real agent. Without it, a
# baseline goes through the sandbox wrapper resolved above (which execs the real
# CLI inside bwrap).
runner="${SKILL_EVAL_RUNNER:-${runner_override:-claude}}"

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
		printf '%s\tover-total-cap (%s B + %s B > %s B)\n' "${rel}" "${total_bytes}" "${size}" "${max_total_bytes}" >>"${skipped_log}"
		continue
	fi
	mkdir -p -- "${snapshot_dir}/$(dirname -- "${rel}")"
	cp -- "${proj}/${rel}" "${snapshot_dir}/${rel}" || {
		printf '%s\tcopy-failed\n' "${rel}" >>"${skipped_log}"
		continue
	}
	total_bytes=$((total_bytes + size))
done < <(cd "${proj}" && find . \( -path "*/.git" -o -path "*/node_modules" -o -path "./.claude/skills" \) -prune -o -type f -print0)

# Contamination check (baselines only). A baseline that names this skill's own
# files read them from a route the isolation missed; catching that must not
# depend on the grader remembering to look, so the scan runs here and always
# leaves a verdict (an absent file would be indistinguishable from a clean one).
contaminated=0
if [ "${config}" = "without_skill" ]; then
	contamination_log="${out}/contamination.txt"

	# Markers come from the skill's own bundle plus its source path — strings a
	# baseline has no legitimate way to produce. They are DIRECTORY-ANCHORED
	# (`references/apply.md`, not `apply.md`): bare basenames of bundle files are
	# often words a baseline may legitimately propose creating in the disposable
	# project (`setup.md`, `apply.md`), and a false CONTAMINATED tells the operator
	# to throw away a valid measurement. A contaminated run cites skill files by
	# path, so anchoring keeps the realistic signal.
	# Anything already present in the prompt or the fixture is dropped too: those
	# reach the baseline honestly.
	markers=()
	while IFS= read -r rel; do
		[ -n "${rel}" ] && markers+=("${rel}")
	done < <(cd "${src}" && find references assets scripts -mindepth 1 -maxdepth 1 -printf '%p\n' 2>/dev/null | sort -u)
	markers+=("skills/${skill}")

	kept=()
	for m in ${markers[@]+"${markers[@]}"}; do
		case "${prompt}" in *"${m}"*) continue ;; esac
		if [ -n "${fixture}" ] && grep -rqIF -e "${m}" -- "${fixture}" 2>/dev/null; then
			continue
		fi
		kept+=("${m}")
	done

	scan_roots=()
	[ -e "${out}/result.json" ] && scan_roots+=("${out}/result.json")
	[ -d "${snapshot_dir}" ] && scan_roots+=("${snapshot_dir}")

	verdict="clean"
	detail=""
	if [ "${#kept[@]}" -eq 0 ]; then
		verdict="SKIPPED"
		detail="no usable marker (every candidate also appears in the prompt or fixture)"
	elif [ "${#scan_roots[@]}" -eq 0 ]; then
		verdict="SKIPPED"
		detail="nothing to scan (no result.json and no project-files/)"
	else
		# Positive control first: "no hits" and "the scan never worked" produce the
		# same output, so prove the scan finds a marker it is meant to find before
		# any clean verdict is trusted (AGENTS.md「何も出ないこと」を合格根拠に
		# する検査は、陽性コントロールで検出能力を実証してから使う).
		# The control has to sit INSIDE a scanned root and be searched through the
		# same root list: planted anywhere else it proves only that grep works, not
		# that these roots are read at all.
		control="${snapshot_dir}/.contamination-control"
		rm -rf -- "${control}"
		mkdir -p -- "${control}"
		printf '%s\n' "${kept[@]}" >"${control}/planted"
		# Judge detection by OUTPUT, not by grep's exit code: ugrep returns 2 on any
		# unreadable path even when it matched (GNU's "-q plus a match wins" rule is
		# not universal), which would fake a CHECK-BROKEN verdict on a working scan.
		undetected=""
		for m in "${kept[@]}"; do
			hit="$(grep -rlIF -e "${m}" -- "${scan_roots[@]}" 2>/dev/null | head -1)" || true
			[ -n "${hit}" ] || undetected="${undetected} ${m}"
		done
		rm -rf -- "${control}"
		# result.json is the other root and cannot host a control (it is the evidence
		# being judged), so assert it is at least a readable non-empty file. An empty
		# or unreadable one contributes nothing and would still read as "clean".
		unusable=""
		if [ ! -r "${out}/result.json" ] || [ ! -s "${out}/result.json" ]; then
			unusable="result.json is empty or unreadable; the response side was not searched"
		fi

		if [ -n "${undetected}" ]; then
			verdict="CHECK-BROKEN"
			detail="positive control did not detect:${undetected}"
		elif [ -n "${unusable}" ]; then
			verdict="CHECK-BROKEN"
			detail="${unusable}"
		else
			# `|| true`: grep exits 1 when a marker is absent, which is the expected
			# (clean) case — under `set -e` that status would kill the script here.
			hits="$(for m in "${kept[@]}"; do
				grep -rlIF -e "${m}" -- "${scan_roots[@]}" 2>/dev/null | while IFS= read -r f; do
					printf '%s\t%s\n' "${m}" "${f}"
				done
			done)" || true
			if [ -n "${hits}" ]; then
				verdict="CONTAMINATED"
				detail="${hits}"
			fi
		fi
	fi

	{
		echo "verdict: ${verdict}"
		echo "isolation: ${isolation}"
		echo "markers: ${kept[*]-}"
		echo "scanned: ${scan_roots[*]-}"
		[ -n "${detail}" ] && printf '%s\n' "${detail}"
	} >"${contamination_log}"

	# SKIPPED fails closed with the rest: it means no contamination check ran, which
	# is "the verdict cannot be trusted", not "clean". Exiting 0 there would hand the
	# operator an unexamined baseline that aggregates as a real measurement.
	case "${verdict}" in
	CONTAMINATED | CHECK-BROKEN | SKIPPED)
		contaminated=1
		echo "warn: baseline ${verdict} (see ${contamination_log}); this run's Delta is not valid as-is" >&2
		;;
	esac
fi

echo "done: config=${config} skill=${skill} -> ${out} (rc=${rc})"
# A contaminated baseline that exits 0 gets aggregated as a real measurement, so
# surface it in the exit status too — but never mask the CLI's own failure code.
if [ "${rc}" -eq 0 ] && [ "${contaminated}" -eq 1 ]; then
	exit 4
fi
exit "${rc}"
