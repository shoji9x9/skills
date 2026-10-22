# 2. multiagent-setup

Message: The idea behind the skill collection (do not depend on a single agent), and how to build that structure.

There is no "Where people decide" section. The only decision people make with this skill is answering when the agent cannot determine the target from the request, and the flow slide covers that.

## Slides

1. The problem. Each agent keeps instructions and skills in a different place (`.claude/`, `.github/`, `.codex/`). When you duplicate the same content, one copy goes out of date.
   Sources: `skills/multiagent-setup/SKILL.md` "基本原則", `skills/multiagent-setup/references/docs.md` "基本方針"
2. How to invoke. Ask "Initialize the project" or "Add a rule". A table shows what the skill creates for each target.
   For documents, the skill writes `AGENTS.md` with a fixed structure and adds sections for the criteria for choosing a component and for the response policy. `CLAUDE.md` and
   `.github/copilot-instructions.md` hold only the differences.
   The whole-project target initializes the project and creates the other four targets together.
   Sources: `argument-hint` in `skills/multiagent-setup/SKILL.md` and "Step 1: コンポーネントの特定",
   `skills/multiagent-setup/references/docs.md` "AGENTS.md の推奨構成" "既存の基底ドキュメントへの選択基準の追記" "CLAUDE.md / `.github/copilot-instructions.md` の方針"
3. Key points of the structure (diagram). The actual files exist once in `.agents/`, and `.claude/skills/`, `.claude/rules/` and `.github/instructions/` refer to them through symbolic links.
   `AGENTS.md` is the base, and `CLAUDE.md` and `.github/copilot-instructions.md` hold only the differences.
   For hooks, each agent's configuration file calls shared scripts in `.agents/hooks/scripts/`.
   Sources: `skills/multiagent-setup/references/skills.md`, `skills/multiagent-setup/references/rules.md` "ディレクトリ構造",
   `skills/multiagent-setup/references/docs.md` "ファイル別役割", `skills/multiagent-setup/references/hooks.md`
4. Flow. Decide the target of the operation (infer it from the request, and ask the user if that is not possible) → check the target agents (look at the existing configuration directories,
   and ask if the request does not say) → create each target with its own steps → follow-up (after creating a skill, suggest verifying it with skill-creator).
   Sources: `skills/multiagent-setup/SKILL.md` "フロー"
5. Choosing a component. Steps become a skill, conventions for touching specific files become a rule, processing that runs automatically on a given event becomes a hook, and everything else
   becomes documentation.
   Sources: `skills/multiagent-setup/references/component-selection.md` "最初の振り分け"
6. Outputs. `AGENTS.md`, the actual files in `.agents/`, and the links for each agent.
   Sources: `skills/multiagent-setup/references/skills.md` "ディレクトリ構造"
7. Related skills. kaizen uses this skill's selection criteria when it applies learnings (Chapter 4). You reread the documents you write with writing-style (Chapter 3).
   Sources: `skills/kaizen/references/apply.md`, `skills/multiagent-setup/SKILL.md` "Step 3: コンポーネントの実行"
