#!/usr/bin/env bash
# Dev-only: run ONE skill eval prompt through Claude Code or Codex in an
# isolated, disposable empty project so
# the eval's file mutations never touch this repo. Used to build regression
# benchmarks (see docs/skill-development.md "回帰テストを実行する").
#
# WHY a launcher-fixed cwd instead of telling an agent to `cd /tmp`:
#   A coding agent's Bash tool does NOT persist `cd` across separate tool calls
#   (the shell cwd resets to the project root each call), and relative-path file
#   ops resolve against the agent's base dir. So instructing a subagent to "work
#   in /tmp" lets the skill's relative-path steps (`mkdir .agents/...`, `ln -s`)
#   land in THIS repo. Here the cwd is fixed by the launcher within a single
#   shell invocation: the selected executor runs with cwd = the temp project, so the nested
#   session's project root (and every cwd reset) stays inside it.
#
# This script is repo-internal tooling and is NOT bundled in any distributed skill.
#
# PRECONDITIONS: the disposable project is empty, un-trusted and non-interactive.
# mise shims (python3/node/jq) fail "No version is set" when un-trusted; gh/git
# skills have no repo context (use real PR/Issue numbers, not fake ones); and a
# headless executor has no responder for interactive questions. Give prompts whose
# intent is unambiguous and ensure skills degrade gracefully. See
# docs/skill-development.md "eval 環境の前提（runtime / repo / 非対話）".
#
# EXECUTOR CONTRACT: `--executor claude-code|codex` selects the vendor CLI, but
# both paths emit the same result.json / timing.json / outputs/response.md shape.
# Vendor-native traces stay under raw/ and consumers must not depend on them.
# Codex skills are installed at the native repository scope `.agents/skills`;
# their SKILL.md is never injected into the prompt.
#
# BASELINE INTEGRITY (`--config without_skill`): isolating cwd and skill
# installation is not enough — a vendor CLI can read this repo's skill sources and
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
# (CHECK-BROKEN / SKIPPED — a check that did not run is not a clean verdict); 5
# result normalization or eval metadata generation failed.
set -euo pipefail

usage() {
	echo "Usage: $0 --skill <name> --prompt <text> --config <with_skill|without_skill> --out <dir> [--executor <claude-code|codex>] [--model <model>] [--reasoning-effort <effort>] [--eval-id <id>] [--eval-name <name>] [--repo <path>] [--fixture <dir>]" >&2
	exit 2
}

skill="" prompt="" config="" out="" executor="claude-code" model="" reasoning_effort="" eval_id="" eval_name="" repo="" fixture=""
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
	--executor)
		executor="$2"
		shift 2
		;;
	--model)
		model="$2"
		shift 2
		;;
	--reasoning-effort)
		reasoning_effort="$2"
		shift 2
		;;
	--eval-id)
		eval_id="$2"
		shift 2
		;;
	--eval-name)
		eval_name="$2"
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
case "$executor" in
claude-code | codex) ;;
*)
	echo "executor must be claude-code|codex" >&2
	exit 2
	;;
esac
case "${reasoning_effort}" in
"" | *[!A-Za-z0-9_-]*)
	[ -z "${reasoning_effort}" ] || {
		echo "invalid --reasoning-effort (expected A-Z, a-z, 0-9, _, -): ${reasoning_effort}" >&2
		exit 2
	}
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
repo="$(realpath -- "${repo}")"
out="$(realpath -m -- "${out}")"
if [ -n "${fixture}" ]; then
	[ -d "${fixture}" ] || {
		echo "fixture dir not found: ${fixture}" >&2
		exit 1
	}
	fixture="$(realpath -- "${fixture}")"
fi

src="${repo}/skills/${skill}"
[ -f "${src}/SKILL.md" ] || {
	echo "skill source not found: ${src}/SKILL.md" >&2
	exit 1
}
normalizer="${repo}/scripts/normalize-skill-eval-result.js"
[ -f "${normalizer}" ] || {
	echo "normalizer not found: ${normalizer}" >&2
	exit 1
}

# Disposable empty project under /tmp. Its parents hold no .claude/skills, so a
# without_skill run has no skill installed; a with_skill run only sees the one we
# install below. Not installing the skill is necessary but NOT sufficient for an
# honest baseline — see BASELINE INTEGRITY above for the read side.
proj="$(mktemp -d "/tmp/skill-eval-${skill}-XXXXXX")"
initial_files_manifest="$(mktemp "/tmp/skill-eval-initial-${skill}-XXXXXX")"
# shellcheck disable=SC2329 # invoked by the EXIT trap below
cleanup() {
	rm -rf -- "${proj}"
	rm -f -- "${initial_files_manifest}"
}
trap cleanup EXIT

# Optional fixture: seed the disposable project with a prepared state (config,
# .replace/ artifacts, etc.) so normal-path evals can exercise behavior beyond
# "stop on missing prerequisites". The fixture is copied, never mutated.
# An executable root setup.sh may materialize state that cannot be committed as
# ordinary fixture files (for example a Git repository and local bare remote).
# Run it before the executor sandbox makes .git read-only and before capturing
# the initial manifest, so its outputs remain fixture inputs rather than results.
if [ -n "${fixture}" ]; then
	cp -R -- "${fixture}/." "${proj}/"
	if [ -f "${proj}/setup.sh" ] && [ -x "${proj}/setup.sh" ]; then
		(cd "${proj}" && ./setup.sh)
	fi
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
	case "${executor}" in
	claude-code) skill_home="${proj}/.claude/skills" ;;
	codex) skill_home="${proj}/.agents/skills" ;;
	esac
	mkdir -p -- "${skill_home}"
	mkdir -p -- "${skill_home}/${skill}"
	for subject_part in SKILL.md references assets scripts; do
		[ -e "${src}/${subject_part}" ] || continue
		cp -R -- "${src}/${subject_part}" "${skill_home}/${skill}/"
	done
fi

# Capture fixture/input paths before the executor runs. files_created is later
# derived from captured project-files minus this manifest, so pre-existing
# fixture files are not mislabeled as generated outputs.
(cd "${proj}" && find . \( -path "*/.git" -o -path "*/node_modules" -o -path "./.claude/skills" -o -path "./.agents/skills" \) -prune -o -type f -printf '%P\0' | LC_ALL=C sort -z) >"${initial_files_manifest}"

mkdir -p -- "${out}/outputs" "${out}/raw"
{
	echo "executor: ${executor}"
	echo "config: ${config}"
	echo "isolation: ${isolation}"
	echo "serialization: ${serialization}"
} >"${out}/isolation.txt"
case "${isolation}" in
UNISOLATED* | UNVERIFIED*) echo "warn: read isolation is ${isolation} (see ${out}/isolation.txt)" >&2 ;;
esac

# Headless runs keep cwd fixed to the disposable project within one invocation.
# Bubblewrap owns host read isolation. Codex also retains its own workspace-write
# sandbox so the auth file mounted for CLI startup is not exposed to agent shell
# commands. The two layers protect different boundaries and both stay enabled.
case "${executor}" in
claude-code) executor_binary="claude" ;;
codex) executor_binary="codex" ;;
esac
runner="${SKILL_EVAL_RUNNER:-${runner_override:-${executor_binary}}}"
if [ -n "${SKILL_EVAL_CLI_VERSION:-}" ]; then
	cli_version="${SKILL_EVAL_CLI_VERSION}"
else
	cli_version="$(${executor_binary} --version 2>/dev/null || true)"
fi
[ -n "${cli_version}" ] || cli_version="unknown"
harness_version="run-skill-eval/1"

# Headless eval has no one to answer interactive prompts (AskUserQuestion errors
# under `claude -p`). Inject a non-interactive notice here so the agent degrades
# gracefully — this keeps the eval-only instruction out of the distributed skills.
noninteractive_preamble='【非対話の自動評価環境】AskUserQuestion 等の対話確認ツールは使えません。確認が必要でも質問で停止せず続行しますが、破壊的・外向きの操作（commit / push / マージ / リモートへの書き込み等）は行わず、最も安全な非破壊のデフォルトを選び、採用した仮定を冒頭に明示してください。'
eval_prompt="${prompt}"
prompt="${noninteractive_preamble}

${prompt}"

raw_trace=""
executor_args=()
case "${executor}" in
claude-code)
	raw_trace="${out}/raw/claude-code.json"
	executor_args=(-p "${prompt}" --output-format json --dangerously-skip-permissions)
	[ -n "${model}" ] && executor_args+=(--model "${model}")
	[ -n "${reasoning_effort}" ] && executor_args+=(--effort "${reasoning_effort}")
	;;
codex)
	raw_trace="${out}/raw/codex.jsonl"
	executor_args=(exec --json --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check --approve-for-me)
	[ -n "${model}" ] && executor_args+=(--model "${model}")
	[ -n "${reasoning_effort}" ] && executor_args+=(--config "model_reasoning_effort=\"${reasoning_effort}\"")
	executor_args+=("${prompt}")
	;;
esac

started_at="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
started_ms="$(date +%s%3N)"
rc=0
(cd "${proj}" && EVAL_SANDBOX_CLI="${executor_binary}" EVAL_SANDBOX_VENDOR="${executor}" "${runner}" "${executor_args[@]}") >"${raw_trace}" 2>"${out}/stderr.log" || rc=$?
ended_ms="$(date +%s%3N)"
ended_at="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
duration_ms=$((ended_ms - started_ms))
[ "${rc}" -ne 0 ] && echo "warn: ${executor_binary} exited ${rc} (see ${out}/stderr.log)" >&2

metadata_eval_id="${eval_id}"
eval_dir="$(dirname -- "$(dirname -- "${out}")")"
eval_dir_name="$(basename -- "${eval_dir}")"
if [ -z "${metadata_eval_id}" ]; then
	case "${eval_dir_name}" in
	eval-*) metadata_eval_id="${eval_dir_name#eval-}" ;;
	esac
fi

normalizer_args=(
	--executor "${executor}"
	--raw "${raw_trace}"
	--result "${out}/result.json"
	--timing "${out}/timing.json"
	--metrics "${out}/outputs/metrics.json"
	--response "${out}/outputs/response.md"
	--exit-code "${rc}"
	--duration-ms "${duration_ms}"
	--started-at "${started_at}"
	--ended-at "${ended_at}"
	--harness-version "${harness_version}"
	--cli-version "${cli_version}"
	--model "${model}"
	--reasoning-effort "${reasoning_effort}"
)
if [ -n "${metadata_eval_id}" ]; then
	normalizer_args+=(
		--eval-id "${metadata_eval_id}"
		--eval-name "${eval_name}"
		--prompt "${eval_prompt}"
		--eval-metadata "${eval_dir}/eval_metadata.json"
		--compat-eval-metadata "${out}/eval_metadata.json"
	)
	[ -f "${src}/evals/evals.json" ] && normalizer_args+=(--evals "${src}/evals/evals.json")
fi

# Snapshot the paths and bounded text contents created in the isolated project.
# Do not copy the project itself into tests/; repo clones and generated files can
# be large. The content snapshot keeps only lightweight files needed for grading.
(cd "${proj}" && find . \( -path "*/.git" -o -path "*/node_modules" -o -path "./.claude/skills" -o -path "./.agents/skills" \) -prune -o -print | sort) >"${out}/project-tree.txt"
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
	.git/* | .claude/skills/* | .agents/skills/* | node_modules/* | pnpm-lock.yaml | package-lock.json | yarn.lock)
		continue
		;;
	# .ts / .tsx / .sql are the languages the replace-strategy skill family writes
	# into the target project (golden-dataset の投入ツール〈typescript | sql〉,
	# parity-suite の Playwright スイート・ロケータマッピング, parity-replace の新側実装).
	# Assertions name those files directly, so they must be gradable from the snapshot.
	*.md | *.txt | *.json | *.yml | *.yaml | *.toml | *.sh | *.js | *.mjs | *.ts | *.tsx | *.sql)
		;;
	# Extensionless config files that assertions read by content (kaizen の setup は
	# .gitignore に制御ファイルのパターンを追記する)。拡張子マッチだけだと採点材料が
	# 無いまま「作られたかどうか」しか見られず、内容を検査する assertion が測れない。
	.gitignore | */.gitignore | .gitattributes | */.gitattributes)
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
done < <(cd "${proj}" && find . \( -path "*/.git" -o -path "*/node_modules" -o -path "./.claude/skills" -o -path "./.agents/skills" \) -prune -o -type f -print0)

normalizer_args+=(--project-files "${snapshot_dir}" --initial-files "${initial_files_manifest}")
normalizer_rc=0
node "${normalizer}" "${normalizer_args[@]}" 2>>"${out}/stderr.log" || normalizer_rc=$?
if [ "${normalizer_rc}" -ne 0 ]; then
	rc=5
	echo "warn: result normalization failed (see ${out}/stderr.log)" >&2
fi

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
	# The bare source path `skills/<name>` is NOT a marker. A baseline that correctly
	# reports the skill is absent routinely names where it would live ("install it at
	# ~/.claude/skills/<name>/SKILL.md", "show me skills/<name>/ and I will retrace"),
	# which is guessed from the skill name already in the prompt, not read from disk.
	# Observed as a false CONTAMINATED on 2 of 7 sandboxed baselines, each one telling
	# the operator to discard a valid measurement. Only fall back to it when the bundle
	# offers no directory-anchored file to key on, so a marker always exists.
	if [ "${#markers[@]}" -eq 0 ]; then
		markers+=("skills/${skill}")
	fi

	kept=()
	for m in ${markers[@]+"${markers[@]}"}; do
		case "${prompt}" in *"${m}"*) continue ;; esac
		if [ -n "${fixture}" ] && grep -rqIF -e "${m}" -- "${fixture}" 2>/dev/null; then
			continue
		fi
		kept+=("${m}")
	done

	scan_directories=()
	[ -d "${snapshot_dir}" ] && scan_directories+=("${snapshot_dir}")
	[ -d "${out}/raw" ] && scan_directories+=("${out}/raw")
	scan_roots=()
	[ -e "${out}/result.json" ] && scan_roots+=("${out}/result.json")
	scan_roots+=("${scan_directories[@]}")

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
		# Put one control in every scanned directory and search that directory by
		# itself. A single control would prove only one root and could let a broken
		# raw-trace leg report a false clean verdict.
		# Judge detection by OUTPUT, not by grep's exit code: ugrep returns 2 on any
		# unreadable path even when it matched (GNU's "-q plus a match wins" rule is
		# not universal), which would fake a CHECK-BROKEN verdict on a working scan.
		undetected=""
		for root in "${scan_directories[@]}"; do
			control="${root}/.contamination-control"
			rm -rf -- "${control}"
			mkdir -p -- "${control}"
			printf '%s\n' "${kept[@]}" >"${control}/planted"
			for m in "${kept[@]}"; do
				hit="$(grep -rlIF -e "${m}" -- "${root}" 2>/dev/null | head -1)" || true
				[ -n "${hit}" ] || undetected="${undetected} ${root}:${m}"
			done
			rm -rf -- "${control}"
		done
		# File roots cannot host controls because they are evidence. Assert they are
		# readable and non-empty so an absent final response or trace cannot count as
		# a successful scan.
		unusable=""
		if [ ! -r "${out}/result.json" ] || [ ! -s "${out}/result.json" ]; then
			unusable="result.json is empty or unreadable; the response side was not searched"
		elif [ ! -r "${raw_trace}" ] || [ ! -s "${raw_trace}" ]; then
			unusable="raw trace is empty or unreadable; executor behavior was not searched"
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

echo "done: executor=${executor} config=${config} skill=${skill} -> ${out} (rc=${rc})"
# A contaminated baseline that exits 0 gets aggregated as a real measurement, so
# surface it in the exit status too — but never mask the CLI's own failure code.
if [ "${rc}" -eq 0 ] && [ "${contaminated}" -eq 1 ]; then
	exit 4
fi
exit "${rc}"
