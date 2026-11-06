#!/usr/bin/env bash
# Dev-only: dogfood a skill being developed in this repo by reinstalling it from
# the local working tree into .agents/skills/ (real files) + .claude/skills/ (symlink).
# This is NOT `gh skill update`: that updates installed skills from the *published*
# remote, whereas this picks up *unreleased local* edits. The script is not bundled
# in any distributed skill and does not ship to install targets.
#
# Usage: scripts/tools/reinstall-skill.sh <skill-name>|--all
set -euo pipefail

reinstall_one() {
	local skill_name="$1"
	# skill_name builds paths for rm -rf / ln -s / gh, so restrict it to kebab-case
	# up front to avoid path traversal (.., /) or values starting with -.
	case "${skill_name}" in
	-* | *[!a-z0-9-]*)
		echo "invalid skill name (expected kebab-case: a-z, 0-9, -): ${skill_name}" >&2
		return 2
		;;
	esac
	local source_dir="skills/${skill_name}"
	local installed_dir=".agents/skills/${skill_name}"
	local claude_link=".claude/skills/${skill_name}"

	if [ ! -f "${source_dir}/SKILL.md" ]; then
		echo "Skill source not found: ${source_dir}/SKILL.md" >&2
		return 1
	fi

	# Preflight before anything destructive. This script removes the installed copy and
	# the symlink first, so a failure *after* that point leaves the skill half-installed
	# (it happened 3 times: twice on read-only targets, once on invalid frontmatter).
	# The stopping point has to be in front of the removal for the checks to protect the
	# existing installation at all.
	#
	# 1. Input validity. check-skill-frontmatter.ts otherwise only runs in pre-commit/CI,
	#    but reinstall is what you hit first after editing a skill, and `gh skill install`
	#    rejects invalid frontmatter *after* the removal.
	if ! node scripts/gates/packaging/check-skill-frontmatter.ts "${source_dir}/SKILL.md"; then
		echo "Preflight failed: ${source_dir}/SKILL.md の frontmatter が不正（既存のインストールは触っていない）" >&2
		return 1
	fi
	# 2. Writability of every update target, checked before the first removal.
	local target probe
	for target in ".agents/skills" ".claude/skills"; do
		# 未作成なら `mkdir -p` が作るので、直近の**実在する祖先**の書き込み可否を見る。
		# `[ -e ]` のときだけ検査すると、未作成の更新先では何も検査されず、
		# rm -rf の後の mkdir が落ちて半インストールになる（preflight が防ぐはずの形）。
		probe="${target}"
		# `[ -e ]` はリンク先が無い symlink で偽になるため、`-L` も見る。見ないと探索が
		# リンク先が無い symlink を通り越して親で PASS し、rm -rf の後の mkdir -p が
		# File exists で落ちる（preflight が防ぐはずの半インストール）。
		while [ ! -e "${probe}" ] && [ ! -L "${probe}" ] && [ "${probe}" != "." ] && [ "${probe}" != "/" ]; do
			probe="$(dirname "${probe}")"
		done
		if [ -L "${probe}" ] && [ ! -e "${probe}" ]; then
			echo "Preflight failed: ${probe} が壊れた symlink（既存のインストールは触っていない）" >&2
			return 1
		fi
		if [ ! -w "${probe}" ]; then
			echo "Preflight failed: ${probe} へ書き込めない（既存のインストールは触っていない）" >&2
			return 1
		fi
	done
	if [ -e "${installed_dir}" ]; then
		local unwritable
		# `-writable` は GNU find の拡張なので、POSIX の -exec test -w で書く。
		unwritable="$(find "${installed_dir}" -type d ! -exec test -w {} \; -print -quit)"
		if [ -n "${unwritable}" ]; then
			echo "Preflight failed: ${unwritable} へ書き込めない（既存のインストールは触っていない）" >&2
			return 1
		fi
	fi

	# Remove the installed copy first so renamed/deleted files (e.g. moving component
	# files into references/) don't linger as stale leftovers after reinstall.
	rm -rf -- "${installed_dir}" "${claude_link}"
	# --agent codex installs into the shared .agents/skills/ as the single source of
	# truth (Codex/Copilot read it directly). Claude Code reads it via the symlink
	# below; installing with --agent claude-code instead would make a second copy.
	# --force keeps the reinstall non-interactive.
	gh skill install "./${source_dir}" "${skill_name}" --from-local --agent codex --force

	mkdir -p .claude/skills
	ln -s "../../${installed_dir}" "${claude_link}"

	# gh skill install --from-local injects local-path metadata. Do not commit
	# machine-local absolute paths into project-scoped installed skills. Use node
	# (already required by repo tooling) rather than perl for portability.
	node -e 'const fs=require("fs");const f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/metadata:\n\s+local-path: [^\n]+\n/,""))' "${installed_dir}/SKILL.md"

	if grep -q "local-path:" "${installed_dir}/SKILL.md"; then
		echo "Failed to remove local-path metadata from ${installed_dir}/SKILL.md" >&2
		return 1
	fi

	echo "Reinstalled ${skill_name}: ${installed_dir} + ${claude_link}"
}

if [ "$#" -ne 1 ]; then
	echo "Usage: scripts/tools/reinstall-skill.sh <skill-name>|--all" >&2
	exit 2
fi

# Operate on the repository this copy of the script belongs to, not on the cwd: every
# path below is relative, so running from a subdirectory used to stop at "Skill source
# not found", and a cwd in another repo with the same skills/<name> would fail the
# frontmatter preflight for the wrong reason. In a worktree this picks that worktree.
# The root is positional (two levels above the resolved script file), confirmed by
# markers. When it can't be identified (copied out of the repo, read from stdin), stop
# with exit 2 before anything destructive, with a message that can't be mistaken for a
# frontmatter failure.
script_path="${BASH_SOURCE[0]:-}"
# Follow a symlink to the script file itself. The chain terminates: bash has already read
# the script through this path, so it is not a loop (the kernel would refuse with ELOOP).
while [ -n "${script_path}" ] && [ -L "${script_path}" ]; do
	link="$(readlink -- "${script_path}")"
	case "${link}" in
	/*) script_path="${link}" ;;
	*) script_path="$(dirname -- "${script_path}")/${link}" ;;
	esac
done
repo_root=""
if [ -n "${script_path}" ] && [ -f "${script_path}" ]; then
	# CDPATH is cleared: a relative dirname (scripts/tools/../..) is otherwise searched in an
	# exported CDPATH first, and cd then lands elsewhere and echoes the path into repo_root.
	repo_root="$(CDPATH='' cd -P -- "$(dirname -- "${script_path}")/../.." 2>/dev/null && pwd)" || repo_root=""
fi
if [ -z "${repo_root}" ] ||
	[ ! -f "${repo_root}/scripts/gates/packaging/check-skill-frontmatter.ts" ] ||
	[ ! -d "${repo_root}/skills" ]; then
	echo "Repository root not found from the script location: ${BASH_SOURCE[0]:-<stdin>}（scripts/gates/packaging/check-skill-frontmatter.ts と skills/ を持つツリーを特定できない。既存のインストールは触っていない）" >&2
	exit 2
fi

# Stop while the mutation proof (scripts/mutation/check-mutation-proof.ts) runs in this tree.
# It rewrites the sources in place, so a copy taken now ships an active mutation into the
# installed skill (it happened 4 times despite the rule in docs/tooling.md). The lock path is
# the runner's: node_modules/.cache/mutation-proof/lock, or MUTATION_PROOF_LOCK if set.
# A lock whose PID is dead is stale and the runner removes it on its next start, so it does
# not stop the reinstall. A lock without a readable PID can't be judged and stops it.
# The recovery file (<lock>.recovery.json) stays when a run was killed or could not restore a
# file, with or without a lock. The mutation is then still in the sources, so it stops too.
mutation_lock="${MUTATION_PROOF_LOCK:-${repo_root}/node_modules/.cache/mutation-proof/lock}"
if [ -e "${mutation_lock}.recovery.json" ]; then
	echo "ミューテーションテストの復元情報（${mutation_lock}.recovery.json）が残っているので止まる。前回の実行が中断され、原本に変異が残っている可能性がある。ランナーを再実行して戻す。ランナーも止まるときは、原本を確かめて直してから復元情報を消して再実行する（既存のインストールは触っていない）" >&2
	exit 1
fi
if [ -e "${mutation_lock}" ]; then
	lock_pid="$(head -n 1 -- "${mutation_lock}" 2>/dev/null | tr -d '[:space:]')" || lock_pid=""
	case "${lock_pid}" in
	'' | *[!0-9]*)
		echo "ミューテーションテストのロック（${mutation_lock}）から PID を読めないので止まる。実行中でないことを確かめてからロックを消して再実行する（既存のインストールは触っていない）" >&2
		exit 1
		;;
	esac
	# PID 0 は kill ではプロセスグループを指し、macOS の ps -p 0 は kernel_task を返すので、ランナーと同じく古いロックとして扱う。
	# 整数の範囲を超える値は [ が比べられずに偽になり、ランナーと同じく存在しないプロセスとして扱う。
	# 生きているかは ps -p で見る。kill -0 は別のユーザーのプロセスで権限が無いと失敗するが、
	# ランナーはその場合（EPERM）を生きているとして扱う。
	if [ "${lock_pid}" -gt 0 ] 2>/dev/null && ps -p "${lock_pid}" >/dev/null 2>&1; then
		echo "ミューテーションテストの実行中（PID ${lock_pid}、ロック: ${mutation_lock}）は原本に変異が入っているので止まる。終わるまで待ってから再実行する（既存のインストールは触っていない）" >&2
		exit 1
	fi
fi
cd "${repo_root}"

if [ "$1" = "--all" ]; then
	for dir in skills/*/; do
		reinstall_one "$(basename "${dir}")"
	done
else
	reinstall_one "$1"
fi
