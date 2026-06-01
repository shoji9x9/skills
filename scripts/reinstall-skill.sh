#!/usr/bin/env bash
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

rm -rf "${installed_dir}" "${claude_link}"
gh skill install "./${source_dir}" "${skill_name}" --from-local --agent codex

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
