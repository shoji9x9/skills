#!/usr/bin/env bash
# Dev-only: dogfood a skill being developed in this repo by reinstalling it from
# the local working tree into .agents/skills/ (real files) + .claude/skills/ (symlink).
# This is NOT `gh skill update`: that updates installed skills from the *published*
# remote, whereas this picks up *unreleased local* edits. The script is not bundled
# in any distributed skill and does not ship to install targets.
#
# Usage: scripts/reinstall-skill.sh <skill-name>|--all
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
	echo "Usage: scripts/reinstall-skill.sh <skill-name>|--all" >&2
	exit 2
fi

if [ "$1" = "--all" ]; then
	for dir in skills/*/; do
		reinstall_one "$(basename "${dir}")"
	done
else
	reinstall_one "$1"
fi
