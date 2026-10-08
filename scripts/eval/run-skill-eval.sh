#!/usr/bin/env bash
# 開発用: スキルの eval の prompt を 1 件、Claude Code か Codex で実行する。
# 実行先は、隔離した使い捨ての空のプロジェクトにする。eval のファイル操作がこのリポジトリに及ばないようにするためである。
# 回帰テストのベンチマークを作るのに使う（docs/skill-development.md「回帰テストを実行する」）。
#
# エージェントに `cd /tmp` を指示するのではなく、起動側で cwd を固定する理由:
#   コーディングエージェントの Bash ツールでは、`cd` がツールの呼び出しをまたいで残るとは限らない。
#   cwd はターンの中では残ることがあるが、ターンの境目やプロジェクトを出た後には戻る。
#   また、相対パスのファイル操作はエージェントの基準のディレクトリで解決される。
#   そのため subagent に「/tmp で作業して」と指示すると、スキルの相対パスの手順（`mkdir .agents/...`、`ln -s`）が
#   このリポジトリに作られてしまう。
#   ここでは、起動側が 1 回のシェルの呼び出しの中で cwd を固定する。選んだ executor は cwd = 一時プロジェクトで起動する。
#   そのため、入れ子のセッションのプロジェクトのルート（と cwd が戻る先）は、一時プロジェクトの中に留まる。
#
# このスクリプトはリポジトリの中だけで使うツールで、配布するスキルには同梱しない。
#
# 前提: 使い捨てのプロジェクトは空で、信頼済みにしておらず、非対話である。
# 信頼済みでないと、mise の shim（python3/node/jq）は "No version is set" で失敗する。
# gh や git を使うスキルにはリポジトリの文脈が無い（架空の番号ではなく、実在する PR や Issue の番号を使う）。
# headless の executor には、対話の質問に答える相手がいない。
# 意図があいまいでない prompt を渡し、スキルが機能を減らしても動くようにする。
# docs/skill-development.md「eval 環境の前提（runtime / repo / 非対話）」を参照する。
#
# executor の取り決め: `--executor claude-code|codex` でベンダーの CLI を選ぶ。
# どちらを選んでも、result.json / timing.json / outputs/response.md は同じ形で出す。
# ベンダー固有の trace は raw/ に置き、読む側はそれに依存しない。
# Codex のスキルは、Codex 本来のリポジトリの範囲 `.agents/skills` にインストールする。
# その SKILL.md を prompt に埋め込むことはしない。
#
# ベースラインの健全性（`--config without_skill`）: cwd とスキルのインストールを隔離するだけでは足りない。
# ベンダーの CLI がこのリポジトリのスキルのソースを読み、スキル固有の assertion を満たしてしまうことがある。
# すると、測った Delta が警告なしに無意味になる。これは 5 回起き、毎回同じラッパーを手で組んで直した
# （.kaizen/archive/2026-07-28-eval-baseline-read-contamination.md）。
# そこで、操作する人ではなく、このスクリプトがこれを担う。
# ベースラインはデフォルトで scripts/eval/eval-sandbox.sh の中で実行する。
# 隔離しないベースラインは、with_skill の run と同時に実行しない（直列にする）。
# ベースラインの run には、すべて汚染の判定を付ける。
#
# 終了コード:
#   0。run が失敗したときは、CLI 自身の終了コード。
#   2: 使い方の誤り。
#   3: 直列化のロックを取れなかった。
#   4: run 自体は成功したが、ベースラインが汚染されている（CONTAMINATED）か、汚染のチェックを信頼できない
#      （CHECK-BROKEN / SKIPPED。実行されなかったチェックは、汚染なしの判定ではない）。
#   5: fingerprint の生成、結果の正規化、eval の metadata の生成のどれかに失敗した。
#   6: ベースラインの再利用を拒否した（入力・実行条件・出所・成果物のどれかを確かめられない）。
set -euo pipefail

usage() {
	echo "Usage: $0 --skill <name> --prompt <text> --config <with_skill|without_skill> --out <dir> [--executor <claude-code|codex>] [--model <model>] [--reasoning-effort <effort>] [--eval-id <id>] [--eval-name <name>] [--repo <path>] [--fixture <dir>] [--reuse-baseline <run-dir>]" >&2
	exit 2
}

skill="" prompt="" config="" out="" executor="claude-code" model="" reasoning_effort="" eval_id="" eval_name="" repo="" fixture="" reuse_baseline=""
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
	--reuse-baseline)
		reuse_baseline="$2"
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
[ -z "${reuse_baseline}" ] || [ "${config}" = "without_skill" ] || {
	echo "--reuse-baseline is valid only with --config without_skill" >&2
	exit 2
}
[ -z "${reuse_baseline}" ] || [ -n "${eval_id}" ] || {
	echo "--reuse-baseline requires an explicit --eval-id so assertions are fingerprinted" >&2
	exit 2
}
[ -z "${reuse_baseline}" ] || { [ -n "${model}" ] && [ -n "${reasoning_effort}" ]; } || {
	echo "--reuse-baseline requires explicit --model and --reasoning-effort values" >&2
	exit 2
}
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
# Eval definitions live outside skills/<name>/ so `gh skill install` does not ship
# them to downstream repositories (it copies every file under the skill directory).
evals_file="${repo}/evals/${skill}/evals.json"
normalizer="${repo}/scripts/eval/normalize-skill-eval-result.js"
[ -f "${normalizer}" ] || {
	echo "normalizer not found: ${normalizer}" >&2
	exit 1
}
fingerprinter="${repo}/scripts/eval/skill-eval-fingerprint.js"
reuse_helper="${repo}/scripts/eval/reuse-skill-eval-baseline.js"
[ -f "${fingerprinter}" ] && [ -f "${reuse_helper}" ] || {
	echo "baseline fingerprint helpers not found under ${repo}/scripts/eval" >&2
	exit 1
}

case "${executor}" in
claude-code) executor_binary="claude" ;;
codex) executor_binary="codex" ;;
esac
if [ -n "${SKILL_EVAL_CLI_VERSION:-}" ]; then
	cli_version="${SKILL_EVAL_CLI_VERSION}"
else
	cli_version="$(${executor_binary} --version 2>/dev/null || true)"
fi
[ -n "${cli_version}" ] || cli_version="unknown"
[ -z "${reuse_baseline}" ] || [ "${cli_version}" != "unknown" ] || {
	echo "baseline reuse rejected: executor CLI version could not be determined; run a new without_skill evaluation" >&2
	exit 6
}
# Bump this whenever a harness change alters what a run records. It is part of the
# eval fingerprint, and `--reuse-baseline` only accepts a baseline whose fingerprint
# matches — /3 is the stream-json switch (raw/claude-code.jsonl + per-tool records +
# result.json `skill_usage`), so a baseline captured under /2 can no longer be paired
# with a with_skill run that has those fields.
harness_version="run-skill-eval/3"

metadata_eval_id="${eval_id}"
eval_dir="$(dirname -- "$(dirname -- "${out}")")"
eval_dir_name="$(basename -- "${eval_dir}")"
if [ -z "${metadata_eval_id}" ]; then
	case "${eval_dir_name}" in
	eval-*) metadata_eval_id="${eval_dir_name#eval-}" ;;
	esac
fi

# Sibling skills the eval declares in evals.json `requires_skills`. Without them a
# skill that calls a sibling's bundled tool stops on the missing sibling before the
# branch the eval targets, and whether it reaches that branch depends on the order
# the agent checks prerequisites in. They are installed in BOTH configurations: the
# comparison must differ only by the subject skill, and installing siblings for
# with_skill alone would credit the sibling's instructions to the subject. Resolved
# before anything runs so a malformed declaration or a missing sibling source fails
# the run instead of silently dropping the sibling.
required_skills=()
if [ -n "${metadata_eval_id}" ] && [ -f "${evals_file}" ]; then
	required_skills_list="$(node "${fingerprinter}" --required-skills-of "${skill}" --eval-id "${metadata_eval_id}" --evals "${evals_file}")" || exit 5
	while IFS= read -r required_skill; do
		[ -n "${required_skill}" ] || continue
		[ -f "${repo}/skills/${required_skill}/SKILL.md" ] || {
			echo "required skill source not found: ${repo}/skills/${required_skill}/SKILL.md" >&2
			exit 1
		}
		required_skills+=("${required_skill}")
	done <<<"${required_skills_list}"
fi

fingerprint_file="$(mktemp "/tmp/skill-eval-fingerprint-${skill}-XXXXXX.json")"
fingerprint_args=(
	--skill "${skill}"
	--prompt "${prompt}"
	--executor "${executor}"
	--model "${model}"
	--reasoning-effort "${reasoning_effort}"
	--cli-version "${cli_version}"
	--harness-version "${harness_version}"
)
[ -n "${metadata_eval_id}" ] && fingerprint_args+=(--eval-id "${metadata_eval_id}" --evals "${evals_file}")
[ -n "${fixture}" ] && fingerprint_args+=(--fixture "${fixture}")
fingerprint_args+=(--skills-root "${repo}/skills")
node "${fingerprinter}" "${fingerprint_args[@]}" >"${fingerprint_file}" || {
	rm -f -- "${fingerprint_file}"
	exit 5
}

if [ -n "${reuse_baseline}" ]; then
	node "${reuse_helper}" "${reuse_baseline}" "${out}" "${fingerprint_file}" || {
		rm -f -- "${fingerprint_file}"
		echo "baseline reuse rejected; run a new without_skill evaluation" >&2
		exit 6
	}
	rm -f -- "${fingerprint_file}"
	exit 0
fi

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
	rm -f -- "${fingerprint_file}"
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
sandbox="${repo}/scripts/eval/eval-sandbox.sh"
if [ -n "${SKILL_EVAL_RUNNER:-}" ]; then
	isolation="UNVERIFIED (operator-supplied SKILL_EVAL_RUNNER=${SKILL_EVAL_RUNNER})"
elif [ ! -x "${sandbox}" ]; then
	isolation="UNISOLATED (${sandbox} missing or not executable)"
elif ! command -v bwrap >/dev/null 2>&1; then
	isolation="UNISOLATED (bwrap not found; install bubblewrap to isolate reads)"
else
	runner_override="${sandbox}"
	isolation="sandboxed (scripts/eval/eval-sandbox.sh)"
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

installed_skills=()
if [ "${config}" = "with_skill" ]; then installed_skills+=("${skill}"); fi
installed_skills+=(${required_skills[@]+"${required_skills[@]}"})
if [ "${#installed_skills[@]}" -gt 0 ]; then
	case "${executor}" in
	claude-code) skill_home="${proj}/.claude/skills" ;;
	codex) skill_home="${proj}/.agents/skills" ;;
	esac
	mkdir -p -- "${skill_home}"
	for installed_skill in "${installed_skills[@]}"; do
		installed_src="${repo}/skills/${installed_skill}"
		mkdir -p -- "${skill_home}/${installed_skill}"
		for subject_part in SKILL.md references assets scripts; do
			[ -e "${installed_src}/${subject_part}" ] || continue
			cp -R -- "${installed_src}/${subject_part}" "${skill_home}/${installed_skill}/"
		done
	done
fi

# Capture fixture/input paths before the executor runs. files_created is later
# derived from captured project-files minus this manifest, so pre-existing
# fixture files are not mislabeled as generated outputs.
(cd "${proj}" && find . \( -path "*/.git" -o -path "*/node_modules" -o -path "./.claude/skills" -o -path "./.agents/skills" \) -prune -o -type f -printf '%P\0' | LC_ALL=C sort -z) >"${initial_files_manifest}"

mkdir -p -- "${out}/outputs" "${out}/raw"
cp -- "${fingerprint_file}" "${out}/eval-fingerprint.json"
{
	echo "executor: ${executor}"
	echo "config: ${config}"
	echo "isolation: ${isolation}"
	echo "serialization: ${serialization}"
	echo "required_skills: ${required_skills[*]-}"
} >"${out}/isolation.txt"
case "${isolation}" in
UNISOLATED* | UNVERIFIED*) echo "warn: read isolation is ${isolation} (see ${out}/isolation.txt)" >&2 ;;
esac

# Headless runs keep cwd fixed to the disposable project within one invocation.
# Bubblewrap owns host read isolation. Codex also retains its own workspace-write
# sandbox so the auth file mounted for CLI startup is not exposed to agent shell
# commands. The two layers protect different boundaries and both stay enabled.
runner="${SKILL_EVAL_RUNNER:-${runner_override:-${executor_binary}}}"

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
	# stream-json (not plain json) is what leaves a per-tool record in raw/: the plain
	# form writes only the final result + usage, so "the agent never ran X" could not be
	# shown from raw, and a with_skill run that never opened the skill was indistinguishable
	# from one that did (#377). The trailing `result` event carries the same fields as the
	# plain form, so result/usage/num_turns extraction is unchanged.
	raw_trace="${out}/raw/claude-code.jsonl"
	executor_args=(-p "${prompt}" --output-format stream-json --verbose --dangerously-skip-permissions)
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
# 操作する人の手元のレビュアーの上書きで、eval の振る舞いが起動した人によって変わってはいけない。
# 環境変数の優先順位を試すシナリオは、その入力を eval の prompt に書く。
# 開発者の `.env.local` を、どちらの config にも持ち込まない。
# stdin は必ず /dev/null にする。プロンプトは引数で渡しているが、executor は stdin も読もうとする。
# 呼び出し側の stdin が EOF にならないパイプ（バックグラウンド実行・エージェント経由）だと、
# `Reading additional input from stdin...` のまま無限に待つ。raw trace は 0 バイトのままで、
# timeout でしか終わらない（実測で codex が 7 分以上止まった）。
(
	cd "${proj}"
	unset SKILLS_REVIEW_TOOL
	EVAL_SANDBOX_CLI="${executor_binary}" EVAL_SANDBOX_VENDOR="${executor}" "${runner}" "${executor_args[@]}"
) </dev/null >"${raw_trace}" 2>"${out}/stderr.log" || rc=$?
ended_ms="$(date +%s%3N)"
ended_at="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
duration_ms=$((ended_ms - started_ms))
[ "${rc}" -ne 0 ] && echo "warn: ${executor_binary} exited ${rc} (see ${out}/stderr.log)" >&2

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
	--skill "${skill}"
	--config "${config}"
	# The skill text a run could only have seen by opening the skill: lines of every
	# other skill, the fixture and the prompt are taken out (normalize-skill-eval-result.js
	# `buildSkillContentIndex`).
	--skills-root "${repo}/skills"
	--prompt "${eval_prompt}"
)
[ -n "${fixture}" ] && normalizer_args+=(--fixture "${fixture}")
if [ -n "${metadata_eval_id}" ]; then
	normalizer_args+=(
		--eval-id "${metadata_eval_id}"
		--eval-name "${eval_name}"
		--eval-metadata "${eval_dir}/eval_metadata.json"
		--compat-eval-metadata "${out}/eval_metadata.json"
	)
	[ -f "${evals_file}" ] && normalizer_args+=(--evals "${evals_file}")
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
	# .ts / .tsx / .sql は、replace-strategy のスキル群が対象のプロジェクトに書く言語である。
	# 例えば golden-dataset の投入ツール〈typescript | sql〉、parity-suite の Playwright スイートと
	# ロケータマッピング、parity-replace の新側実装がある。
	# assertion はこれらのファイルを名指しするので、スナップショットから採点できる必要がある。
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
# The codex side of the contamination scan (see below). Cleared first so a surface
# left by an earlier run into the same --out cannot stand in for this one's.
contamination_surface_dir="${out}/contamination-surface"
rm -rf -- "${contamination_surface_dir}"
if [ "${config}" = "without_skill" ] && [ "${executor}" = "codex" ]; then
	mkdir -p -- "${contamination_surface_dir}"
	contamination_surface="${contamination_surface_dir}/codex.jsonl"
	normalizer_args+=(--contamination-surface "${contamination_surface}")
fi
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
		# Required siblings are installed in the baseline too, so a path that also
		# exists in a sibling's bundle (parity-suite ships its own
		# assets/metadata-template.json) or appears in a sibling's text reaches the
		# baseline honestly, exactly like the fixture.
		sibling_hit=0
		for required_skill in ${required_skills[@]+"${required_skills[@]}"}; do
			required_src="${repo}/skills/${required_skill}"
			if [ -e "${required_src}/${m}" ]; then
				sibling_hit=1
				break
			fi
			for part in SKILL.md references assets scripts; do
				if [ -e "${required_src}/${part}" ] && grep -rqIF -e "${m}" -- "${required_src}/${part}" 2>/dev/null; then
					sibling_hit=1
					break 2
				fi
			done
		done
		[ "${sibling_hit}" -eq 0 ] || continue
		kept+=("${m}")
	done

	scan_directories=()
	[ -d "${snapshot_dir}" ] && scan_directories+=("${snapshot_dir}")
	# Neither executor's raw/ is scanned whole: both are event streams that carry
	# intermediate messages and tool inputs, which are mentions, not reads — a baseline
	# whose only tool call was `echo references/oauth-setup.md` was reported
	# CONTAMINATED and the run discarded (measured on claude-code, #400; same shape on
	# codex, #401). claude-code's raw used to be the final result object alone — the
	# same text as result.json — so it is simply out; its read evidence lives in
	# result.json `skill_usage` (`unexpected_read`). Codex's raw has always been an event
	# stream, so dropping it would shrink the surface it has always had. It is scanned
	# through the normalizer's contamination surface instead: the trace minus a closed
	# set of mention-only events (agent text, file_change paths, one plain echo/printf),
	# with every other line — command strings, command output, unparsable lines — kept
	# verbatim (normalize-skill-eval-result.js `codexContaminationSurface`).
	case "${executor}" in
	codex) [ -d "${contamination_surface_dir}" ] && scan_directories+=("${contamination_surface_dir}") ;;
	esac
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
		# 最初に、検出されることを確かめる。「該当なし」と「走査が動いていない」は同じ出力になる。
		# そのため、汚染なしの判定を信じる前に、走査が見つけるべき目印を見つけることを示す
		# （docs/agent-workflow.md の「該当なし」を根拠にするチェックは、検出できることを先に確かめる）。
		# 目印は走査するディレクトリごとに 1 つ置き、そのディレクトリだけを対象に検索する。
		# 目印が 1 つだけだと、示せるのは 1 つのルートだけになる。
		# そうすると、raw trace の側の走査が動いていなくても、誤って汚染なしと報告しうる。
		# 検出は grep の終了コードではなく出力で判定する。ugrep は、一致があっても読めないパスがあると 2 を返す
		# （GNU の「-q で一致があれば成功」という規則は共通ではない）。
		# 終了コードで判定すると、動いている走査を CHECK-BROKEN と誤って判定してしまう。
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
		elif [ "${executor}" = "codex" ] && { [ ! -r "${contamination_surface}" ] || [ ! -s "${contamination_surface}" ]; }; then
			# A trace always opens with thread.started, which the surface keeps, so an
			# empty or absent surface means the derivation failed, not a clean trace.
			unusable="codex contamination surface is empty or unreadable; executor behavior was not searched"
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
