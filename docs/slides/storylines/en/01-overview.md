# 1. Repository overview

Message: What problem the skill collection solves, a map of the skills, and the install commands.

## Slides

1. Cover. Shows that this is a skill collection for Claude Code, Codex and GitHub Copilot.
   Sources: the opening of `README.md`
2. What it solves. When you let agents do development, the steps vary from agent to agent, and the agents repeat the same mistakes.
   So the steps from filing an issue to merge become skills, and every agent follows the same steps.
   Sources: the opening of `README.md`
3. How the skills fit together. A diagram with the skills that apply to everything (multiagent-setup, writing-style) as the base at the bottom, and four pillars of equal weight on top.
   The four pillars are the skills used on their own (browser-test, aws-architecture-diagram, box), dependency updates, from issue to merge, and replacement without changing behavior.
   Sources: `README.md` "利用可能なスキル"
4. Installation. Prerequisites are `gh` v2.90.0 or later and `gh auth login`. Install with `gh skill install shoji9x9/skills <name>` and update with `gh skill update --all`.
   Sources: `README.md` "前提条件" "インストール" "スキルの更新"
5. Configuration. Skill configuration lives in files on three layers (repository, per person limited to the repository, per person).
   Sources: `README.md` "スキルの設定"
6. What to read next. Links to Chapters 2 to 10, with equal weight.
