#!/usr/bin/env bash
# Dev-only: dogfood a skill being developed in this repo by reinstalling it from
# the local working tree into .agents/skills/ (real files) + .claude/skills/ (symlink).
# This is NOT `gh skill update`: that updates installed skills from the *published*
# remote, whereas this picks up *unreleased local* edits. The script is not bundled
# in any distributed skill and does not ship to install targets.
set -euo pipefail

if [ "$#" -ne 1 ]; then
	echo "Usage: scripts/reinstall-skill.sh <skill-name>" >&2
	exit 2
fi

skill_name="$1"
source_dir="skills/${skill_name}"
installed_dir=".agents/skills/${skill_name}"
claude_link=".claude/skills/${skill_name}"

if [ ! -f "${source_dir}/SKILL.md" ]; then
	echo "Skill source not found: ${source_dir}/SKILL.md" >&2
	exit 1
fi

# Remove the installed copy first so renamed/deleted files (e.g. moving component
# files into references/) don't linger as stale leftovers after reinstall.
rm -rf "${installed_dir}" "${claude_link}"
# --agent codex installs into the shared .agents/skills/ as the single source of
# truth (Codex/Copilot read it directly). Claude Code reads it via the symlink
# below; installing with --agent claude-code instead would make a second copy.
# --force keeps the reinstall non-interactive.
gh skill install "./${source_dir}" "${skill_name}" --from-local --agent codex --force

mkdir -p .claude/skills
ln -s "../../${installed_dir}" "${claude_link}"

# gh skill install --from-local injects local-path metadata. Do not commit
# machine-local absolute paths into project-scoped installed skills.
perl -0pi -e 's/metadata:\n\s+local-path: [^\n]+\n//' "${installed_dir}/SKILL.md"

if grep -q "local-path:" "${installed_dir}/SKILL.md"; then
	echo "Failed to remove local-path metadata from ${installed_dir}/SKILL.md" >&2
	exit 1
fi

echo "Reinstalled ${skill_name}: ${installed_dir} + ${claude_link}"
